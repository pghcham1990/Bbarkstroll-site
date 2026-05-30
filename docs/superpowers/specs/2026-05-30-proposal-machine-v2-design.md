# Proposal Machine v2 — Design Spec

**Date:** 2026-05-30
**Status:** Approved for planning
**App:** Bark & Stroll admin (`/opt/barkstroll/`), docgen feature
**Scope:** This spec = sub-project 1 of 3. (#2 send-to-client + intent capture, #3 job staffing → calendar are separate specs, built after.)

## Problem
The current docgen (`routes/documents.js` + `public/js/views/docgen.js`) produces proposals/invoices that:
1. **Sprawl to 2–3 pages** — the template CSS is very airy (40–52px padding, tall rows, stacked notes).
2. **Get visits wrong** — the AI invents/changes visits the user never asked for (e.g. a phantom morning visit), because it free-generates the whole document from a prose prompt.
3. **Aren't standardized** — no clean separation of "always branded/fixed" vs "the paid jobs that vary," so it's not reliably reusable across B&S and future businesses.

## Goals
- Compact, professional output that fits **1–2 pages max** for normal bookings, never 3.
- The proposal reflects **exactly** the visits the user specified — no invented/dropped visits.
- Everything standard/branded is fixed; only the actual paid jobs vary.
- Reusable engine (B&S now; future businesses later via the same structure).

## Decisions (locked with Scott)
- **Layout:** the compact "tightened" template (slim header, slim rows, notes + totals + payment side-by-side at the bottom). Standard for every doc.
- **Visit grouping = Hybrid:** default to **per-day rows** (each day shows its times + day subtotal); **auto-collapse** identical consecutive days into a smart range row **only when** the per-day list would overflow one page (threshold ~10 days). Special/non-standard days always break out as their own row. Short jobs stay transparent; long jobs stay one page.
- **Process = parsed-visit preview with fully editable rows:** after the user types the request, show an editable visit table (date · times · count · rate · line total) BEFORE rendering the full proposal. User can add/remove/edit any visit, then generate. This is the primary defense against AI errors.
- **Rate is an input field, default $25**, overridable per job. Totals always compute as rate × visit count in code (never AI-guessed).
- **AI role is narrowed:** the model only PARSES plain-English into structured visit data; it does not write final HTML or totals.

## Architecture

### Data flow
```
User types request  ─►  /documents/parse  ─►  structured visits[]  ─►  editable preview table
        (the human edits / fixes the rows here)                              │
                                                                             ▼
                                              user clicks Generate  ─►  render(visits, rate, client)  ─►  compact HTML preview
                                                                             │
                                                              Save & PDF  ─►  /documents/save (unchanged path)
```

### Visit data model (the one structured shape everything uses)
```js
// A "visit" = one care visit. A "day" groups visits on a date.
visit = { date: 'YYYY-MM-DD', time: '8:00 AM', label: 'Morning Visit' }
// derived per day: { date, visits:[...], dayTotal = visits.length * rate }
job = { client_id, rate: 25, visits: [ ...visit ], custom_note?: string }
```
Totals: `subtotal = visits.length * rate`, `tax = 0`, `total = subtotal`. Computed in code, always.

### Backend (`routes/documents.js`)
1. **New `POST /documents/parse`** — takes `{ prompt, rate }`, calls the AI with a **hardened parse-only prompt** (below), returns `{ visits: [...], warnings: [] }`. No HTML. The AI maps "the 16th is 3pm and 9pm, the 17th–21st are 8am/3pm/9pm" → explicit visit rows. It must NEVER add a visit not implied by the text; if ambiguous, it emits a `warning` instead of guessing.
2. **Rewrite the render function** to take structured `{ client, dogs, visits, rate, doc_type, custom_note }` (not AI HTML). It:
   - groups visits by day,
   - applies hybrid grouping (per-day; collapse identical consecutive days when day-count > threshold),
   - emits the compact template,
   - computes all money in code.
   Reuses `escHtml` / `escHtmlBr` (already present) for any text fields.
3. **`/documents/generate`** becomes a thin wrapper: parse → render, OR is replaced by the explicit parse-then-render flow. **`/documents/save` stays unchanged** (still takes final `html_content`, writes file + PDF + DB row).

### Hardened parse prompt (replaces `getSystemPrompt`)
- Output: JSON `{ visits: [{date, time, label}], warnings: [] }` only.
- Rules: emit ONLY visits explicitly stated or unambiguously implied; never pad a day to a "standard" count; never invent times; if a day's visit count/time is unclear, add a `warning` string and emit only what's certain; interpret natural language ("8am, 3pm and 9pm" → 3 visits that day); do not compute prices (code does).

### Frontend (`public/js/views/docgen.js`)
- After "Parse", render an **editable visit table**: columns date / time / label / (remove). "+ Add visit" row. A rate field (default 25). Live running total (visits × rate) shown.
- Any AI `warnings` shown as a yellow banner above the table.
- "Generate proposal" button → calls render with the (possibly edited) visits → shows the compact preview in the existing iframe.
- "Save & Generate PDF" unchanged.

### Compact template (CSS)
Replace the airy `INVOICE_CSS` blocks with the tightened scale from the approved mockup (`_proposal-mock-q7x2.html`): header ~16px padding, rows ~9px, billing row flex not 2-col-grid with 40px gap, notes+totals+payment in one bottom flex row. Keep the green/gold brand + Playfair/DM Sans fonts (those are "standard").

## Standard vs. variable (explicit)
- **Always standard:** header, logo, brand name, fonts, colors, contact line, "Proposed Services"/"Payment Due" badge, care-notes boilerplate, payment block, layout, grouping logic, $0 tax.
- **Per job (only variables):** client + pet(s), date range, visits (days/times/counts), rate, optional custom note.

## Testing
- Parse "the 16th is 3pm and 9pm, 17th through 21st are 8am 3pm and 9pm" → exactly 2 + 15 = 17 visits, no morning on the 16th. (The exact bug that started this.)
- Editable preview: remove a visit → total drops by `rate`; add one → rises. Generate reflects edits.
- Render: 6-day job (Cris, $25) → one page, per-day rows, total $425.
- Long job (e.g. 20 days, 3/day) → auto-collapses, still one page.
- XSS: a malicious label stays escaped in output.
- `/documents/save` still writes HTML + PDF + DB row; existing saved docs unaffected.
- B&S service restarts clean.

## Rollback
- All changes in `routes/documents.js` + `public/js/views/docgen.js` on branch master. Single commit per file; revert if needed. No DB schema change (uses existing `documents` table). Throwaway mockup `_proposal-mock-q7x2.html` deleted at cleanup.

## Out of scope (separate specs)
- #2: one-click send-to-client with Scott's note (Venmo-a-week-before, "still confirming dates", multi-person fit check) + intent capture.
- #3: job staffing (assign walkers to days/roles), fill-to-100% gating, one-click post-to-calendar, per-walker day/role notifications.
