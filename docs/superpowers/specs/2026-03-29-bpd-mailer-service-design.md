# BPD Mailer Service + Bark & Stroll Email Compose Feature

**Date:** 2026-03-29
**Status:** Approved

## Overview

A standalone mailer microservice owned by Bright Presence Digital that handles branded email sending and AI-powered email drafting for all BPD client portals. Bark & Stroll is client #1. Future clients onboard by registering their Gmail credentials and branded template — their portals call this shared service instead of handling email directly.

## Business Model

- BPD owns the Anthropic API key and the mailer infrastructure
- Clients never touch Anthropic or manage email logic — they call BPD's service
- Tiered pricing: Basic (no email/AI), Pro (email sending), Premium (email + AI drafting)
- AI tier controlled by a flag on the client record — one column flip to upgrade/downgrade

## Part 1: BPD Mailer Service

### Location & Stack

- **Path:** `/opt/bpd-mailer/`
- **Runtime:** Node.js + Express
- **Database:** SQLite (via better-sqlite3) at `/opt/bpd-mailer/data/mailer.db`
- **Dependencies:** express, better-sqlite3, nodemailer, @anthropic-ai/sdk, dotenv
- **Port:** 8090 (configurable via .env)

### Environment Variables (`.env`)

```
PORT=8090
ANTHROPIC_API_KEY=<BPD's key>
```

Gmail credentials are NOT in .env — they live in the `clients` database table per client.

### Database Schema

**`clients` table:**
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| slug | TEXT UNIQUE | Short identifier (e.g., "barkstroll", "gracechurch") |
| name | TEXT | Display name (e.g., "Bridgeville Bark & Stroll") |
| gmail_user | TEXT | Client's Gmail address |
| gmail_pass | TEXT | Client's Gmail App Password (plain text — acceptable for local SQLite on private server, same security model as .env files) |
| display_name | TEXT | From name on sent emails |
| api_key | TEXT UNIQUE | API key for this client's portal to authenticate |
| ai_enabled | INTEGER | 0 = no AI drafting, 1 = AI drafting enabled |
| created_at | TEXT | ISO timestamp |

**`templates` table:**
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| client_id | INTEGER FK | References clients.id |
| html | TEXT | Full branded HTML email template with `{{BODY}}` placeholder |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

**`email_log` table:**
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| client_id | INTEGER FK | References clients.id |
| recipient | TEXT | To email address |
| subject | TEXT | Email subject line |
| body_preview | TEXT | First 200 chars of the body text |
| sent_by | TEXT | Admin username who sent it |
| sent_at | TEXT | ISO timestamp |

### API Endpoints

All endpoints require `X-API-Key` header. The API key determines which client is making the request.

**`POST /api/send`**
- Body: `{ to, subject, body, sent_by }`
- Looks up client by API key → gets their Gmail creds and template
- Injects `body` into the client's HTML template at the `{{BODY}}` placeholder
- Sends via Nodemailer (Gmail SMTP, TLS on 587)
- Logs to `email_log`
- Anti-spam: before sending, checks `email_log` for recent sends to this recipient. If an email was sent to the same address within the last 10 minutes, returns 429 with a warning. Frontend shows this to the admin so they can override if intentional.
- Returns: `{ success: true, log_id }`

**`POST /api/draft`**
- Body: `{ prompt, context }` (context = client name, dog names, notes, etc.)
- Returns 403 if `ai_enabled = 0` for this client
- Sends prompt + context to Anthropic API, returns draft text
- Returns: `{ draft: "..." }`
- Model: claude-sonnet-4-6 (fast, cheap for drafts — not opus)

**`GET /api/log`**
- Query params: `?limit=50&offset=0`
- Returns sent email history for this client (determined by API key)
- Returns: `{ emails: [{ id, recipient, subject, body_preview, sent_by, sent_at }] }`

**`GET /api/log/:recipient`**
- Returns sent email history filtered by recipient email
- Used to show email history on a specific client's detail page

### Auth

Simple API key auth via `X-API-Key` header. Each client portal gets a unique key stored in the `clients` table. Middleware looks up the client, attaches `req.client` to the request. Invalid key = 401.

### Process Management

- Managed by systemd (like Bark & Stroll's server)
- Service file at `/etc/systemd/system/bpd-mailer.service`
- Restart=on-failure

## Part 2: Bark & Stroll Portal Integration

### Backend Changes (`/opt/barkstroll/`)

- Add `BPD_MAILER_URL` and `BPD_MAILER_API_KEY` to `.env`
- New route file `routes/email.js` with two proxy endpoints:
  - `POST /admin/api/email/send` — validates admin session, forwards to mailer service's `/api/send`
  - `POST /admin/api/email/draft` — validates admin session, forwards to mailer service's `/api/draft`
  - `GET /admin/api/email/log/:email` — validates admin session, forwards to mailer service's `/api/log/:recipient`
- These proxy endpoints exist so the frontend never calls the mailer service directly (no API key exposure in browser)

### Frontend Changes

**Client detail page (`js/views/customers.js`):**

- "Email" button added to the client action buttons
- Clicking opens a compose modal:
  - `To:` field — pre-filled with client email, editable
  - `Subject:` field — empty
  - `Body:` textarea — empty
  - "Help me write this" button:
    - Expands a prompt input: "What do you want to say?"
    - User types quick description
    - Hits `/admin/api/email/draft` with prompt + client context (name, dogs, notes)
    - Draft populates the body textarea
    - User edits freely before sending
  - "Send" button — POSTs to `/admin/api/email/send`
  - Toast confirmation on success
- "Email History" collapsible section below notes on client detail:
  - Shows sent emails (date, subject, preview) from `/admin/api/email/log/:email`
  - Collapsed by default, expandable

### What Does NOT Change

- Existing automated appointment/walker email system in `lib/email.js` — untouched
- The locked Bark & Stroll branded HTML template design — untouched (copied into mailer service's `templates` table as-is)
- Customer and walker portal — no email features, admin-only

## Part 3: Future Client Onboarding

When a new BPD client wants email:

1. Client provides Gmail address + generates App Password
2. Add row to mailer service `clients` table (slug, name, gmail creds, display name, api_key, ai_enabled flag)
3. Upload their branded HTML template to `templates` table
4. Add `BPD_MAILER_URL` and `BPD_MAILER_API_KEY` to their portal's .env
5. Wire their portal's admin routes to proxy through to the mailer service (same pattern as Bark & Stroll)
6. Done

## File Structure

```
/opt/bpd-mailer/
├── server.js              # Express app, middleware, starts server
├── init-db.js             # Schema creation + seed Bark & Stroll as client #1
├── .env                   # PORT, ANTHROPIC_API_KEY
├── data/
│   └── mailer.db          # SQLite database
├── lib/
│   ├── db.js              # Database connection
│   ├── auth.js            # API key middleware
│   ├── sender.js          # Nodemailer send + template injection
│   └── drafter.js         # Anthropic API draft generation
├── routes/
│   ├── send.js            # POST /api/send
│   ├── draft.js           # POST /api/draft
│   └── log.js             # GET /api/log
└── package.json
```
