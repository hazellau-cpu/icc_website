# ICC Control Room deployment

The production deployment serves the frontend and API from one Cloud Run service. Google Cloud IAP protects the website and API; the application does not issue browser login tokens in IAP mode. The service reads roster and lesson progress from the shared Google Sheet and Calendar events with its attached runtime service account. Shared dashboard edits can use a separate Google Sheet or the existing Cloud SQL backend. Do not deploy the local workspace file or credentials.

## Local run

Requires Node.js 20+:

```bash
cd backend
DB_USER='icc_app' DB_PASSWORD='replace-this-secret' DB_NAME='icc' DB_HOST='127.0.0.1' JWT_SECRET='at-least-32-random-characters-here' CORS_ORIGIN='http://localhost:8000' npm start
```

The server listens on `PORT` (default `8080`).

Local preview mode at `localhost:8000` is not protected by sign-in and reads local workspace data without authentication. An optional `ICC_LOCAL_DEMO_LOGIN` setting provides a browser-only demo screen on localhost, using the ignored `secrets/local-demo-auth.json` file with `emails` and `password` fields. It is not security: the configuration, local data, and session can be accessed or bypassed by anyone with access to the local server. Never use real passwords in this file. The Cloud Run image does not include this file.

For an optional local Google sign-in trial, set `ICC_LOCAL_GOOGLE_SIGN_IN` and `ICC_LOCAL_DEMO_LOGIN` to true, configure ignored `secrets/local-google-auth.json` with the OAuth web `clientId` and exact approved `emails`, and run `node backend/local-google-auth-server.js`. Add `http://localhost:8000` as an authorised JavaScript origin to the Google client and add approved users as test users while the OAuth app is in testing mode. The helper verifies Google ID tokens and approved, verified email addresses, but the resulting browser session and local data are not protected against bypass; the existing demo password remains available. This trial is localhost-only and is not part of the production IAP flow.

Local student profiles can record Robot, Coding, and Math pathways in browser storage, separately from the read-only Sheet. These records are browser-specific and included in workspace exports, but are not shared or automatically imported on another device. Changing a Robot or Coding programme starts a new path; old tracker records and lessons remain available. Because the Sheet lacks reliable programme labels, lessons dated after the change date are assumed to belong to the new path; lessons on the change date remain in history. The Robot checklist still reflects the previous pathway and must be reviewed separately.

For the local preview, `workspace-db.json` may also contain private `robotPathwayReviews` and `robotProgressReviews` arrays for explicitly confirmed corrections. These are scoped to a student and programme; a later dated lesson takes precedence over a reviewed status. They do not update the Google Sheet or production backend, and rebuilding the local dataset must preserve them separately.
An older unmatched lesson is accounted for when exactly one same-student, same-programme robot review (including its confirmed display name) covers it and applies to the current sequence; the lesson remains in history. Unknown statuses, ambiguous matches and lessons newer than the review still require attention.

The starter Sheet snapshot is a one-time local import, not a live connection. Robots absent from the source can have an `Unknown` status rather than being assumed unfinished; unmatched entries are retained separately.
For local Robot birth-year sync, set `localStarterDemographics` to `true` in the ignored `workspace-db.json`, configure the ignored `secrets/local-starter-sheet.json` with `spreadsheetId`, `serviceAccount`, and the `account` allowed to impersonate it, then run `node local-starter-sheet-server.js`. Share the private starter Sheet with that service account as Viewer. The loopback reader uses the read-only Sheets scope, imports only student IDs and birth years, and refreshes on page load. Conflicting or invalid entries are reported rather than guessed. For Cloud Run, set `STARTER_SHEET_SPREADSHEET_ID` and share the starter Sheet with the attached runtime service account as Viewer. The backend imports birth years during the authenticated bootstrap when the Google Sheets source is enabled.
An explicitly reviewed student-specific `robotSequence` may retain that student's Sheet sequence instead of the shared library sequence. A later pathway change takes precedence.
An optional `hidePreviousTrackerProgress` flag on a local pathway review hides that student's previous tracker table without deleting the saved records.

Private `localRobotProgressRemovals` entries apply explicitly approved, student- and programme-specific tracker deletions once per browser. An optional legacy match identifies older generated records by student name, level, and an explicit robot list when the programme ID is missing. They leave lesson history and checklists unchanged and do not delete data from the Sheet or a remote database.

In ROBOKIT Lv3, CannoBot and GunBot refer to the same robot. The preview retains progress under either name; Rolling Bot and FutureBot records remain separately visible rather than being assigned to FrogBot. Ambiguous duplicate records require review.

In AIKIRO Lv1 additional, Robot Fighter and Robot Wrestler refer to the same robot. The preview retains progress under either name; Frog Bot is not assumed to be Flag Bot, and its saved records remain separate.

For localhost testing, `ICC_LOCAL_LIVE_SHEETS` uses the loopback reader `node local-starter-sheet-server.js`. Configure the ignored `secrets/local-sheets.json` (`spreadsheetId`) and `secrets/local-starter-sheet.json` (`serviceAccount` and the `account` permitted to impersonate it), and share the automation Sheet with the service account as Viewer. The reader reads the four tabs using the read-only Sheets scope and never writes to the Sheet. The production backend reads server-side using Google Application Default Credentials from its attached runtime service account. Reload local preview to refresh; local component edits remain browser-specific. Existing link-sharing settings are not changed automatically.

The live Sheet roster includes every student except those whose Paid Status is `Inactive` (case-insensitive). Other values, including blank or `Payment Due`, remain unchanged and do not exclude the student. The local dataset's `includeWhenUnpaid` preserves an existing Robot student's local roster link but does not override `Inactive`. A `localBorrowingResetVersion` in the local dataset clears older browser-local borrowing records once per browser; new local borrowing entries are saved normally afterward. Neither mechanism changes a Sheet or a remote database.

CodeCombat students are included as Coding students. CodeCombat Lv1 maps to CS1, Lv2 to CS2, and so on. When the Sheet only says CodeCombat, select the student's level in the local pathway editor; the preview does not infer it. Selecting a different pathway starts a new path, so earlier lessons remain in history.

For local Calendar testing, configure the ignored `secrets/local-calendar.json` with `calendarId` and `serviceAccount`, sign in to `gcloud` as an account permitted to impersonate that reader, and run `node local-calendar-server.js` from the repository root. Share the private calendar with that service account using “See all event details.” The reader binds to loopback port 8787, reads events using the Calendar events read-only scope, and never modifies the calendar. `ICC_LOCAL_CALENDAR` enables the localhost-only Today’s Students view. Production calendar reads use the Cloud Run runtime service account and the same read-only scope; set `GOOGLE_CALENDAR_ID` and grant that identity access to the calendar.

## Provision password accounts

Apply [20261111-password-auth.sql](migrations/20261111-password-auth.sql) once to the database, including new installations. In a private interactive terminal with the database connection settings configured, run `node set-password.js ACCOUNT_EMAIL` from `backend/` once per approved account. Enter a different strong password of at least 16 characters for each account when prompted; input is hidden. Do not pass passwords as command arguments, store them in environment variables, or share them in chat. Running the command again resets that account's password and invalidates its active sessions. Provision only approved accounts; there is no public registration or email-based reset.

Passwords are salted and hashed using scrypt, not stored in plaintext. Failed sign-ins are rate limited in shared database buckets for 15 minutes; unrelated addresses can collide in a bucket. This is not a replacement for edge rate limiting, MFA, monitoring, backups, or an account recovery procedure. Before making the service public, configure an edge/WAF rate limit for `/auth/password`, keep the database private, require HTTPS and audit access. The scrypt settings require significant memory per concurrent authentication; limit Cloud Run concurrency and provision adequate memory. Test the deployment under load.

## James Sheets read API

James can obtain a separate read-only JWT with `POST /api/sheets/token`, using the provisioned `SHEETS_READ_CLIENT_ID` and `SHEETS_READ_CLIENT_SECRET` in a JSON body. The token is signed with `SHEETS_READ_JWT_SECRET`, carries `iss=icc`, `aud=icc-sheets-read`, `scope=sheets:read`, and expires in 60 minutes by default (maximum 60). Keep all three secrets server-side; do not put the client secret or JWT in browser code or a URL. The client secret must be at least 32 characters, as must the signing secret.

The resulting bearer token can call:

```text
GET /api/sheets/students?student_id=ST001&student_name=Demo%20Student
GET /api/sheets/progress/latest?student_id=ST001&student_name=Demo%20Student
```

Both endpoints return `sheet_name`, `columns`, `rows` (`row_number` plus string `values`), and `pagination`. Names and IDs must identify the same student. `limit` defaults to 100 and is capped at 500; `offset` defaults to 0. Progress is reduced to the latest row per course type by date, lesson start time, then source row number. `Progress Percent` is passed through from the imported source value and is blank when the source does not contain it.

Configure `SHEETS_READ_JWT_SECRET`, `SHEETS_READ_CLIENT_ID`, and `SHEETS_READ_CLIENT_SECRET` on Cloud Run using Secret Manager, and optionally set `SHEETS_READ_ALLOWED_ORIGINS` to a JSON array or comma-separated list of exact browser origins. The website sign-in JWT is separate and does not grant the partner Sheets scope. For new databases, apply the updated [cloud-sql-schema.sql](../cloud-sql-schema.sql). For an existing database, apply [20260927-sheets-read.sql](migrations/20260927-sheets-read.sql) once before deploying and importing data.

### Live Google Sheets source

Set `SHEETS_READ_SOURCE=google` to read the partner endpoints directly from a live spreadsheet instead of Cloud SQL. Set `GOOGLE_SHEETS_SPREADSHEET_ID` to the spreadsheet ID. The backend uses Google Application Default Credentials; on Cloud Run, grant the attached runtime service account read access to the workbook. Do not create or upload a service-account key. The backend requests only `Students`, `Robot Progress Log`, `Coding Progress Log`, and `Math Progress Log`, using the workbook's headers; it does not read `Student_View`, `Daily_Summary`, or other tabs.

The `Students` tab supplies the existing nine-column response. Progress rows are combined from the three log tabs, with `Robot Name`/`Progress Status` mapped to the robot fields, `Progress` or `Topic` mapped to the common progress field, and `Start Time`/`End Time` mapped to `Lesson Time`. The workbook has no `Programme ID`, `Tutor ID`, or `Progress Percent` columns, so those response values are blank; `Programme Name` comes from the student's `Course type`. Spreadsheet dates should be actual date cells, ISO dates, or unambiguous day/month dates. The existing database source remains available with `SHEETS_READ_SOURCE=database` (the default).

## Cloud Run with Sheets workspace

This mode does not require Cloud SQL. It uses the existing automation Sheet as a read-only source, plus a separate private dashboard spreadsheet for the library and shared edits. The starter Sheet and Calendar remain separate read-only sources. The initial dashboard state is empty: local browser edits, student-specific corrections, borrowing records and inventory counts are not migrated. Student pathways that cannot be identified from the automation Sheet must be selected in the dashboard.

**Operational limitation:** This mode is for one editor and one active browser session at a time. The Sheets API does not provide a conditional update for the state rows. The backend serializes writes and checks versions within one running instance, but cannot prevent lost updates across multiple instances or manual Sheet edits. Set Cloud Run maximum instances to 1 and concurrency to 1, use only one active revision, pause edits during deployment, and do not manually edit the dashboard tabs. Back up the dashboard spreadsheet. These restrictions are required; IAP does not enforce them.

1. Create a new private Google spreadsheet, separate from the automation and starter Sheets. Add two empty tabs named `Dashboard Library` and `Dashboard State`. Share the dashboard spreadsheet with the Cloud Run runtime service account as Editor. Keep its access to the automation and starter Sheets at Viewer, and grant the Calendar access described below.
2. Prepare and review the library-only export described in **Cloud SQL preparation** below. It excludes student collections and stock counts, but review its contents before sharing. Transfer it securely to the person initializing the spreadsheet; do not commit it.
3. With Google Application Default Credentials for an account authorized to edit the new spreadsheet, from the repository root run:

   ```bash
   node backend/initialize-sheets-workspace.js DASHBOARD_SPREADSHEET_ID /private/path/icc-libraries.json
   ```

   Initialization requires both named tabs to be empty and does not modify the source workbook. It writes the reference libraries and an empty shared state. Do not run it against an existing dashboard spreadsheet.
4. Build the image from the repository root and deploy behind IAP. Set `WORKSPACE_STORAGE=sheets`, `DASHBOARD_SPREADSHEET_ID` to the new spreadsheet ID, `DASHBOARD_SINGLE_WRITER=true`, `SHEETS_READ_SOURCE=google`, `GOOGLE_SHEETS_SPREADSHEET_ID` to the existing automation spreadsheet ID, and `IAP_AUDIENCE` to the expected IAP audience. Set `STARTER_SHEET_SPREADSHEET_ID` and `GOOGLE_CALENDAR_ID` if those integrations are used. Enable the Google Sheets and Calendar APIs in the appropriate project. No `DB_*` settings are required in this mode.
5. Restrict IAP access to the approved Google accounts and keep the Cloud Run service protected. Set an appropriately random `JAMES_APPROVAL_TOKEN_SECRET` through Secret Manager if the optional robot-progress review API is needed. It is not a browser login token.
6. After deploying, sign in through IAP and verify `/api/workspace/bootstrap` returns 200, the roster and libraries load, a shared edit persists across reload, and Calendar works. Verify the one-editor restrictions and make a backup before using real edits.

The attached Cloud Run service account uses Google Application Default Credentials; no service-account key is needed. The dashboard spreadsheet ID must differ from the source spreadsheet ID. If the dashboard Sheet is unavailable or malformed, the workspace fails explicitly instead of falling back to an empty workspace.

## Cloud Run with Cloud SQL (legacy)

The root `Dockerfile` builds one service that hosts both the frontend and API. Deploy it behind an HTTPS load balancer with IAP enabled for the frontend and backend; do not create a separate public Pages frontend. Configure IAP to permit only approved Google accounts. Keep the Cloud Run service inaccessible except through the load balancer/IAP path, and attach `icc-calendar-reader@icc-dashboard-509402.iam.gserviceaccount.com` (or another appropriately permissioned runtime identity) to Cloud Run. Grant it read access to both Sheets and the Calendar; no service-account key is needed.

Configure these non-secret Cloud Run values:

- `IAP_AUDIENCE`: the expected IAP JWT audience for the protected backend.
- `DB_USER`, `DB_NAME`, and `INSTANCE_UNIX_SOCKET`: the Cloud SQL application user, database, and `/cloudsql/PROJECT_ID:REGION:INSTANCE_ID` socket path. Provide `DB_PASSWORD` using Secret Manager.
- `SHEETS_READ_SOURCE=google` and `GOOGLE_SHEETS_SPREADSHEET_ID`: enable the live Sheets source for the control-room bootstrap and partner read endpoints.
- `STARTER_SHEET_SPREADSHEET_ID`: enable Robot birth-year sync from the starter Sheet; grant the same runtime service account Viewer access.
- `GOOGLE_CALENDAR_ID`: the private Calendar identifier.

Set `ICC_API_BASE_URL=/api`, `ICC_AUTH_MODE=iap`, `ICC_LIVE_SHEETS=true`, and `ICC_CALENDAR_ENABLED=true` in [icc-config.js](../icc-config.js). These are already the repository's deployment defaults. The IAP setting is ignored on localhost, where the private local preview behavior remains available.

Apply [cloud-sql-schema.sql](../cloud-sql-schema.sql) to new databases and import the trusted library/reference data needed by the dashboard. For an existing database, apply [20261114-workspace-shared-edits.sql](migrations/20261114-workspace-shared-edits.sql) before rollout. Roster and progress are read from Sheets; checklist, inventory, borrowing, and shared dashboard edits still need the corresponding database tables and seed data. No student roster export, `workspace-db.json`, `.env`, or credential file belongs in the container or source upload. Root `.dockerignore`, `.gcloudignore`, and `.gitignore` exclude local data and credentials.

Build and deploy from the repository root so Cloud Run uses the root Dockerfile. James should configure the IAP audience, Cloud SQL connection, approved IAP users, and attached service identity in Google Cloud; do not send passwords, tokens, or service-account JSON through chat.

The previous GitHub Pages workflow has been removed to prevent future public frontend deployments. Removing a workflow does not unpublish an already deployed Pages site: disable GitHub Pages for this repository before sharing the hosted dashboard. `workspace-db.json` is local-only and ignored by Git. If it was previously pushed to a public GitHub repository, deleting it in a later commit does not erase prior history; treat the data as exposed and coordinate an approved history cleanup before making the repository public.

## Legacy password-auth deployment (not used by IAP)

This section is retained only to explain the optional password/JWT compatibility mode; do not use it for the agreed IAP rollout. Deployments without IAP need their own security review and a separately protected frontend/API configuration.

`workspace-db.json` is local-only and ignored by Git. The production frontend does not fetch it. If this file was previously pushed to a public GitHub repository, removing it in a later commit does not erase prior history; treat the data as exposed and coordinate an approved history cleanup before making the repository public.

For programmes included in an import, robot library imports reject changes to existing robot identities, names, or sequence positions. Reordering or removing robots in an existing database requires a separate migration that preserves student progress and history; the importer does not perform that migration.

`/health` is available for service health checks. In legacy password-auth mode, data endpoints require `Authorization: Bearer <token>`; in IAP mode, protected requests require a valid IAP assertion:

```text
GET /students
GET /programmes
GET /curriculum
GET /robots
GET /components
GET /centre-inventory
GET /borrowings
GET /robot-lessons
GET /coding-lessons
```

Supported writes are `POST/PATCH/DELETE /centre-inventory`, `POST /borrowings`, and `POST /borrowings/:id/return`.

## James Robot progress review

James can submit tutor output to the protected preview endpoint. The server resolves the student's programme, compares the submitted robot name with that programme's Robot Library, and returns `accepted: true` only for one exact or unambiguous small fuzzy match:

```text
POST /robot-progress/preview
Authorization: Bearer <token>
Content-Type: application/json

{"student_id":"ST-R-003","robot_name":"delivery robot","status":"Finished","notes":"Built and tested movement.","source":"james-api"}
```

The response includes the canonical robot name and a short-lived `approval_token`. A human-facing review screen should display the submitted name, canonical match, student programme, sequence, status, and notes. The reviewer then explicitly accepts it:

```text
POST /robot-progress/accept
Authorization: Bearer <token>
Content-Type: application/json

{"approval_token":"<token returned by preview>"}
```

The accept endpoint revalidates the student, programme, Robot Library row, status, and token before upserting `student_robot_progress`. Accepted changes are recorded in `robot_progress_reviews`. Ambiguous names, unknown students, wrong-programme robots, invalid statuses, expired tokens, and tampered tokens are rejected.

The frontend should treat `accepted: false` as a review queue item, never auto-submit it. The current fuzzy matching is deliberately conservative: spaces and capitalization are normalized, and a small edit distance may be suggested, but ambiguous matches require manual correction.

The optional password-auth flow is retained for deployments that do not enable IAP. In Cloud SQL mode, Google IAP authenticates the user, and `/workspace/bootstrap` merges the live Sheet with database-backed reference data and shared edits. The local `workspace-db.json` preview path remains restricted to localhost.

## Health check

```bash
curl https://YOUR_LOAD_BALANCER_URL/health
```

Expected response:

```json
{"status":"ok","service":"icc-backend"}
```

## Cloud SQL preparation

Apply [cloud-sql-schema.sql](../cloud-sql-schema.sql) to the Cloud SQL MySQL database before deploying. The schema contains programmes, students, curriculum, robot library, components, level requirements, inventory, individual checklist items, and borrowing logs.

After the schema exists, import the canonical CSV-derived data:

```bash
cd backend
npm run preflight:data
DB_USER='icc_app' DB_PASSWORD='replace-this-secret' DB_NAME='icc' INSTANCE_UNIX_SOCKET='/cloudsql/PROJECT_ID:REGION:INSTANCE_ID' npm run import:data
```

The import reads the self-contained `../workspace-db.json`. It includes the embedded source records and no longer requires the external CSV folder.

To prepare a separate library-only JSON export for review, run from the repository root:

```bash
node backend/export-libraries.js workspace-db.json /private/path/icc-libraries.json
```

The export selects library fields only and excludes student collections, inventory counts, and notes. Review the contents before sharing. The output must not already exist. The export alone does not configure the dashboard or enable Sheets workspace mode.
James integration routing lives in [james-router.js](james-router.js), separate from the core API server. Keep James request-shape changes, fuzzy matching, approval-token handling, and review persistence in that module.
