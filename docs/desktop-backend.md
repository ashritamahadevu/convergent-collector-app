# Local dashboard backend MVP

## Scope

The extension produces records; the desktop backend receives and stores them. Being in the same Git repository shares source code, not running application memory.

This version supports History, Growth, and connection status. It records one question/check per history row, not an entire agent prompt or a multi-question test. Each row contains its question, final answer, feedback, concepts, outcome, assessment score, timestamp, source, project label, workspace-relative file path when available, and retry count. Ordinary quizzes and walkthroughs both produce records, including bypasses. Existing fallback gates and pre-armed bypasses that never open a quiz are not recorded.

Deferred: mastery/Elo synchronization, recall cards, exam dates, prep sets, file maps, AI-written percentages, code profiles, multi-question test grouping, accounts, and cloud/cross-device sync. Existing Supabase code is unchanged and separately configured. The dashboard cannot automatically access VS Code's internal state. Only newly captured, opted-in checks are sent; no historical backfill.

## First local run

Prerequisite: Node.js 22.13 or newer with `node:sqlite` support (verified on Node 22.22). Node 22 prints an experimental SQLite warning. The extension itself does not import SQLite.

From the repository root:

```sh
npm ci
npm run start:dashboard
```

This builds and runs the backend independently of Electron. It listens on `http://127.0.0.1:43821` and creates `~/.drawbridge/dashboard.sqlite` and `~/.drawbridge/pairing-token`. The path is printed; the token is not printed. Keep this terminal running. SQLite is the database; the local API is its receiving interface. No Supabase account or hosted database is required.

To use a different directory/port, set `DRAWBRIDGE_DATA_DIR` / `DRAWBRIDGE_PORT` before starting. Do not put the database or pairing token in the repository. If you change the port, enter the new address when pairing.

In a second terminal, build the extension:

```sh
npm run compile
```

Launch the extension using the repository's VS Code Extension Development Host configuration (F5). In that development window:

1. Run **Comprehension Guard: Connect Desktop Dashboard** from the Command Palette.
2. Select the `pairing-token` file created above. In the macOS file picker, Command+Shift+G lets you enter `~/.drawbridge/`.
3. Accept the local backend address. Connecting enables desktop sync.
4. Finish a normal comprehension quiz.
5. Run **Comprehension Guard: Desktop Sync Status** to see connectivity, pending records, and last successful sync.

Desktop sync is off by default. Disable **Comprehension Guard: Desktop Sync Enabled** in user settings to stop new capture and pause pending delivery. Pending files are retained; re-enabling sends them. A request already in flight may finish. Quiz text and student answers are included, but complete source snippets, API keys, prompts, account credentials, and absolute file paths are not included as separate payload fields. User-written answers may themselves contain sensitive text. No source-code scrubber runs on answers.

Supported: local VS Code and backend on the same computer. Remote SSH, WSL, containers, and Codespaces are not supported. The Electron window and preload bridge are not implemented in this change.

## Receiver and API

Every endpoint requires `Authorization: Bearer <pairing-token>`. Browser-origin requests are rejected and CORS is not enabled. POST requests require `Content-Type: application/json`. Bind address is loopback only, with 128 KiB body and request time limits.

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/events` | Validate and commit one `check.recorded` v1 event, then acknowledge its `eventId` |
| `POST /v1/heartbeat` | Update extension last-seen time |
| `GET /v1/history?limit=50&offset=0` | Newest checks first; page size 1–200 |
| `GET /v1/growth?days=7` | Raw score points, average out of five, counts; accepts `7`, `30`, `all` |
| `GET /v1/status` | Extension recently seen, last seen, last received check |

Example read without printing the token:

```sh
node -e 'const fs = require("node:fs"); const path = require("node:path"); const os = require("node:os"); const token = fs.readFileSync(path.join(os.homedir(), ".drawbridge/pairing-token"), "utf8").trim(); fetch("http://127.0.0.1:43821/v1/history", {headers:{Authorization:"Bearer " + token}}).then(r=>r.json()).then(console.log)'
```

## Reliability and storage

The extension writes one atomic JSON file per event under its `globalStorageUri/dashboard-outbox` before attempting HTTP delivery. Different VS Code windows use unique event IDs. Failed deliveries retain their files and retry every 15 seconds while opted in. Requests time out after 3 seconds and redirects are rejected. The queue is not silently capped or discarded. Corrupt records stop the flush and remain on disk for inspection; the status command shows the error. Delivery is background work; local storage failures show a warning without changing the gate result.

SQLite uses `event_id` as its primary key. Re-delivering an identical event is acknowledged without duplication; reusing the ID with different content returns 409. Acknowledgement happens only after the insert commits. Receiver history survives restarts. A heartbeat marks an extension as connected for 45 seconds; it is distinct from successfully syncing a check. Last-sync time is persisted separately.

The extension stores the pairing token in VS Code SecretStorage. Do not expose it to the renderer or commit it. When adding Electron, run the backend in the main process with an explicit `databasePath` under `app.getPath("userData")`, after verifying the selected Electron runtime supports `node:sqlite`. Alternatively keep this as a Node backend process. Expose narrow history/growth/status methods through a preload bridge; the UI should not receive filesystem or token access. Choose one backend owner so Electron and the standalone development server do not compete for the same port.

## Score and count definitions

- `check.score` is an assessment result from 0 to 1, not the Bayesian/mastery-discounted `AttemptRecord.score`. Ordinary rubric questions use passed/applicable criterion count; ordering uses its existing partial score; MCQ/debug use 0 or 1. Walkthrough free-text currently retains its existing binary pass/fail score.
- Growth displays `check.score * 5` and averages scored checks equally. It uses rolling 7/30-day windows and UTC millisecond timestamps; the UI can format dates locally.
- Bypass, explanation-only, disputed, and undecided results are unscored. They do not increase the completed/scored count or lower the average. Closing an unassessed check is ungraded. These transport rules do not change existing extension mastery calculations.
- A bypass count is observed quiz bypasses, not every possible skipped insertion. Failed questions can still be scored/completed. No denominator-based bypass rate or pass-rate chart is supplied yet.
- File paths are workspace-relative or null if the workspace is unavailable. Projects are identified by a hash of their workspace URI. Moving a project changes its identity in this MVP.

## Development checks

```sh
npm run typecheck
npm run compile
npm run build:dashboard
npm run test:dashboard
```

Dashboard tests use temporary SQLite files, temporary queues, mock question generation, and actual loopback HTTP. They cover retries, restart persistence, duplicate acknowledgement, conflicting IDs, auth, malformed/oversized data, score exclusions, filters, timeouts, opt-in, ordinary quiz capture, and walkthrough bypass capture. They make no Claude calls.

## Working with Git

Work on `feat/local-dashboard-sync`, not directly on `main`. Review `git diff` and run the checks above. When ready:

```sh
git add src/dashboard src/extension.ts src/quiz.ts desktop scripts/build-dashboard.cjs scripts/test-dashboard.cjs test/dashboard.test.ts docs/desktop-backend.md package.json tsconfig.dashboard.json .vscodeignore .gitignore
git commit -m "Add local dashboard history sync backend"
git push -u origin feat/local-dashboard-sync
```

Then open a pull request for your teammate to review before merging. No commit or push is performed automatically by this implementation.
