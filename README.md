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
