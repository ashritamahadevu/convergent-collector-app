# DrawBridge desktop History

This is a separately configured Electron application. The root package remains
the VS Code extension. This folder's npm package and lockfile belong only to the
desktop interface.

## What runs where

1. The extension captures opted-in checks and retries delivery from its outbox.
2. The **standalone Node backend** validates events and owns SQLite and pairing.
3. Electron's **main process** reads the existing pairing-token file and makes
   authenticated requests to the backend's history and status endpoints.
4. A sandboxed **preload** exposes only typed readHistory and readStatus methods.
5. **React** renders those results. It has no token, Node, filesystem or direct
   backend network access.

Electron does not start a receiver, open SQLite, move data, or create credentials.
The existing default backend data directory remains ~/.drawbridge.
Desktop pairing is independent of Supabase Auth. The Supabase prototype and
extension cloud code are unchanged.

## First setup and launch (Windows PowerShell)

Use Node 22.13+ (the existing machine has Node 24). Run these once:

    cd C:\Users\Owner\txc-fa26\convergent-collector-app
    npm.cmd ci
    npm.cmd run compile
    cd desktop\app
    npm.cmd ci

Terminal 1 — keep the standalone backend running:

    cd C:\Users\Owner\txc-fa26\convergent-collector-app
    npm.cmd run start:dashboard

Terminal 2 — build and open the desktop window:

    cd C:\Users\Owner\txc-fa26\convergent-collector-app\desktop\app
    npm.cmd start

History opens first. Refresh returns to the newest 20 checks; Previous/Next
paginate older checks. Since the API has no total count, a full final page can
offer Next leading to an empty page. Previous returns to the preceding page.
These are offset-based pages, not a frozen snapshot; new arrivals can shift
page boundaries. Refresh resets browsing to the latest data.

If using DRAWBRIDGE_DATA_DIR or DRAWBRIDGE_PORT, set the same values in both
terminals before launching. For example:

    $env:DRAWBRIDGE_DATA_DIR = 'D:\DrawBridgeData'
    $env:DRAWBRIDGE_PORT = '43822'

Do not change these settings to fix an error without checking where your
existing backend stores its records. The desktop app rereads the existing token
on Refresh, but environment changes require restarting the desktop app.

## Observe a real VS Code check

1. Open the repository root in VS Code. Press F5 and select **Run Extension**.
   Its pre-launch task builds/watches the extension. Use the separate
   **Extension Development Host** window for the following steps.
2. Open a disposable project/file in that host.
3. Run **Comprehension Guard: Connect Desktop Dashboard** from the Command
   Palette. Choose the existing pairing-token file printed by Terminal 1.
   Normally it is C:\Users\Owner\.drawbridge\pairing-token.
4. Accept http://127.0.0.1:43821 (or the actual configured port). Pairing enables
   Desktop Sync. **Desktop Sync Status** reports delivery/pending/quarantine state.
5. Use an already configured provider/grading setup to complete an ordinary
   comprehension quiz: run **Comprehension Guard: Paste (guarded)** with a
   sufficiently large code snippet (default threshold: 200 characters) and
   submit an answer. Use disposable code because guard outcomes can affect the
   inserted code. If question generation fails or a provider key is missing,
   the local explanation check is labeled ungraded and is saved as Not scored.
6. In the desktop app choose **Refresh**. Expand the new row to inspect the
   final recorded answer, feedback, project, concepts, file, outcome and retries.
   If delivery was temporarily unavailable, allow the extension's 15-second
   retry interval or run **Desktop Sync Status**, then Refresh.

This manual flow still needs to be observed with a real provider/quiz. Automated
tests use isolated fixtures and do not claim a real student completed a quiz.
Only newly captured opted-in checks are sent; existing VS Code history is not
backfilled.

## What is real versus prototype

History and its connection status use the existing backend. Initial loading,
empty history, pairing errors, backend errors, Refresh and pagination are
implemented. Text is rendered as React text, never imported HTML.

One event is one check. Assessment scores display the existing score multiplied
by five; unscored outcomes display Not scored. These are not first-attempt
metrics or counts of five questions. Individual attempts are not in this event
contract. Some local-picker paths lack answer/retry details; the UI explains this.

After the update from main, History reads flat review.recorded events, using the
shared ReviewEvent type and validator. Topic, check shape and group ID are
available in expanded details. The old nested check.recorded format is no
longer the backend contract. Main's backend reads the review_events table;
older checks-table records are not migrated by this desktop integration.
No existing database or pairing file is modified by the desktop application.

Home, Growth and Map are the supplied Figma prototype, with a visible
**Design prototype / Sample data** banner. Their numbers, graph edges, goals and
goblin metrics are not connected or implemented by this batch. History search,
week and review filters are visibly deferred because filtering only a loaded
page would give incomplete results.

## Source and adaptation

The user's drawbridge figma mockup.zip supplied src and public (React, styles,
screens, assets and navigation). History's fixed example rows were replaced
with a scrollable real-data view retaining the design's logo, toolbar, canvas,
dark palette and green accents. Other screens retain their prototype content.
Asset URLs are relative for Electron's local built files. Font aliases use local
Inter/Arial instead of downloading fonts. No Figma environment/deploy plugins,
instructions or running-server assumptions were imported.

The new Vite configuration builds local files; it does not host the backend.
Electron has context isolation, sandboxing and web security enabled, validates
IPC senders and pagination, denies new windows/navigation/permissions, and uses
a content security policy that blocks renderer network requests.
See [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
and [Vite relative base](https://vite.dev/guide/build.html#relative-base).

## Checks

Repository root:

    npm.cmd run typecheck
    npm.cmd run test:dashboard
    npm.cmd run compile
    npm.cmd run build:dashboard

This folder:

    npm.cmd run build
    npm.cmd test
    npm.cmd run test:smoke

The build checks both React and Electron TypeScript. Client tests use temporary
SQLite files. The Playwright Electron smoke test opens the actual built window,
uses a real backend on an ephemeral port and temporary data directory, and tests
missing configuration, empty history, fixture delivery, duplicate handling,
Refresh, pagination, details, unscored outcomes, literal HTML text, bridge
restrictions, prototype labels, asset loading and a stopped backend.
Screenshots are written to ignored test-results/. It never uses the user's
database/token or pairs their extension. It closes its test app and backend.

This is a development application, not an installer or a distribution release.
