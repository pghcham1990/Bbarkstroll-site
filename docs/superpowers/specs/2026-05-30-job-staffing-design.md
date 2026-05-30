# Job Staffing — Design Spec

**Date:** 2026-05-30
**Status:** Approved for planning
**App:** Bark & Stroll admin (`/opt/barkstroll/`)
**Scope:** Sub-project #3 of the Proposal Machine pipeline. (#1 Proposal Machine v2 = LIVE. #2 send-to-client = done ad-hoc for Cris. This = turning a saved proposal into a staffed, calendar-posted job.)

## Problem
A saved proposal (e.g. Cris O'Connor, #BBS-2026-0716, Jul 16–21, 17 visits, $425) describes the work but has no way to staff it. Scott needs to assign a walker to each day, track how full the job is, work it over days/weeks while chasing coverage, and — only when fully staffed and he approves — create the real appointments, notify walkers, and post to the calendar. Today none of that exists; appointments are created one-off with no link to a proposal and no fill tracking.

## Goals
- Turn a saved proposal into an assignable **job** in one click.
- Assign a walker **per day** (whole-day), with a quick **bulk "assign one walker to all open days."**
- See **fill progress** (X of N days filled) at a glance.
- **Drafts persist forever** — reopen the client later and pick up where you left off. Never auto-expire or delete a draft job.
- **Post only when 100% filled AND Scott explicitly clicks Post.** Posting creates appointments, sends ICS, and produces a walker summary **to Scott only** (he forwards to walkers).
- Reusable for any customer, not just Cris.

## Decisions (locked with Scott)
- **Job source:** a "Staff this job" button on a saved proposal (on the customer card). Re-clicking opens the existing job, never duplicates.
- **Visit data:** stored as structured JSON on the proposal (new `documents.visits_json` column), written when a proposal is generated. Cris's existing proposal is backfilled.
- **Assign unit:** WHOLE DAY. One `job_assignments` row per day; `employee_id` null = open.
- **Bulk assign:** a control to assign a chosen walker to ALL open days at once (e.g. Tiffany → all 6, or Scott → all). Per-day dropdown overrides afterward.
- **Post gate:** the Post button is disabled until every day has a walker. Posting requires Scott's explicit click. Nothing fires before that.
- **Walker notification:** on Post, generate ONE assignment summary delivered to **Scott only** (per-walker breakdown of day/times/dog/address). Scott forwards to walkers via text. No direct walker emails (walkers route through Scott — 412-992-1480).
- **Google Calendar:** Post creates in-system appointments (portal calendar view) + sends batched ICS. The barkstroll Google Calendar push is done via the `/mcp` connector by Claude/Scott (no server-side GCal API). Post records that GCal sync is pending so it's visible.
- **Job home:** a Job panel on the customer's detail card (not a separate tab).
- **Conflict check:** when assigning a walker already booked at an overlapping time (any customer), show a soft warning but still allow the assignment (visible-default-over-hard-gate).
- **Service type:** appointments created as **Custom Care** (service id 5).

## Architecture

### Data model
**Migration — add to `documents`:**
- `visits_json TEXT` — JSON array `[{date:'YYYY-MM-DD', time:'8:00 AM', label:'Morning Visit'}]`. Populated on proposal generation; nullable for old rows. Cris's row (#BBS-2026-0716) backfilled with her 17 visits.

**New table `jobs`:**
- `id INTEGER PK`
- `customer_id INTEGER NOT NULL`
- `document_id INTEGER NOT NULL` (the proposal it was staffed from)
- `status TEXT NOT NULL DEFAULT 'draft'` — `'draft' | 'posted'`
- `gcal_synced INTEGER NOT NULL DEFAULT 0`
- `created_at TEXT`, `updated_at TEXT`

**New table `job_assignments`:**
- `id INTEGER PK`
- `job_id INTEGER NOT NULL`
- `date TEXT NOT NULL` (`YYYY-MM-DD`)
- `employee_id INTEGER` (nullable — null = open)
- `created_at TEXT`, `updated_at TEXT`
- One row per distinct date in the proposal's visits. The day's individual visit times stay derived from `documents.visits_json` (the assignment only records who owns the day).

### Backend (new `routes/jobs.js`, mounted under `/admin/api` with `requireRole('admin')`)
- `POST /jobs` `{customer_id, document_id}` — create job + one assignment row per distinct date from the proposal's `visits_json`. If a job already exists for that `document_id`, return it (idempotent). Returns job + assignments + the per-day visit breakdown.
- `GET /jobs/by-document/:documentId` — fetch the job (if any) for a proposal, with assignments + visit breakdown + fill status + per-day conflict flags.
- `GET /jobs/:id` — same shape, by job id.
- `PATCH /jobs/:id/assignments` `{date, employee_id|null}` — set/clear one day's walker (live save). Recomputes conflicts.
- `POST /jobs/:id/assign-all` `{employee_id}` — assign that walker to all currently-OPEN days (does not overwrite already-assigned days).
- `POST /jobs/:id/post` — guard: 400 unless all days assigned. Creates one appointment PER VISIT (visit times from `visits_json`, walker = that day's assignment, service = Custom Care, batched via a shared `batch_id`), reusing the existing appointments insert + ICS/email path. Sets `jobs.status='posted'`. Builds and returns the **walker summary** (grouped by walker) and triggers the existing batched-ICS send. Marks `gcal_synced=0` (pending connector push).
- Conflict detection: for a candidate `(employee_id, date)`, look for existing `appointments` for that employee whose `start_time` falls on that date with status `scheduled`/`completed`; flag overlaps. Pure helper, unit-testable.

### Frontend (`public/js/views/` — Job panel on the customer card)
- A "Staff this job" button on each saved proposal in the customer's documents list → creates/opens the job, renders the Job panel.
- **Job panel:** header with fill meter (`X of N days · NN%`); a **bulk assign** control ("Assign all open days to [walker ▾]"); a day grid — one row per day showing the date, that day's visit times (from the breakdown), a walker `<select>` (live-saves on change via PATCH), and a ✓/⚠ status (⚠ = conflict warning with tooltip).
- **Post job** button: disabled until 100%. On click → confirm → POST `/jobs/:id/post` → show the returned walker summary in a copy-friendly block (for Scott to forward) + a note that GCal sync is pending.
- **Posted state:** panel shows "Posted ✓", links to the created appointments, grid becomes read-only. Post-posting edits go through the normal calendar/cancel flow, not re-posting.

### Money / totals
No money logic here — that lives in the proposal. The job is purely scheduling/staffing.

## Standard vs. variable
- **Standard:** whole-day assignment model, fill-to-100% gate, summary-to-Scott notification, Custom Care service, draft persistence, conflict-warn behavior.
- **Per job:** the customer, the proposal/visits, which walker is on which day.

## Testing
- Migration adds `visits_json`, `jobs`, `job_assignments` without disturbing existing data; Cris's proposal backfilled with 17 visits across 6 dates.
- `POST /jobs` from Cris's proposal creates 6 day-rows (Jul 16–21), all open; re-POST returns the same job (no dupes).
- `PATCH assignments` sets/clears a day; fill status recomputes (3/6 → 50%).
- `assign-all` fills only open days, leaves already-assigned days untouched.
- Conflict helper: a walker with an overlapping appointment on that date is flagged; non-overlap is not.
- `POST /jobs/:id/post` is rejected at <100%; at 100% it creates 17 appointments (correct per-day walker, Custom Care, shared batch_id), flips status to posted, and returns a walker summary grouped by walker (Tiffany: Jul 16…; Scott: Jul 18, Jul 19…).
- Posting twice is guarded (no double appointments).
- B&S service restarts clean; existing appointment/calendar flows unaffected.

## Rollback
- Additive migration (new column + two tables); no destructive changes. New `routes/jobs.js` + new frontend panel; existing routes untouched. Drop the tables/column to fully revert. Branch master, commit per task.

## Out of scope (future)
- Cross-customer "Jobs" tab (panel-on-card now; tab later if multiple concurrent jobs warrant it).
- Server-side Google Calendar API (connector push stays manual via `/mcp`).
- Per-visit (sub-day) assignment — only if a real need appears; whole-day is the model.
- Direct walker emails — walkers route through Scott.
