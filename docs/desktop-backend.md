# Local dashboard backend MVP

## Scope

The extension produces records; the desktop backend receives and stores them. Being in the same Git repository shares source code, not running application memory.

This version supports History, Growth, connection status, concept mastery, recall cards, file knowledge, related-file edges, profiles, prep sets, and shared student settings. History is one `review.recorded` row per question. Questions from the same edit share a `groupId`; `GET /v1/checks` reports how many graded questions in that group passed. A check is `general` (one question about the whole change) or `chunk` (one question per planned unit). The separate `checks` table is gone.

File edges are best-effort. A link is stored only when both files were analyzed in the same batch, and it means "related," not a precise call graph.

Deferred: accounts and cloud sync. Existing Supabase code stays in the extension but is not required; the same payloads are also written to this local backend. The dashboard cannot automatically access VS Code's internal state. Only newly captured, opted-in records are sent; no historical backfill.

When question generation fails or a provider key is missing, the local explanation-length fallback is explicitly labeled as ungraded. Submitting a sufficient explanation records an ungraded review with a null score before closing the panel; bypass, explanation and cancellation exits are recorded too. These fallback reviews do not update mastery, recall or scored-attempt statistics. They use the same desktop opt-in and delivery queue as model-backed reviews.

After merging the newer agent-pause flow, locally scored pause questions also emit check records. That local picker currently returns only pass/fail/bypass, so its selected-answer text is empty and its retry count is unavailable (zero). Its ordering score is binary (0 or 1); partial ordering credit is not preserved on that local-picker path. Model-backed pause questions use the ordinary session recorder. Follow-up questions get separate event IDs. A failed question is recorded before a successfully generated replacement is installed; a generation failure leaves the current question open rather than finalizing it twice.

## First local run

Prerequisite: Node.js 22.13 or newer with `node:sqlite` support (verified on Node 22.22). `npm run start:dashboard` checks the Node version before building/importing SQLite and gives a readable error on older versions. The compiled standalone backend also has that guard. Node 22 prints an experimental SQLite warning. The extension itself does not import SQLite; the repository's VS Code engine requirement is independent of this desktop-only prerequisite.

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

Desktop sync is off by default. Disable **Comprehension Guard: Desktop Sync Enabled** in user settings to stop new capture and pause pending delivery. Pending files are retained; re-enabling sends them. A request already in flight may finish. Quiz text and student answers are included, but complete source snippets, API keys, prompts, account credentials, and absolute file paths are not included as separate payload fields. Explanation events send the generic feedback "Explanation requested." rather than copying the answer key. This change does not remove keys already stored by older versions or change the extension's separate learning log. Questions and user-written answers may themselves contain code or sensitive text; no source-code scrubber runs on those fields.

Supported: local VS Code and backend on the same computer. Remote SSH, WSL, containers, and Codespaces are not supported. The separate [Electron History application](../desktop/app/README.md) now reads this backend through a restricted main-process/preload bridge. Start the standalone backend first; Electron does not start another receiver or change its storage.

## Receiver and API

Every endpoint requires `Authorization: Bearer <pairing-token>`. Browser-origin requests are rejected and CORS is not enabled. POST requests require `Content-Type: application/json`. Bind address is loopback only, with 128 KiB body and request time limits.

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/events` | Validate and commit one dashboard v1 event (`review.recorded`, `mastery.updated`, `recall.updated`, `file.updated`, `file.edges`, `profile.updated`, `prepset.created`, `settings.updated`), then acknowledge its `eventId` |
| `POST /v1/heartbeat` | Update extension last-seen time |
| `GET /v1/history?limit=50&offset=0` | Newest review rows first; page size 1–200 |
| `GET /v1/growth?days=7` | Raw score points, average out of five, counts, plus a first-try (`retries = 0`) average; accepts `7`, `30`, `all` |
| `GET /v1/checks` | Review rows folded by `groupId`, with graded questions asked and passed |
| `GET /v1/mastery` | Latest mastery row per concept |
| `GET /v1/recall?due=now` | Recall cards; `due=now` keeps cards whose due time has passed |
| `GET /v1/files` | Latest file-knowledge rows |
| `GET /v1/files/edges` | Best-effort related-file links |
| `GET /v1/profile` | Latest learner profile |
| `GET /v1/prepsets` | Saved interview and exam question sets |
| `GET /v1/settings` | `{ settings }` newest bag, or `{ settings: null }` |
| `GET /v1/status` | Extension recently seen, last seen, last received review |

Example read without printing the token:

```sh
node -e 'const fs = require("node:fs"); const path = require("node:path"); const os = require("node:os"); const token = fs.readFileSync(path.join(os.homedir(), ".drawbridge/pairing-token"), "utf8").trim(); fetch("http://127.0.0.1:43821/v1/history", {headers:{Authorization:"Bearer " + token}}).then(r=>r.json()).then(console.log)'
```

## Reliability and storage

The extension writes one atomic JSON file per event under its `globalStorageUri/dashboard-outbox` before attempting HTTP delivery. Different VS Code windows use unique event IDs. Temporary network/auth/server failures retain pending files and retry every 15 seconds while opted in. Requests time out after 3 seconds and redirects are rejected. The queue is not silently capped or discarded.

Corrupt JSON, invalid schemas, permanent per-event HTTP rejections (400/409/413/415/422), and mismatching acknowledgements are moved to `dashboard-outbox/quarantine` with a reason sidecar; the flush continues with later records. Original event bytes are retained and unique quarantine filenames prevent overwriting rejected versions. The **Desktop Sync Status** command lists the quarantine directory, filenames (up to five), reasons, and total count, including after a restart. Quarantined files are not retried automatically. After diagnosing the reason, manually repair/requeue a copy with a fresh event ID when appropriate; leave the quarantined original for inspection. Delivery is background work; local storage failures show a warning without changing the gate result.

Review rows and prep sets use `event_id` as their primary key. Re-delivering an identical event is acknowledged without duplication; reusing the ID with different content returns 409. Mastery, recall, file knowledge, and profile rows keep the newest timestamp for that concept, path, or installation. A settings row keeps the newest `updatedAt` for that installation; an older settings event is ignored. A file-edge event replaces that file's previous links. Acknowledgement happens only after the write commits. Receiver history survives restarts. A heartbeat marks an extension as connected for 45 seconds; it is distinct from successfully syncing a review. Last-sync time is persisted separately.

The extension stores the pairing token in VS Code SecretStorage. Do not expose it to the renderer or commit it. When adding Electron, run the backend in the main process with an explicit `databasePath` under `app.getPath("userData")`, after verifying the selected Electron runtime supports `node:sqlite`. Alternatively keep this as a Node backend process. Expose narrow history/growth/status methods through a preload bridge; the UI should not receive filesystem or token access. Choose one backend owner so Electron and the standalone development server do not compete for the same port.

## Settings

`settings.updated` is one bag, and the newest `updatedAt` wins. The extension sends it when a `comprehensionGuard` setting changes, when the profile is saved, and when desktop sync is turned on. The same 15-second flush reads `GET /v1/settings`. A newer bag is written into global VS Code settings and the local profile, and that write is not sent back.

The bag contains `enabled`, `charThreshold`, `minAnswerLength`, `provider`, `model`, `gradingMode`, `nonCriticalPassFraction`, `mode`, `walkthroughFileThreshold`, `walkthroughLineThreshold`, `maxFollowups`, `agentPause`, `checkPreset`, `preferredLanguage`, `strictness`, `examDate`, and `interviewDate`. Values use the same enums and ranges as the extension settings. API keys, `supabaseUrl`, `supabaseAnonKey`, `misgradeReportUrl`, and `desktopSyncEnabled` are not in the bag.

## Score and count definitions

- `score` on a review row is an assessment result from 0 to 1, not the Bayesian/mastery-discounted `AttemptRecord.score`. Ordinary rubric questions use passed/applicable criterion count; ordering uses its existing partial score; MCQ/debug use 0 or 1.
- Growth displays `score * 5` and averages scored reviews equally. It also reports the same average for first tries (`retries = 0`). It uses rolling 7/30-day windows and UTC millisecond timestamps; the UI can format dates locally.
- `GET /v1/checks` groups reviews that share a `groupId`. Coverage is graded passes divided by graded questions, so the denominator changes with the edit.
- Bypass, explanation-only, disputed, and undecided results are unscored. They do not increase the completed/scored count or lower the average. Closing an unassessed check is ungraded. These transport rules do not change existing extension mastery calculations.
- Walkthrough cancellation, bypass, and explanation exits (including during a debug edit) also create local attempt/review records. They do not update mastery/recall. Local statistics exclude the ungraded cancellation outcome as well as bypass/explanation.
- A bypass count is observed quiz bypasses, not every possible skipped insertion. Failed questions can still be scored/completed. No denominator-based bypass rate or pass-rate chart is supplied yet.
- File paths are workspace-relative or null if the workspace is unavailable. Projects are identified by a hash of their workspace URI. Moving a project changes its identity in this MVP.

Known scaling limit: Growth currently loads the matching events and computes its average/points in JavaScript. In particular, `days=all` has no point limit. SQL aggregation plus paginated or bucketed chart points is deferred; use bounded periods for large histories.

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
