# DrawBridge desktop dashboard

This is a separately configured Electron application. The root package remains
the VS Code extension. This folder's npm package and lockfile belong only to the
desktop interface.

## What runs where

1. The extension captures opted-in checks and retries delivery from its outbox.
2. The **standalone Node backend** validates events and owns SQLite and pairing.
3. Electron's **main process** reads the existing pairing-token file and makes
   authenticated requests to the backend's projects, history and status endpoints.
4. A sandboxed **preload** exposes only typed readProjects, readHistory and readStatus methods.
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

Home opens first with the original Figma layout: weak points, Grub, Stats,
weekly goal and recent checks. Weak-point cards and recent-check dials now use
saved reviews. Goblin stats, rank, welcome identity and the locally editable goal
remain demo content. Choose Home Refresh to update the real cards.
Choose Browse projects to open the real project list; Back to Home (or the Home
icon) returns to the mockup layout. Open a project to see its History, or choose
All History. History Refresh returns to the newest 20 checks for the selected
project; Previous/Next
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

The original live extension-to-History flow was confirmed by the user. The new
project-summary navigation is verified with isolated fixtures; a fresh live
rehearsal through those screens remains the final demo check. Automated tests
do not claim a real student completed a quiz.
Only newly captured opted-in checks are sent; existing VS Code history is not
backfilled.

## What is real versus prototype

Project cards (Home → Browse projects), History and their connection status use the existing backend.
Cards summarize all saved review rows, not just the first History page. They show
recorded, scored and unscored check counts, last activity and an average assessment
out of five. Unscored-only projects say Not assessed yet; a real zero score stays
zero. Projects appear after their first saved review. Open History and the Project
selector filter on the backend before pagination. Switching projects resets to
the first page; Refresh preserves the project selection. All projects is available.
Project identity uses the existing workspace-derived ID, not the display name.
Moving the workspace still changes that ID. No schema migration or new scoring
algorithm was introduced.

Initial loading,
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

Home keeps the supplied Figma layout. Its three concept cards and recent-review
dials use GET /v1/home across all projects. Concept cards rank mean non-null
assessment scores ascending, then evidence count descending, then concept key.
Repeated tags on a review count once. Blank tags and unscored reviews are excluded
from concept averages. This is a demo ranking of observed assessments, not an
approved mastery model or a threshold-based diagnosis.
Each card shows the evidence count and a representative linked file (the newest
scored review with a file for that concept, otherwise the newest scored review).
The recent dials include ungraded/bypassed checks as Not scored, never zero.
Missing concepts/checks produce empty placeholders. Home Refresh reloads these
cards; loading and unavailable-backend states are explicit.

Only Home's goblin stats, rank, welcome identity and local goal remain demo data;
its header identifies the goblin/goal preview. Growth and Map have a visible
**Design prototype / Sample data** banner. Their numbers and graph edges
are not connected or implemented by this batch. History search,
week and review filters are not yet provided because filtering only a loaded
page would give incomplete results.

History uses the mockup's pill controls, translucent rounded table, green concept
text, muted compact dates, castle backdrop and five-block score indicators.
Fractional scores partially fill a block; unscored records keep empty blocks and
the Not scored label. Selecting a check expands its original data across the
full table width. Status remains the recorded review outcome, without new
Needs review/Strong thresholds. Pagination and the project selector remain live.

## Source and adaptation

The user's drawbridge figma mockup.zip supplied src and public (React, styles,
screens, assets and navigation). History's fixed example rows were replaced
with a scrollable real-data view retaining the design's logo, toolbar, canvas,
dark palette and green accents. HomeScreen.tsx remains the actual Home layout,
including the goblin, weak points, Stats, goal and recent-check dials. The user's
reference screenshot supplies the Peasant demo rank; recent-check dial percentages
now come from real records instead of the sample 33/75/100 values.
Project summaries live behind Browse projects, not in place of Home.
Growth and Map retain their prototype content.
Asset URLs are relative for Electron's local built files. Inter 4.1 is bundled
under public/fonts with its license; all Figma weight aliases use that file.
Vite rewrites its font URLs for Electron, so no font installation or runtime
font download is needed. No Figma environment/deploy plugins,
instructions or running-server assumptions were imported.

The bridge artwork and green glow are shared by every screen in App.tsx, outside
the fixed Figma canvas. The bridge uses the original Home asset, scales with the
actual window and keeps its aspect ratio. Margins and a 28vh height cap prevent
clipping on wide/tall windows; the artwork has a 720px minimum width within the
app's existing 960px minimum window width. Individual screens no longer position
or stretch their own bridge copies.

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
