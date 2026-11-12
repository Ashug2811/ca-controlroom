# CA ControlRoom (web app)

Team version of the single-file CA Daily Desk tool, renamed CA ControlRoom, for M/s. Malaji And Co.
Plain static site (no build step) + Supabase (free plan) for logins and shared data.

- `index.html`: every original tool, unchanged, plus login, Due-date calendar and Team tabs.
- `js/cloud.js`: login, firm membership, and syncing the original `ca.*` localStorage keys to the `kv` table (offline queue, live updates).
- `js/calendar.js`: month calendar, staff assignment, WhatsApp / email reminders, .ics export, automatic filing set-up.
- `js/extras.js`: extra due dates (ROC, LLP, CMP-08, GSTR-7, professional tax, 3CEB, SFT...).
- `js/team.js`: members, roles, invites, 90-day undo.
- `js/gst-plus.js`: GST reconciliation upgrade (multi-file, portal Excel/JSON, 2A, IMS, probable and remembered matches, supplier follow-up).
- `js/bank-plus.js`: Bank to Tally upgrade (PDF statements, learned ledgers, Tally ledger list check, Contra, .xml).
- `js/store.js`: per-record store (Supabase `records` table) for invoices, payments and time entries.
- `js/billing.js`, `js/work.js`, `js/inbox.js`: Billing, Time and work, Document inbox tabs.
- `upload.html`: the page clients open from their upload link (no login).
- `supabase/schema.sql`: tables and row-level security. Run it in the Supabase SQL editor.
- `config.js`: Supabase URL and anon key. Empty means "this device only" mode.
- `tools/build_from_original.py`: how `index.html` was produced from the original file.

Setup steps for the firm: see `SETUP.md`.
