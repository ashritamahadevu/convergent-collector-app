# Desktop demo checkpoint: projects to learning history

This demo uses real synced checks. Do not populate the student's database with
test fixtures. Automated tests use a temporary directory and a random port.

## Start the updated code

Stop the older backend terminal with Ctrl+C before restarting it. The desktop
now needs the new /v1/projects endpoint and project-aware History response.
Do not start two receivers or replace the pairing-token file.

Terminal 1 (repository root):

    cd C:\Users\Owner\txc-fa26\convergent-collector-app
    npm.cmd run start:dashboard

Terminal 2 (desktop application):

    cd C:\Users\Owner\txc-fa26\convergent-collector-app\desktop\app
    npm.cmd start

For custom DRAWBRIDGE_DATA_DIR / DRAWBRIDGE_PORT, use the same settings in both
terminals. Existing records and pairing credentials stay in their current folder.

## Suggested demo sequence

1. Open Home and choose Browse projects. Existing synced projects appear automatically, ordered by their
   latest check. Point out recorded, scored and unscored counts.
2. Open a project's History. Expand a check to show its question, final answer,
   feedback, file, topic and outcome.
3. Use the Project selector to switch projects or show All projects. Pagination
   operates within that selection, and Refresh keeps the selected project.
4. In VS Code, start the Extension Development Host (F5 / Run Extension) and open
   a disposable project folder. Run Desktop Sync Status in that host. If off,
   run Connect Desktop Dashboard and choose the existing backend pairing-token.
5. Complete a supported comprehension quiz. Return to History and Refresh to see
   the new record. Go Home and Refresh to update the recent-check dials and
   lowest-scored concept cards. Browse projects provides the project summaries.
6. Home shows the goblin stage from mastery, recall, and check history, plus due topics.
   Review in editor opens the existing VS Code quiz. Growth, Map, and Settings read
   the local backend. The weekly goal text on Home is still a local note. The
   installed app can still update from GitHub Releases.

The extension already includes the project name and workspace-derived ID in
each review. This batch adds read-only summaries and filtering, not another
exporter, database, account setup or scoring algorithm.

## Explain the numbers honestly

- Each recorded check is one review row, not necessarily a complete multi-question edit.
- Average assessment is the mean of non-null recorded scores multiplied by five.
- A zero assessment is a real score. Missing assessment is Not assessed yet.
- Local fallback explanations are ungraded and do not produce a numeric average.
  Use a configured, working grading provider if demonstrating scored results.
- These numbers are not first-attempt accuracy, calibrated mastery or goblin rank.
- Project summaries include all saved rows, even those outside the first History page.
- Only projects with saved reviews appear. Moving a workspace changes its existing
  identity; matching display names do not merge projects.

The live extension-to-History flow was previously user-tested. The new project
navigation and summary calculations are checked by backend/client tests and an
isolated Electron smoke test. A fresh live quiz through this new screen flow
still needs the presenter's final rehearsal.
