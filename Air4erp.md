# Air4 Master Plan — Context Handoff

> **ไฟล์นี้คืออะไร / What this is**
> เอกสารส่งต่อบริบททั้งหมดของโปรเจกต์ Air4 Master Plan เอาไปวางในแชตใหม่ หรือส่งให้ dev คนอื่น
> เพื่อทำงานต่อได้เลยโดยไม่ต้องเล่าใหม่ตั้งแต่ต้น
>
> A complete context transfer for the Air4 Master Plan web application. Paste this into a
> new session or hand it to another developer to continue work without re-deriving anything.
>
> Written 17 Aug 2026. Reflects the state of the repository at that date.

---

## 1. What this project is

Air4 is a Thai company that manufactures and services car air-conditioning cleaning
machines. The company ran 1-on-1 meetings with every department and came out with **44
approved internal projects**. The long-term goal:

> 44 Approved Projects → Working Department Systems → Connected Data & Workflow → Air4
> Customized ERP / Business Operating System

This application is the **visual and interaction platform** for that transition. It is
explicitly *not* a task tracker. Its job is to answer, in one place and visually:

what projects exist, who owns each one, what state they are in, how far along they are,
what is due next, **which projects connect to each other, what data flows between them,
in which direction, and which of those connections a human has actually confirmed** —
plus where the gaps are.

### Requirements provenance

Two documents define scope:

- **V1** — "Air4 Integrated Business System Master Plan — Master Development Prompt V1".
  Referenced but **never present on this machine**. Its content is only known through V2.
- **V2** — "Requirement Update / Addendum V2", pasted into chat on 16 Aug 2026.
  **V2 takes precedence wherever the two conflict.** Section numbers cited throughout this
  file and in code comments (`§7`, `§32`…) refer to V2.

V2 is not stored in the repo. Its binding constraints are reproduced in §3 below. If you
have the original text, keep it — this summary is faithful but not a substitute.

---

## 2. Source data

**Google Sheet:** `1_W5tasUrIyqxUFwoJn1EZvYYd4s-tJvhZC5MmSX2ejc`

Two tabs were used:

- `สรุปโปรเจกต์หลังประชุม 1 on 1` — the 44 projects. Columns: ลำดับ, แผนก, ชื่อ Project,
  Priority, ผู้รับผิดชอบ, Brief เบื้องต้นจากที่ประชุม, สถานะ / Next Step, หมายเหตุ.
- `สารบัญรวมลิงก์ GROWS project ของแต่ละแผนก` — the official department directory
  (code, Thai name, department head).

The extracted data lives in `data/source/*.json` and is the input to the seed script. To
re-import a changed sheet, edit those files and reseed.

### Departments (12)

| Code | ชื่อแผนก | English | Head | Projects |
| --- | --- | --- | --- | --- |
| BD | แผนกพัฒนาธุรกิจใหม่ | Business Development | พี่ปิง | 3 |
| RQ | แผนกวิจัยและพัฒนาสินค้าใหม่ | R&D / New Product Development | พี่เอก | 4 |
| PM | แผนกผลิต | Production | พี่โอ๋ | 2 |
| PS | แผนกสต๊อกและจัดซื้อ | Stock & Procurement | พี่โย | 1 |
| SV | แผนกบริการ | Service | พี่เก๋ | 4 |
| CS | แผนกขายและการตลาด ลูกค้าช่องทาง OEM | Sales & Marketing — OEM | พี่นุ่น | 2 |
| AS | แผนกขายและการตลาด ลูกค้าช่องทาง B2B | Sales & Marketing — B2B | พี่ชัช | 2 |
| IO | แผนกขายและการตลาด ลูกค้าช่องทางต่างประเทศ | Sales & Marketing — International | พี่ต้น IO | 3 |
| B2C | แผนกขายและการตลาด ลูกค้าช่องทาง B2C | Sales & Marketing — B2C | พี่โอ๋ | 2 |
| AF | แผนกการเงินและบัญชี | Finance & Accounting | พี่แบด | 7 |
| PG | แผนกบุคคล | Human Resources | พี่หนึ่ง | 10 |
| IS | แผนกกราฟฟิค และ ไอที | Graphics & IT | พี่ต้น IS | 4 |

**Note:** the source sheet tagged two rows `CS1` and `CS2`. Both are sub-teams of `CS` and
were normalised to it; the original code is preserved in that project's `notes` field.

### Status mapping

The sheet used free Thai text. V2 §10 requires a controlled status list, and requires the
original Thai to be preserved rather than deleted. Both are stored:
`projects.status_id` (controlled) and `projects.status_original` (verbatim Thai).

| Sheet text | Mapped to | Count |
| --- | --- | --- |
| กำลังดำเนินการ | `DEVELOPING` | 2 (CS-001, IO-001) |
| ศึกษารายละเอียดก่อนเริ่ม | `PLANNING` | 42 |

Standard statuses: `NOT_STARTED`, `PLANNING`, `DEVELOPING`, `TESTING`, `LIVE`,
`INTEGRATED`, `BLOCKED`.

### Owners

`ผู้รับผิดชอบ` in the sheet are Thai nicknames. Each got a login account with a romanised
username: สุ่ย→`sui`, กิ๊ฟท์→`gift`, ปลั๊ก→`plug`, กระถิน→`kratin`, อ้อม→`aom`, มายด์→`mind`,
เปิ้ล→`ple`, ต๋อย→`toi`, ปิ๊ก→`pik`, แพร→`prae`, อาร์ท→`art`, อีฟ→`eve`, เจี๊ยบ→`jeab`,
เอ็กซ์→`ex`, เฟิร์ส→`first`, อ๊อฟ→`off`, วันใหม่→`wanmai`, การ์ตูน→`cartoon`, แตงโม→`tangmo`,
ขวัญ→`kwan`, แอน→`ann`, แก้ว→`kaew`, ฝน→`fon`, ส้อ→`sor`, เมย์→`may`, ปิง→`ping`, ออม→`oam`.

**Watch out:** อ้อม (PM) and ออม (BD) are two different people → `aom` and `oam`.

---

## 3. Binding constraints from V2

These are the rules a successor is most likely to break by accident. Each has a section
reference to the original addendum.

1. **No Google login** (§1). Air4 requires its own username + password accounts.
   Credentials must be hashed and stored **outside** Google Sheets.
2. **Google Sheets stays the business-data source of truth for MVP** (§28). This app holds
   a working copy. Long-term migration to a database is expected but not required for MVP.
3. **AI never auto-approves connections** (§12). Suggestions load as `AI_SUGGESTED` and
   only a human promotes them to architecture. Only `APPROVED` / `EDITED` count as
   confirmed Air4 architecture.
4. **Project IDs are permanent** (§3). Format `DEPT-###`, issued from the official
   department config. Never changes, survives renames, used for every relationship,
   permission, layout position and audit row. **Project names are never identifiers.**
5. **All 44 existing projects are Approved** (§4) — solid border. They are not backlog and
   not AI proposals.
6. **Future Add-ons use a dashed border** (§5) and must not be confused with status.
7. **Never overload one visual property with two meanings** (§32). See §6 below.
8. **Due dates are optional and flexible** (§8). A project may have no checkpoint, no final
   date, or both. Never force an artificial date to satisfy validation.
9. **"No connection found" ≠ "not yet reviewed"** (§22). These must stay distinguishable.
10. **Progress ≠ Data Completeness** (§36). Two separate numbers, never conflated.
11. **Owners cannot edit another owner's project** unless specifically granted (§2).
12. **Audit records are not editable by normal users** (§24).
13. **Warn about suspicious data rather than silently overwriting it** (§35).

---

## 4. Current state — what is built

**Priorities 1–4 of V2 §39 are complete and verified. Priority 5 is not started.**

Against the 13 MVP success criteria in V2 §40, twelve are answerable in the app today. The
thirteenth ("how is the complete system evolving toward Air4 ERP") is partly answerable —
the architecture is visible, but the gap analysis that names what is missing is Priority 5.

### Stack

| | |
| --- | --- |
| Framework | Next.js 16.3.1 (App Router, Turbopack), React 19.2 |
| Language | TypeScript 7.0 (`strict`) |
| Database | SQLite via `better-sqlite3` 13, file at `data/air4.db` |
| Auth | `bcryptjs` (cost 12) + `jose` HS256 JWT in an HttpOnly cookie, 8h |
| Diagram | `@xyflow/react` 12.11 |
| Styling | Tailwind v4 + hand-written CSS layer in `globals.css` |
| Dev port | 3400 |

Local machine: Windows 11, Node 24.16, npm 11.13. `npm audit` reports 0 vulnerabilities.

### Repository layout

```
Air4erp.md              this file
README.md               user-facing setup and reference
package.json            scripts: dev, build, start, seed, reseed, set-password, typecheck
next.config.ts          better-sqlite3 marked serverExternalPackages
.claude/launch.json     dev-server config for the Claude Code preview tool
.env.local              AUTH_SECRET — generated by seed, gitignored, never commit

data/
  source/
    departments.json    12 departments + 7 statuses + 7 connection types + status mapping
    projects.json       the 44 projects with assigned permanent IDs
    ai-connections.json 53 AI-proposed connections with reason + confidence
  air4.db               generated, gitignored

scripts/
  seed.mjs              builds the DB from data/source; validates before writing
  set-password.mjs      break-glass password reset (hidden prompt, not argv)

src/
  middleware.ts         auth gate on everything except /login and /api/auth/login
  lib/
    schema.sql          the whole database, portable SQL
    types.ts            shared domain types, mirrors the schema
    db.ts               singleton connection, cached on globalThis for dev reload
    session.ts          JWT sign/verify — edge-safe, no Node imports
    auth.ts             credential check, password policy, session helpers
    permissions.ts      the role model
    audit.ts            append-only history; recordFieldChanges diffs before/after
    validation.ts       guard rails (§35) + non-blocking warnings
    queries.ts          read models incl. governanceSummary()
    completeness.ts     data completeness checks (§36)
    layout.ts           sheet layout + graph traversal for upstream/downstream
    api.ts              route wrapper turning thrown errors into responses
  app/
    login/              sign-in page
    (app)/              page.tsx = Master Plan, governance/, audit/, users/
    api/                auth, master-plan, projects, connections, layout, users,
                        audit, governance
  components/
    AppShell.tsx        top rail, nav, mode switch
    ModeContext.tsx     VIEW / EDIT / PRESENT
    MasterPlan.tsx      the canvas — filters, selection, nodes, edges, persistence
    FilterRail.tsx      left controls (§19)
    TitleBlock.tsx      bottom-right legend, drawn as a drafting title block (§27)
    ProjectInspector.tsx    project detail + edit + incoming/outgoing (§18, §20)
    ConnectionInspector.tsx connection detail + approve/reject (§18)
    NewProjectDialog.tsx    add project / future add-on
    NewConnectionDialog.tsx draw a connection by hand (§13)
    GovernanceView.tsx  audit-readiness indicators (§36, §37)
    AuditView.tsx       change history (§23)
    UsersView.tsx       account management
    flow/
      ProjectNode.tsx   the project card (§33)
      ZoneNode.tsx      department container
      FlowEdge.tsx      the connection line + ArrowMarkers
      edgeGeometry.ts   floating-edge attachment maths
```

### Database

Tables: `departments`, `status_config`, `connection_types`, `users`, `user_projects`,
`projects`, `project_milestones`, `connections`, `audit_log`.

Current contents: 44 projects, 12 departments, 29 users (28 without a password), 53
connections (all `AI_SUGGESTED`), 136 audit rows.

Deliberate design choices worth preserving:

- `project_milestones` exists but is unused by the MVP. V2 §9 asks for one checkpoint now
  and multiple later; the table means that needs no migration.
- `user_projects` is a join table rather than a delimited `Linked_Project_IDs` column so
  grants are queryable and auditable one row at a time.
- Written in portable SQL. Moving to Postgres should be a driver change, not a redesign.
  Known SQLite-isms to fix on port: `AUTOINCREMENT`, `PRAGMA`, `COLLATE NOCASE`, and the
  `INSTR`/`SUBSTR` expressions used to sort by ID number.

### Roles

| | Admin | Owner | Viewer |
| --- | --- | --- | --- |
| View master plan | ✓ | ✓ | ✓ |
| Edit own projects | ✓ | ✓ | |
| Edit any project | ✓ | | |
| Propose connection | ✓ | ✓ (touching own project) | |
| Approve / reject connection | ✓ | | |
| Add projects, future add-ons | ✓ | | |
| Rearrange layout | ✓ | | |
| Manage accounts | ✓ | | |
| Read audit log | ✓ | | |

**Interpretation made during the build:** V2 §2 gives owners "Review relevant Connections"
but gives only admins "Approve AI-suggested Connections". This was read as: owners may
create and edit connections touching their own projects, but the approve/reject decision is
admin-only. An admin drawing a connection records it `APPROVED` immediately; an owner
proposing one records it `NOT_REVIEWED`. Editing an already-`APPROVED` connection moves it
to `EDITED` rather than silently leaving it approved.

---

## 5. The AI connection analysis

The initial architecture review required by V2 §38 was performed by reading all 44 project
briefs. It produced **53 proposed connections**, each with a plain-language reason and a
confidence level, stored in `data/source/ai-connections.json`.

Every one loads as `AI_SUGGESTED`, `proposed_by = AI_ANALYSIS`. **Nothing in that pass
modified official project data.** All 44 projects are marked `connection_review_status =
AI_REVIEWED`, which is meaningfully different from `NOT_REVIEWED` — the analysis covered
every project (§22).

Findings worth carrying forward:

- **`PG-005 Housekeeping Inspection System` has no connections at all.** That is a genuine
  finding, not a gap in the review. The governance page reports it as "isolated".
- **Possible duplicate work, flagged for human decision:**
  - `AF-001 POS System` vs `B2C-002 AirPro Frontend` — may be one system or two.
  - `AS-002 Sales Backend` and `AF-002 Stock Internal Audit` both claim Stock Card as
    theirs; likely shared master data rather than two copies.
- **The only bidirectional relationship** proposed is `PM-001 ↔ PS-001` ("PR & Lead Time")
  — purchase requisitions out, lead times back.
- Densest hubs: `AF-007 Management Budget Dashboard` (7 links) and `PG-010 Employee Data
  Hub`, `AF-002`, `AF-004`, `AF-006`, `AS-002` (4 each).

**As of this handoff, zero connections have been approved.** Every review decision is still
open and belongs to Air4.

---

## 6. Design system

The diagram is presented as an **engineering drawing sheet** — Air4 builds machines, so
that vocabulary belongs to them rather than a generic SaaS dashboard aesthetic.

The rule that holds it together:

> **Colour is reserved.** Hue carries exactly two meanings — department (card accent) and
> status (badge). Everything structural is achromatic ink at different line weights. With
> twelve department colours on one canvas, a third colour system turns the sheet to mud.

This is why connection *type* is not colour-coded: V2 §32 assigns type no visual property,
and type is conveyed by the label, the filter and the detail panel instead.

| Property | Meaning |
| --- | --- |
| Card accent bar | Department |
| Badge colour | Status |
| Scale + number | Progress 0–100% |
| Border style | Project type — solid = Approved, dashed = Future Add-on |
| Diagonal hatch | Blocked (so it reads across a meeting room) |
| Arrow | A connection |
| Arrowhead direction | Direction of flow; both ends = bidirectional |
| Edge label | What is transferred |
| Line style | Review state — solid confirmed, dashed AI suggested, dotted not reviewed |

Type: `Arial Narrow` for drafting annotation (uppercase, tracked), `Leelawadee UI` for body
and Thai, `Consolas` for IDs, dates and percentages. All system fonts — nothing is fetched,
so the app works offline. Thai renders correctly because `Leelawadee UI` leads the body
stack.

Signature element: the **title block** bottom-right. A real drawing title block holding
sheet metadata and the mandatory legend (§27). It draws real marks — an actual solid and
dashed card edge, a real arrow with a label on it — rather than describing them, so the key
and the diagram cannot drift apart. Collapses to a tab but never leaves the sheet.

Single light theme, deliberately — a drafting sheet is a light artifact, and Presentation
mode targets projectors.

---

## 7. Verification performed

A 51-check API suite was run across all three roles. 50 passed; the one "failure" was a
faulty assertion of mine, not a defect — `LOGIN_FAILED` rows legitimately have no username
because the identity is unknown.

Confirmed working:

- Wrong password, and an account with no password set, both return an identical message —
  responses cannot be used to enumerate accounts.
- Owner `aom` can edit exactly `PM-001`/`PM-002`, gets 403 on `AF-007`, 403 on admin-only
  fields, 403 on approving a connection, 403 on the audit log, 403 on creating projects.
- Viewers can edit nothing. Anonymous API requests get 401.
- Guard rails reject progress > 100, invented statuses, `31/12/2026` date format,
  self-connections, connections to non-existent projects, and any attempt to change a
  Project ID or department.
- Suspicious-but-legal combinations save **with a warning** ("Status is Not Started but
  progress is above 0%") rather than being blocked.
- Approve → `APPROVED` with reviewer recorded; reject → `REJECTED`; editing approved
  architecture → `EDITED`; owner proposal → `NOT_REVIEWED`.
- Duplicate-direction warning fires when a reverse connection already exists.
- Future add-on issued the correct next sequential ID (`AF-008`).
- `password_hash` never appears in any API response.
- Audit rows record `admin | UPDATE_PROGRESS | PM-001 | 40 → 0`.
- `npx tsc --noEmit` clean; `npm run build` succeeds; all 18 routes compile.

**Not visually verified.** Screenshots were impossible in this environment (see §8). The
diagram was verified structurally by driving React Flow's measurement manually: 44 cards,
12 zones, 53 edges with labels, correct solid/dashed line styles, dashed border on a future
add-on, and arrowheads at both ends of the bidirectional connection. It should be confirmed
by eye in a real browser.

---

## 8. Gotchas — read before debugging

1. **React Flow v12 renders zero edges until nodes are measured, and measurements arrive
   through `onNodesChange`.** An `onNodesChange` that only records drag positions and drops
   the rest leaves `nodesInitialized` permanently false, and the entire graph draws with no
   arrows *and no error message*. Node arrays must go through `useNodesState` so
   `applyNodeChanges` runs. `initialWidth`/`initialHeight` do **not** substitute. This cost
   hours; see the comment in `MasterPlan.tsx`.

2. **`ResizeObserver` does not fire in the Claude Code browser pane when the pane is not
   displayed**, so React Flow diagrams cannot be seen or screenshotted there. To verify
   anyway: reach the zustand store through the `.react-flow` element's React fiber and call
   `updateNodeInternals()` with a Map of `{id, nodeElement, force: true}` built from
   `.react-flow__node` elements. Use `get_page_text` / `javascript_tool` instead of
   screenshots.

3. **`npm run reseed` fails with `EPERM` on Windows while the dev server is running** — it
   holds the SQLite file open. Stop the server first. The script now explains this instead
   of dumping a stack trace.

4. **The LAN preview address changes with the network.** It was `192.168.1.89` then
   `192.168.11.123`. Read the `Network:` line that `npm run dev` prints; do not reuse an old
   IP.

5. **Next.js 16 deprecates the `middleware.ts` convention** in favour of `proxy.ts`. It
   still works and warns on boot. Migration is a file rename plus an export rename, or
   `npx @next/codemod@canary middleware-to-proxy .`. **Not yet done.**

6. **`tsconfig.json` is rewritten by the Next.js dev server** on boot (it reformats and adds
   `.next/dev/types`). Do not fight it.

---

## 9. Running it

```bash
npm install
```

```bash
npm run seed
```

```bash
npm run dev
```

Then <http://localhost:3400>.

`npm run seed` builds `data/air4.db` from `data/source/` and creates `.env.local` with a
fresh `AUTH_SECRET`. It refuses to overwrite an existing database; `npm run reseed` forces a
rebuild and **destroys all local edits and audit history**.

### Credentials — current state

- `admin` — the initial password was set via `AIR4_ADMIN_PASSWORD` at the last reseed. It was
  **redacted from this file before the repository was published**, because this document is
  committed to GitHub and a working credential must never be. The person who ran the seed has
  it; rotate it with `npm run set-password` and treat the original as compromised — it appeared
  in a chat transcript.
- All 28 other accounts (27 project owners + a shared `viewer`) exist with **no password
  and cannot sign in** until an admin sets one from the Users page. This is deliberate:
  bulk-created accounts should not be usable before someone hands over a credential.
- Break-glass: `npm run set-password` (prompts, does not take the password as an argument,
  so it stays out of shell history).

---

## 10. What is not built

Priority 5 of V2 §39, plus the write-back path. The data model and review workflow are in
place for all of it — what is missing is the analysis that fills them.

- **Re-running connection analysis from inside the app.** The initial pass is baked into
  `data/source/ai-connections.json`. V2 §21 wants an admin-triggered "Analyze Connections"
  action. There is no `/api/analyze` route yet; it would need an Anthropic API key and
  should write results as `AI_SUGGESTED` exactly as the seed does.
- **Gap analysis** (§31) proposing new Future Add-ons — missing processes, duplicate
  workflows, manual handovers, missing dashboards. Should create dashed projects awaiting
  human approval.
- **Duplicate-data detection** beyond the two cases flagged by hand in §5 above.
- **Writing approved updates back to Google Sheets** (§28). The app currently reads the
  sheet at seed time only, so edits made in the app do not flow back. For a review tool
  this is fine; for daily operation it is the next real gap. Needs a Sheets API service
  account and a decision about which direction wins on conflict.
- **Multiple checkpoints per project** (§9). The `project_milestones` table exists; the UI
  uses the single checkpoint field.
- **`middleware.ts` → `proxy.ts`** migration (see §8.5).

### Deployment

The app is not deployed. It runs locally and on the LAN only. Options discussed:

- **Always-on office machine** — zero code changes, already serves the LAN, invisible
  outside the office.
- **Railway / Render / Fly** *(recommended)* — SQLite works as-is on a persistent volume;
  mostly configuration; gives a permanent URL.
- **Vercel + Neon/Supabase Postgres** — Vercel's filesystem is read-only so SQLite cannot
  come along; requires porting the schema. More work, but the eventual path if Air4 outgrows
  a single server.

Any of these needs the customer to create the account first.

---

## 11. Suggested next steps

1. Open the app in a real browser and confirm the sheet looks right — this is the one thing
   claimed on inference rather than sight.
2. Change the admin password.
3. Set passwords for the project owners who will actually use it, starting with the heads
   of AF and PG (the two densest departments).
4. Walk an admin through reviewing the 53 AI suggestions. That single pass converts the
   diagram from "proposed" to "confirmed architecture" and is the highest-value action
   available today.
5. Fill in Data Owner and System Owner — currently blank on all 44 projects and the largest
   single drag on data completeness (§30).
6. Decide the deployment target.
7. Then, and only then, build Priority 5. V2 §39 is explicit: do not jump to AI features
   before the basic data and visual system is stable.
