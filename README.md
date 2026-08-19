# Air4 Master Plan

The Air4 Integrated Business System master plan, built to Addendum V2.

44 approved projects across 12 departments, the connections between them, and the
governance record that shows which of those connections a human has actually
confirmed.

---

## Running it

```bash
npm install
```

```bash
npm run seed
```

```bash
npm run dev
```

Then open <http://localhost:3400>.

`npm run seed` builds `data/air4.db` from `data/source/*.json` and creates
`.env.local` with a fresh `AUTH_SECRET`. It refuses to run twice — use
`npm run reseed` to rebuild from scratch, which **deletes all local edits and
audit history**. Stop the dev server first; the database file cannot be replaced
while it is open.

### Signing in

The admin password is whatever `AIR4_ADMIN_PASSWORD` was set to at seed time, or
a random one printed once by the seed script. **Change it after the first
sign-in** from the Users page.

Every other account — one per ผู้รับผิดชอบ in the source sheet, plus a shared
`viewer` account — is created **without a password and cannot sign in** until an
admin sets one from the Users page. That is deliberate: bulk-created accounts
should not be usable until someone has handed over a credential.

If nobody can sign in as an admin:

```bash
npm run set-password
```

---

## How the data is organised

**Google Sheets remains the business-data source of truth for now.** This
application holds a working copy plus the things a sheet cannot hold safely:
credentials, an append-only audit log, and reviewed relationships.

| Table | Holds |
| --- | --- |
| `departments`, `status_config`, `connection_types` | Controlled configuration. Status is never free text. |
| `users`, `user_projects` | Accounts and per-project grants. `password_hash` only — never a plain password, and never in the sheet. |
| `projects` | The 44 approved projects. `project_id` is permanent. |
| `project_milestones` | Unused by the MVP; present so multiple checkpoints need no migration. |
| `connections` | Directional relationships with a label and a review state. |
| `audit_log` | Append-only. The app exposes no route that updates or deletes a row. |

The schema is in [`src/lib/schema.sql`](src/lib/schema.sql) and is written in
portable SQL, so moving from SQLite to Postgres is a driver change rather than a
redesign.

### Project IDs

`DEPT-###`, issued from the official department configuration — `PM-001`,
`AF-007`, `PG-010`. An ID is permanent, survives renames, and is the key used for
every connection, permission, layout position and audit row. Project names are
never used as identifiers.

The source sheet tagged two rows `CS1` and `CS2`; both are sub-teams of `CS` and
are normalised to it, with the original code kept in the project's notes.

### Status

The seven standard statuses live in `status_config`. The original Thai text from
the sheet is preserved on every project in `status_original` and is shown in the
project panel — it is mapped, never deleted.

| Sheet | Standard |
| --- | --- |
| กำลังดำเนินการ | Developing |
| ศึกษารายละเอียดก่อนเริ่ม | Planning |

---

## The AI suggestions

The seed loads 53 proposed connections derived from the wording of the project
briefs, each with a reason and a confidence level. **They are suggestions, not
architecture.** Every one loads as `AI_SUGGESTED` and only an admin can approve
or reject it. Nothing in that pass modified official project data.

Every project is marked `AI_REVIEWED`, which is meaningfully different from
`NOT_REVIEWED`: the analysis covered all 44. `PG-005 Housekeeping Inspection
System` came back with no connections at all — that is a finding, not a gap in
the review, and the governance page separates the two.

Two suggestions are flagged as possible duplicate work rather than data flow:

- `AF-001 POS System` and `B2C-002 AirPro Frontend` may be one system or two.
- `AS-002 Sales Backend` and `AF-002 Stock Internal Audit` both claim Stock Card.

Suggestions live in [`data/source/ai-connections.json`](data/source/ai-connections.json)
and can be edited before seeding.

---

## Visual grammar

Each property carries exactly one meaning, and never two.

| Property | Means |
| --- | --- |
| Card accent colour | Department |
| Badge colour | Status |
| Scale + number | Progress, 0–100% |
| Border style | Project type — solid is approved, dashed is a future add-on |
| Diagonal hatch | Blocked |
| Arrow | A connection |
| Arrowhead direction | Which way information flows; both ends means both ways |
| Edge label | What is transferred |
| Line style | Review state — solid confirmed, dashed AI suggested, dotted not reviewed |

Colour is reserved for department and status alone. Everything structural is ink
at different line weights, because twelve department colours on one sheet leave no
room for a third colour system.

The legend lives in the title block at the bottom right of the sheet. It draws
real marks rather than describing them.

---

## Roles

| | Admin | Project owner | Viewer |
| --- | --- | --- | --- |
| View the master plan | ✓ | ✓ | ✓ |
| Edit their own projects | ✓ | ✓ | |
| Edit any project | ✓ | | |
| Propose a connection | ✓ | ✓ (touching their project) | |
| Approve or reject a connection | ✓ | | |
| Add projects and future add-ons | ✓ | | |
| Rearrange the sheet | ✓ | | |
| Manage accounts | ✓ | | |
| Read the audit log | ✓ | | |

An owner cannot touch another owner's project unless an admin grants it, which is
a row in `user_projects`.

---

## Modes

**View** is the default and changes nothing. **Edit** must be chosen explicitly
and stamps a hazard rail across the top of the window so it is never ambiguous in
a meeting. **Present** hides the navigation, filters and every editing control
for projector use; Esc leaves it.

---

## Progress vs data completeness

Two different numbers, deliberately kept apart.

- **Progress** — how far the work has got. Owner-reported, 0–100%.
- **Data completeness** — how much we know about the project: owner, data owner,
  system owner, due date, objective, whether its connections have been reviewed,
  whether it has been updated in the last 90 days. Computed, not entered.

A project can be 80% built and 36% documented. The governance page ranks by the
second.

---

## Layout

```
src/
  app/
    (app)/           master plan, governance, audit, users
    api/             auth, projects, connections, layout, users, audit, governance
    login/
  components/
    flow/            project card, department zone, connection edge
  lib/
    schema.sql       the database
    auth.ts          credential checking, password policy
    session.ts       signed cookie, edge-safe
    permissions.ts   the role model
    audit.ts         append-only change history
    validation.ts    guard rails
    layout.ts        sheet layout and graph traversal
data/
  source/            the imported sheet — edit these, then reseed
  air4.db            generated, gitignored
scripts/
  seed.mjs
  set-password.mjs
```

---

## Not built yet

Priority 5 of the development plan. The data model and review workflow are in
place for all of it; what is missing is the analysis that fills them.

- Re-running connection analysis on demand from inside the app. The initial pass
  is baked into the seed file.
- Gap analysis proposing new future add-ons.
- Duplicate-data detection beyond the two cases already flagged by hand.
- Writing approved updates back to Google Sheets. The app currently reads the
  sheet at seed time only.
- Multiple checkpoints per project. The table exists; the UI uses one.

## Google Sheet sync

The company project sheet is the source of truth for source data. The database
is a working copy that keeps everything Air4 decides in the app. Sync moves the
first into the second without ever rebuilding it — `npm run reseed` is a
first-setup tool, never a sync mechanism, and it destroys local history.

**Sheet:** `1zby_FYFWKHXDLP5Q6Z74XD3A7Onpxvs7zsuuV-5kc-0`, tab `สรุปโปรเจค` (gid `1327666860`).

### What each side owns

| The sheet owns | The app owns — never overwritten by a sync |
| --- | --- |
| Project name | Permanent Project ID |
| Priority | Progress |
| Owner (ผู้รับผิดชอบ) | Checkpoint and final due date |
| Brief | Data owner, system owner |
| Status text (`status_original`) | Project type / future add-on |
| Notes | Connections and their review state |
| Source department | Layout position |
| | Audit log, data completeness, governance fields |

### How a row finds its project

Names are never identifiers. Matching runs in two passes — unique name first
(survives reordering), then `source_seq` (survives a rename). A row that matches
neither is genuinely new; a project that matches neither has genuinely lost its
row. Neither is acted on automatically.

### What it refuses to do

- **Unmapped status** — keeps the original Thai text, leaves `status_id` alone, warns.
- **Department change** — critical conflict. The Project ID encodes the department,
  so nothing on that project is applied until a human decides.
- **New row** — held as `NEW_SOURCE_PROJECT`. No project, no ID, no approval.
- **Missing row** — flagged `SOURCE_MISSING`. Never deleted, never archived;
  connections, progress and audit stay intact.
- **Unknown owner** — stored as metadata and warned about. No account is created.
- **Nothing changed** — no write, no audit row.

### Using it

- **Master Plan → `↻ Sync Sheet`** — fetch, compare, apply safe updates, refresh
  the canvas. Admin only.
- **`/sync`** — the full console: preview before applying, and the conflict list.
  Not in the top nav; reach it by URL.
- **Automatic** — 08:30 Asia/Bangkok daily, via
  `.github/workflows/daily-sheet-sync.yml` calling
  `POST /api/sync/google-sheet/auto`. GitHub cron is UTC-only, so the schedule is
  `30 1 * * *` (08:30 − 7h). Thailand has no daylight saving, so it holds year round.

### Google authentication

Two options. The Apps Script route is simpler and is what production uses.

**Apps Script web app (recommended).** A script bound to the spreadsheet returns
the tab as JSON and runs as the sheet owner, so there is no Google Cloud project,
no service account and no private key to store. Follow the setup comment in
`docs/apps-script/Code.gs`, then set:

```
AIR4_SHEET_WEBAPP_URL=https://script.google.com/macros/s/.../exec
AIR4_SHEET_WEBAPP_TOKEN=<your own random string, matching the script>
```

The web app is deployed with access set to "Anyone", so the token is what keeps
it private — it refuses any request without a match.

**Service account (alternative).**

Set in `.env.local` (see `.env.example`). Create a service account, enable the
Google Sheets API, then **share the spreadsheet with the service-account address
as a Viewer** — read-only is all the app requests.

```
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

`AIR4_SHEET_FIXTURE=data/fixtures/sheet-current.tsv` reads a local snapshot
instead of the network — for offline development and the test suite.

### Testing

```bash
npm run test:sync
```

122 checks against a **copy** of `data/air4.db`, driven through the real HTTP API.
The live database is never written to. Covers every scenario above plus the
scheduled endpoint's bearer check.

## Schema changes

`src/lib/schema.sql` only describes a fresh seed. An existing `data/air4.db` is
migrated by `src/lib/migrations.ts`, which runs automatically when the app opens
the database and is additive and idempotent. Add any new column or table to
**both**. To migrate deliberately, with a timestamped backup first:

```bash
npm run migrate
```

## Deployment

`better-sqlite3` writes to a file, so the host must give the app **persistent
disk**. A platform with an ephemeral filesystem loses every connection review,
progress value and audit row on each redeploy. Railway, Render and Fly all offer
a persistent volume; Vercel does not, and would require porting to Postgres
first.

Production environment variables:

```
AUTH_SECRET
GOOGLE_SPREADSHEET_ID
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
SYNC_CRON_SECRET
```

And as GitHub repository secrets, for the scheduled sync:

```
PRODUCTION_URL
SYNC_CRON_SECRET
```
