# Bark & Stroll — Cancellation Emails + Walker-Email Privacy Fix

**Date:** 2026-05-28
**Status:** Approved (design)
**Owner:** Scott Rocca

## Summary

Two coupled changes to the Bark & Stroll appointment system:

1. **Walker email privacy fix.** Today the walker's "new booking" email includes the client's first name. The walker is supposed to see the dogs, not the client. Drop the client name from the walker copy (single + batch).
2. **Cancellation emails.** Today the calendar's "Cancel Appointment" button hard-deletes the row and sends no email. Replace with a soft-cancel that sends three emails (client, walker, owner) mirroring the new-booking flow, including a `METHOD:CANCEL` ICS so calendar apps auto-remove the event.

## Motivation

- Walker emails leak client identity. The walker only needs to know dog name(s), address, and time — privacy guideline is "walkers route through Scott, not clients." The current "Client: <first name>" row breaks that.
- A cancelled appointment with no email = walker drives to a cancelled visit and finds nobody home. Client also gets no closure when a visit they expected disappears from the calendar.

## Out of scope

- **Google Calendar auto-sync to scott@barkstroll.com.** Stays manual/one-time. The owner-copy `METHOD:CANCEL` ICS handles Scott's own calendar when he opens the email; no gcal API call.
- **Bulk cancel-a-whole-batch in one click.** Cancellation is per-visit. If a 3-visit batch needs all three cancelled, click cancel on each. (Future enhancement.)
- **SMS notifications.** Email only, same as the booking flow.
- **Edit/reschedule-with-email-update.** Out of scope for this change. (Reschedule today silently updates the row; emails are not re-sent.)

## Changes

### 1. Walker email privacy fix

**File:** `lib/email.js`

**Single appointment (`sendAppointmentEmail`):**

- Remove the `['Client', firstName(appt.customer_name)]` row from the walker's email body (currently around line 168).
- Walker email rows become: `Date`, `Time`, `Service`, `Dog(s) + breed`, `Address`, `Notes`.
- Dogs are already shown via `dog_names_with_breed`; the fix is strictly the removal of the Client row.
- Client and owner email bodies are unchanged.

**Batch (`sendBatchAppointmentEmail`):**

- Rewrite the walker `intro` string (currently around line 323) from:

  > "You're on the schedule for **{firstName(customer_name)}**'s {dog_names}{addrLine}. **{N} visits** across {dateRange}…"

  to:

  > "You're on the schedule for **{dog_names}**{addrLine}. **{N} visits** across {dateRange}…"

- Drop `firstName(first.customer_name)` from the walker batch intro. Address line stays.
- Subject (`BBS: {walker first} & {dog_names}, ...`) is already dog-forward — no change.

**Why "no fallback to first name if dogs missing":** Every appointment requires at least one dog at booking time (existing constraint). If `dog_names` is somehow empty the email still renders correctly (just "You're on the schedule…"), and that's a data bug worth catching, not papering over.

### 2. Cancellation flow

#### 2a. New API endpoint

**`POST /appointments/:id/cancel`** in `routes/appointments.js`:

```
- Load appointment + hydrated client/walker/dogs/service data (same join as single GET).
- Guard: appointment not found → 404.
- Guard: appointment.status === 'completed' → 400 ("Cannot cancel a completed visit").
- Guard: appointment.status === 'cancelled' → 200 no-op, returns { ok: true, already_cancelled: true }.
- UPDATE appointments
    SET status = 'cancelled',
        cancelled_at = datetime('now'),
        cancelled_by = ?,
        updated_at = datetime('now')
    WHERE id = ?
  where cancelled_by = session admin user (req.session?.user || 'admin').
- Synchronously call sendCancellationEmail(appt) (no quiet-hours queue — cancellations send immediately).
- Return { ok: true, email_sent: { client: bool, walker: bool, owner: bool } }.
```

The existing `DELETE /appointments/:id` (hard delete) stays in place for admin tooling but is no longer the UI cancel path. Add a code comment noting it's hard-delete only and points to the cancel endpoint for normal cancellation.

#### 2b. UI change

**File:** `public/js/views/calendar.js`

In `cancelAppt(id)`:

- Replace `await api('/appointments/' + id, { method: 'DELETE' });`
- With `await api('/appointments/' + id + '/cancel', { method: 'POST' });`
- Keep the existing `confirmDialog`, `closeModal`, `toast`, `renderCal` choreography.
- Toast text updates to "Appointment cancelled — emails sent."

#### 2c. Email lib additions

**File:** `lib/email.js` — add `sendCancellationEmail(appt)` mirroring `sendAppointmentEmail`'s three-recipient shape.

**Subject:** `BBS: CANCELLED — {firstName(employee_name)} & {dog_names}, {dateStr} at {timeStr}`

**Client copy (HTML body):**

> Hi {client first name},
>
> Your scheduled appointment has been **removed from the Bark & Stroll calendar**. Please reach out if this was a mistake and you need to re-add your pup to our calendar.

Then a small details block: Date, Time, Service, Dog(s), Walker (first name only). No address (client knows it).

**Walker copy (HTML body):**

> Hi {walker first name},
>
> **This visit has been cancelled — you do not need to go.**

Then a details block: Date, Time, Service, Dog(s) + breed, Address. **No client name** (same privacy rule as the post-fix new-booking walker email).

**Owner copy (HTML body):**

> Hi Scott,
>
> Cancelled by {cancelled_by}. Both attendees have been emailed.

Then a details block: Date, Time, Service, Dog(s), Client (full name), Walker (full name), Address.

**ICS attachment:** each email includes a `METHOD:CANCEL` ICS with the **same UID** as the original `METHOD:REQUEST` so the recipient's calendar app auto-removes the event when they open the email. UID derivation already exists in `lib/ics.js` and is deterministic from `appointment.id` — reuse it; do not generate a new UID. Bump SEQUENCE to `1` (originals are SEQUENCE:0).

**Per-recipient send:**

- Pattern matches `sendAppointmentEmail` exactly — three independent `tasks` entries, each gated on `!alreadySent('appt_cancel', appt.id, role)`.
- `role` values: `'customer'`, `'employee'`, `'owner'` (same vocabulary as the create flow).
- Send via `runSendTasks('appt_cancel', appt.id, tasks)`. The shared helper handles per-recipient idempotency.

**Quiet-hours bypass:** unlike `sendAppointmentEmail`, the route handler calls this synchronously regardless of time of day. Add a code comment: "Cancellations bypass quiet hours — missing a cancel is worse than waking someone up."

### 3. DB schema

**File:** `init-db.js` (table definition) + a small migration script.

Add two nullable columns to `appointments`:

```sql
ALTER TABLE appointments ADD COLUMN cancelled_at TEXT;
ALTER TABLE appointments ADD COLUMN cancelled_by TEXT;
```

Both nullable, no default, no backfill. No change to existing `status` column (already accepts `'cancelled'`).

The `email_sends` table already supports an arbitrary `kind` string per-recipient — no schema change needed for cancel idempotency.

### 4. Tests

**File:** `test/email-idempotency.test.js` (or a new `test/cancel-email.test.js` if cleaner) — additions:

1. **Walker single-email privacy:** `sendAppointmentEmail` produces a walker email body that does NOT contain `client.first_name`.
2. **Walker batch privacy:** `sendBatchAppointmentEmail` walker intro does NOT contain `client.first_name`.
3. **Cancel three-recipient send:** `POST /appointments/:id/cancel` records exactly three `email_sends` rows (`customer`, `employee`, `owner`) with `kind='appt_cancel'`.
4. **Cancel idempotency:** a second `POST` to the same cancel endpoint returns `already_cancelled: true` and does not insert duplicate `email_sends` rows.
5. **Cancel walker copy contains stop-guard string:** walker cancellation email body contains the substring `"do not need to go"`.
6. **Cancel ICS shape:** the cancellation ICS attachment contains `METHOD:CANCEL`, the same `UID:` value as the original `METHOD:REQUEST`, and `SEQUENCE:1`.
7. **Completed visits cannot be cancelled:** `POST /appointments/:id/cancel` on a `status='completed'` row returns HTTP 400.
8. **DB state after cancel:** row remains in `appointments` with `status='cancelled'`, `cancelled_at` set, `cancelled_by` set.

## Data flow (summary)

**Today (broken):**

```
Admin clicks Cancel
  → DELETE /appointments/:id
  → row removed from DB
  → no email sent
  → walker shows up to cancelled visit
```

**After this change:**

```
Admin clicks Cancel
  → POST /appointments/:id/cancel
  → status='cancelled' (row preserved)
  → sendCancellationEmail(appt)
     → client email (METHOD:CANCEL ICS, same UID)
     → walker email (METHOD:CANCEL ICS, same UID, no client name)
     → owner email (METHOD:CANCEL ICS, both attendees, audit trail)
  → email_sends rows inserted with kind='appt_cancel' (per-recipient idempotency)
  → calendar grid hides the row (existing filter)
```

## Risk / rollback

- **Risk:** cancellation email goes out at 11 PM and wakes the walker. Mitigation: this is intentional (Q&A confirmed). No quiet-hours bypass-of-bypass needed.
- **Risk:** misclick cancels a real appointment and emails fire before admin notices. Mitigation: `confirmDialog` already gates the click. Rollback path = admin re-creates the appointment (existing flow) — emails communicate the re-add to client/walker.
- **Risk:** ICS UID mismatch leaves "ghost" events on recipient calendars. Mitigation: test #6 enforces UID identity with the original REQUEST.
- **Rollback:** revert the commit. The new DB columns are nullable, so leaving them in place after revert is harmless.

## Files touched

- `lib/email.js` — walker-row removal (single), walker intro rewrite (batch), new `sendCancellationEmail`.
- `lib/ics.js` — ensure `METHOD:CANCEL` + `SEQUENCE` are supported; reuse existing UID derivation.
- `routes/appointments.js` — new `POST /appointments/:id/cancel`, comment on `DELETE`.
- `public/js/views/calendar.js` — switch `cancelAppt` to POST cancel endpoint, update toast.
- `init-db.js` — `cancelled_at`, `cancelled_by` columns.
- `migrate-cancel-columns.js` — small one-shot migration script.
- `test/email-idempotency.test.js` (or `test/cancel-email.test.js`) — tests 1–8.
