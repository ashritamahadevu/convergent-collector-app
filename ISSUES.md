# Known issues

A running list of bugs found by robustness testing in November 2026. Tick an item off when its fix lands, and flip its test (see [Tests that encode a bug](#tests-that-encode-a-bug)).

- Line numbers refer to commit `3b713e8`. They will drift as code changes.
- "Observed" means a test reproduced it. "Inferred" means it was read from the code and not reproduced.
- "Checked" means the cause was also confirmed by reading the source.
- Full write-ups with per-scenario tables are in [test-reports/](test-reports/): `interruptions.md`, `network.md`, `extension-interference.md`, `claude-code-and-walkthrough.md`.

Severity:

- **P0:** code lands without a check, or the user's code is lost, or a student is graded wrong.
- **P1:** the editor or guard gets stuck, or a false quiz appears.
- **P2:** sync data is wrong or dropped. No code is lost.
- **P3:** noisy, misleading, or cosmetic.

## Suggested order

1. CG-01 and CG-02 together. Every paste and inline quiz is broken until they land, and they hide other bugs.
2. The walkthrough group: CG-03 to CG-08.
3. Grading: CG-09 to CG-13.
4. Durable held edits: CG-14 and CG-15.
5. Everything else by severity.

## P0: code kept without a check, code lost, or wrong grade

### Paste and inline quizzes

- [ ] **CG-01 · Failing or closing a paste or inline quiz never removes the code.** Outdated. The quiz panel now opens beside the file (`ViewColumn.Beside` in `src/quizPanel.ts`), so opening the quiz no longer disposes the editor. Observed, checked.
  - Where: `src/quizPanel.ts:409-415` opens the quiz in `ViewColumn.Active` (since commit `79f00c1`). That hides the file's editor and VS Code disposes it. The deletes at `src/pasteGuard.ts:97-103` and `src/editGuard.ts:112-118` then throw `TextEditor#edit not possible on closed editors`.
  - Repro: paste 200+ characters, then close the quiz tab. The code stays. The same happens when the quiz is failed.
  - Fix: delete through a `WorkspaceEdit` on `document.uri` after checking the text still matches, or open the quiz `Beside`. A trial build using `WorkspaceEdit` fixed 9 interference scenarios.

- [x] **CG-02 · After CG-01, the inline guard and the disk fallback stay off for the session.** Observed, checked.
  - Where: `src/editGuard.ts:113` sets `state.suppressEditGuard = true`, and the throw skips the reset. The `finally` at `src/editGuard.ts:119-130` never resets it (unlike `src/pasteGuard.ts`). `src/agentGuard.ts:227` reads the same flag, so the disk fallback is silenced too.
  - Fix: reset the flag in the `finally`.

### Walkthrough mode

- [ ] **CG-03 · A walkthrough never holds, reverts, or locks the agent code.** Intentional. A walkthrough is a later review, not a hold on the agent's code. Observed, checked.
  - Where: `src/agentGuard.ts:117-119` hands the batch to `offerWalkthrough` (`src/walkthrough.ts:21-59`), which only shows a toast.
  - Repro: auto mode, 7 agent files in one batch. All 7 files keep the code and stay editable.
  - Fix: hold the batch until session 1 passes. Or, if walkthroughs are meant to be non-blocking, say so in the README.

- [x] **CG-04 · A walkthrough session counts as passed even when every answer is wrong, or when it had no questions.** Observed, checked.
  - Where: `runSession` always ends with `return true` (`src/quiz.ts:415-417`). A session with zero questions, for example with no API key, also returns true (`src/quiz.ts:334-336`).
  - Fix: return the real result, and treat an empty session as "not run".

- [x] **CG-05 · A real Claude Code multi-file change never forms one batch.** Observed.
  - Where: the batch window is 700 ms (`src/agentGuard.ts:99-102`). Claude Code 2.1.316 sends one Write every 1.4 to 1.8 s.
  - Repro: ask Claude for an 8-file change. File 1 gets a held quiz, and files 2 to 8 sit on disk unchecked. They then become a "7 files changed" walkthrough, which per CG-03 is not a check.
  - Fix: group edits by the hook payload's `session_id` and prompt, and hold each edit as it arrives.

- [x] **CG-06 · While the walkthrough toast is unanswered, every later agent edit lands unchecked.** Observed.
  - Where: the queue loop awaits the toast (`src/agentGuard.ts:118` waits on `src/walkthrough.ts:41`).
  - Fix: don't await the toast inside the queue loop.

- [x] **CG-07 · Agent edits beyond 12 in the queue are silently dropped and keep their code.** Observed, checked.
  - Where: `src/agentGuard.ts:91-96` shows a status bar message and returns.
  - Repro: 15 edits while one check is open gave 13 quizzes, and 2 files kept their code.
  - Fix: hold the extra edits and process them later.

- [x] **CG-08 · In auto mode, a single file of 500+ short lines becomes a "1 files changed" walkthrough with no check.** Observed.
  - Where: `src/state.ts:172-175` doesn't require more than one file. Lines are counted after the snippet is cut to 24,000 characters (`src/agentGuard.ts:74`, `:116`), so the same file with longer lines gets a normal quiz instead.
  - Fix: require more than one file in auto mode, and count lines before truncating.

### Grading

- [x] **CG-09 · A grading failure counts as a real pass and raises mastery.** Observed, checked.
  - Where: `no_decision` (network drop, timeout, bad key, garbage reply) is recorded as a pass (`src/quiz.ts:265-269`, `:372-374`). Outages shorter than about 0.6 s are absorbed by the retry.
  - Fix: record it as "ungraded", skip the mastery update, tell the user, and offer to retry grading.

- [x] **CG-10 · An upper-case `"FAIL"` verdict from the judge ends up as a pass.** Observed, checked.
  - Where: `normalizeVerdict` compares case-sensitively (`src/llm.ts:749-754`), and so does the regex at `src/llm.ts:102`.
  - Fix: lower-case the value before comparing, and add the `i` flag to the regex.

- [x] **CG-11 · A free-text question with no criteria passes any answer.** Observed.
  - Where: `src/llm.ts:805-813`, `src/llm.ts:843-846`, `src/decision.ts:111`.
  - Fix: reject the question at generation time, and make scoring fail an empty rubric.

- [x] **CG-12 · If the judge renames the criterion ids, a correct answer fails three times and the code is removed.** Observed.
  - Where: `src/llm.ts:701`, `src/decision.ts:84-93`.
  - Fix: match criteria by position.

- [x] **CG-13 · Clicking Bypass on the panel while the last grade is pending is ignored if that grade fails, so the code is removed.** Observed.
  - Where: `src/quiz.ts:251`, `src/quiz.ts:298-300`, `src/quizPanel.ts:434-442`.
  - Fix: check queued bypass and close actions before acting on the verdict.

### Agent edits

- [x] **CG-14 · The agent's code is lost for good if the window closes, reloads, or crashes during its quiz.** Observed.
  - Where: the file is reverted before the quiz, and the only copy of the agent code stays in memory (`src/agentGuard.ts:357`). The inbox file is deleted before handling (`src/agentGuard.ts:639-640`), and `hook/notify.js` always exits 0, so the agent believes the write succeeded.
  - Fix: write the held edit to a `held/` folder under the guard home before reverting, and offer it again on activation.

- [x] **CG-15 · With two queued agent edits, the second file keeps unchecked agent code on disk while quiz 1 is open.** Observed.
  - Where: each edit is held out only when its own quiz starts (`src/agentGuard.ts:121-123`, `:357`). A crash at that point keeps file 2's code and loses file 1's (CG-14).
  - Fix: hold out (and save, per CG-14) every edit in the batch before the first quiz.

- [x] **CG-16 · An agent edit to the file in the active editor gets past the agent check, and its code stays on disk.** Observed.
  - Where: `src/agentGuard.ts:264-267` hands large changes in the active editor to the inline guard. `src/editGuard.ts:38-43` only skips claimed files, and the claim comes later (`src/agentGuard.ts:102`, `:339`). The hook event that follows is then dropped as already covered (`src/agentGuard.ts:81-86`). The inline guard only edits the buffer, so a fail leaves the disk copy. This also happens while the terminal has focus, and for an extension's `workspace.fs.writeFile`.
  - Fix: make `editGuard` ignore changes that leave a `file:` document clean (a reload from disk), and claim the path as soon as the hook event arrives.

- [x] **CG-17 · Failing a NotebookEdit check keeps the new cell.** Observed.
  - Where: `.ipynb` files store cell source JSON-escaped, so the hunk revert finds nothing (`src/agentProtocol.ts:577-605`, `:588`; `src/agentGuard.ts:382-389`). The parser ignores `tool_response.original_file`, `old_source`, and the PreToolUse snapshot.
  - Fix: restore from the snapshot or `original_file`, as is already done for Write.

- [x] **CG-18 · Prettier format-on-save or trim-trailing-whitespace loses the agent code after a correct answer, and reformats the user's file.** Observed.
  - Where: `writeBack` saves the file (`src/agentGuard.ts:480-487`), the save hook rewrites it, and the `equivalentText` check (`src/agentProtocol.ts:96-106`) then fails at `src/agentGuard.ts:432`. The user sees "could not be written into the file".
  - Fix: revert without running save hooks, record the text as it is after saving, and re-apply the agent's changes on top of the current text.

- [x] **CG-19 · An extension's unsaved edit to a background file is lost after a correct answer.** Observed.
  - Where: `src/agentGuard.ts:314` reads the file from disk, which doesn't have the edit, so `src/agentProtocol.ts:347` restores the file without it.
  - Fix: use the open document's text.

- [x] **CG-20 · Any error during an agent quiz writes the agent code into the file.** Inferred.
  - Where: `src/agentGuard.ts:393-395`.
  - Fix: on error, keep the code held and tell the user, rather than applying it.

### Other ways around the guard

- [x] **CG-21 · While any quiz is open, a large insertion into a different file goes through unchecked.** Observed.
  - Where: `src/editGuard.ts:45-47` returns early while a quiz is active, and `src/agentGuard.ts:227`, `:341` do the same. The README says you can't switch files during a quiz, but only the one file is locked.
  - Fix: take the insertion out and quiz it after the current quiz, or lock every document.

- [x] **CG-22 · Autosave or a manual save writes held paste or inline code to disk during the quiz, and a fail doesn't undo it on disk.** Observed.
  - Where: the lock blocks edits but not saves (`src/documentLock.ts:13-38`). With delayed autosave the code is on disk within about 300 ms. With autosave on focus change, it is saved the moment the quiz opens. The README says inline insertions are taken out during the quiz, but the code leaves them in.
  - Fix: keep the code out of the buffer during the quiz (as the agent path already does), or block saves and save again after removal.

- [x] **CG-23 · AI code inserted in small pieces is never quizzed.** Observed.
  - Where: the guard needs one single change over the threshold (`src/editGuard.ts:57-59`), and the disk check skips the active unsaved file (`src/agentProtocol.ts:203`).
  - Repro: 762 characters streamed in 40-character edits, or 10 small inserts in one `WorkspaceEdit` on an unsaved file.
  - Fix: add up the inserted characters per document over a short window.

- [x] **CG-24 · One `WorkspaceEdit` with several inserts isn't fully removed on fail.** Observed.
  - Where: only the first large change is considered (`src/editGuard.ts:57`), and its range is computed in pre-edit coordinates (`src/editGuard.ts:72-74`).
  - Fix: adjust each range by the earlier changes and remove all of them.

- [x] **CG-25 · Notebook cells aren't guarded.** Observed.
  - Where: only `file` and `untitled` documents are checked (`src/editGuard.ts:34`, `src/agentGuard.ts:223`). An extension's 348-character insert into a cell opens no quiz. A paste into a cell is quizzed but stays after a fail, even with the CG-01 fix.
  - Remote documents (SSH, WSL) are excluded the same way. Inferred, not tested.

- [x] **CG-26 · Closing the quiz tab while the answer is being graded keeps the code if the grade comes back as a pass.** Observed.
  - Where: `src/quiz.ts:243-284` never checks whether the panel was closed while it waited.
  - Fix: after each wait, check for a close and treat it as cancel.

- [ ] **CG-27 · Reloading or closing the window during a paste or inline quiz may restore the unchecked code from hot exit.** Inferred.
  - The harness couldn't show this, because test mode writes no backups.
  - Fix: remove pending code in `deactivate()`, or record pending insertions and handle them on activation.

- [x] **CG-28 · Edits Claude makes through its Bash or PowerShell tools are missed when the file isn't open.** Observed, known limitation.
  - Hooks only fire for Edit, Write, and NotebookEdit. The disk fallback catches writes to open files.
  - Consider documenting this in the README, or watching the workspace for file changes during an agent session.

## P1: stuck editor, stuck guard, or false quiz

- [x] **CG-29 · A large paste in a diff editor disables the guard until the window is reloaded.** Observed, checked.
  - Where: `src/pasteGuard.ts:71-74` sets the busy flags outside the `try`. `showTextDocument` (`:129`) replaces the diff with a plain editor, and the edit at `:134` throws.
  - Symptom: nothing pastes, the status bar is stuck on "Guard: Quiz open" with no quiz, and every later large paste says "finish the open quiz".
  - Fix: move the flags inside `try/finally`, and use the editor that `showTextDocument` returns or a `WorkspaceEdit`.

- [x] **CG-30 · The file lock fights other writers in an endless loop.** Observed, checked.
  - Where: `src/documentLock.ts:13-38` reverts every change with no limit, and `:36` clears the shared `suppressEditGuard` flag.
  - Repro: an extension that re-applies its edit caused 403 changes in 3 s. Autosave plus trim-trailing-whitespace caused 19 saves in 4 s.
  - Fix: make the file read-only during the quiz instead of reverting, or cap retries. Don't touch the shared flag.

- [x] **CG-31 · There is no quiz panel while the question is generated, so the file is locked with nothing to close, for up to about 3 minutes.** Observed.
  - Where: `src/quiz.ts:53-66` generates before creating the panel. Timeouts and retries are at `src/llm.ts:19`, `:454-462`, `:781-806`. A provider that accepts but never answers took 181.8 s, and about 364 s if the rubric check triggers a second generation.
  - Bypass during generation isn't applied on its own (`src/quiz.ts:305-322`). The leftover flag turns a later close into a bypass (`src/quiz.ts:309-316`).
  - Fix: open the panel at once in a "Preparing" state with Bypass and Close, let closing it abort generation, and cap the total time.

- [x] **CG-32 · The response body has no timeout.** Observed.
  - Where: `src/llm.ts:432-443` clears the timeout once headers arrive. A stalled body was waited on for 304 s, and a trickling body has no limit.
  - Fix: keep the timeout running until the body has been read.

- [x] **CG-33 · The Bypass command doesn't work on agent quizzes.** Observed, checked.
  - Where: `runAgentQuiz` never marks a quiz as active (`src/agentGuard.ts:339-342`), so `src/state.ts:50-53` reports no quiz and `src/extension.ts:72-85` arms a bypass for the next unrelated paste instead.
  - Fix: mark the agent quiz active and inactive, as the paste and inline paths do.

- [x] **CG-34 · Grading has no busy indicator, and a second Submit click during slow grading is replayed and uses up a follow-up.** Observed.
  - Where: `src/quizPanel.ts:434-442`, `src/quiz.ts:286-296`. A hung judge showed nothing for 120.6 s.
  - Fix: show a grading state, disable Submit while grading, and drop stale submits.

- [x] **CG-35 · The misgrade report POST has no timeout, and the quiz waits on it.** Observed.
  - Where: `src/store.ts:98`.
  - Fix: send it in the background with a timeout.

- [x] **CG-36 · Renaming the locked file releases the lock, and closing the quiz then leaves the paste in the renamed file.** Observed.
  - Where: the lock follows the document object, which a rename replaces (`src/documentLock.ts:14`).
  - Fix: follow `onDidRenameFiles` in the lock and the gate.

- [x] **CG-37 · Format Document, rename, or replace-all on a clean file opens a quiz on the user's own code.** Observed.
  - Where: `src/agentGuard.ts:269-281` with `src/agentProtocol.ts:203`. `isDirty` is still false in the first change event on a clean document, so it looks like a disk write.
  - Fix: treat editor-originated changes as the user's, and only fall back when the disk content equals the new buffer text.

- [x] **CG-38 · Holding the code confuses a live Claude Code session.** Observed.
  - Repro: Claude's second Edit failed with "File has been modified since read". Claude then re-applied the held block, which sat on disk unchecked while the first quiz was open. The student answered 3 quizzes for 2 edits.
  - Where: `src/agentGuard.ts:357`, `:115`. The duplicate-match window in `src/gateLock.ts:53` lasts only 3 s.
  - Fix: hold edits as they arrive, and match a re-applied edit to the held one.

- [x] **CG-39 · Walkthrough planning drops or skips files.** Observed except where noted.
  - Only the first 6 groups are ever walked through (`src/walkthrough.ts:143`), yet "walkthrough finished" is shown.
  - When mastery crosses 0.75 mid-walkthrough, the group size changes and a file is skipped. For a new user, passing session 1 alone does this (`src/walkthrough.ts:66`, `:81-82`, `:138`).
  - A new walkthrough overwrites one already in progress (`src/walkthrough.ts:11`, `:49`, `:54`, `:57`).
  - A snooze that expires while the editor stays open is never offered again. Inferred.
  - Fix: compute the groups once and store them, drop the 6-group cap or merge the leftovers, and keep one saved walkthrough per batch.

- [x] **CG-40 · Multi-cursor paste collapses to the first cursor.** Observed.
  - Where: `src/pasteGuard.ts:43`, `:135`. Built-in paste puts one line per cursor.

## P2: sync data

- [x] **CG-41 · The Supabase sync queue can drop, duplicate, or never send items.** Observed.
  - Overlapping flushes drop queued items and send insert-only rows twice (`src/memory/sync.ts:101-122`).
  - An expired session is never refreshed, so the queue never drains (`src/memory/sync.ts:90-99`).
  - Only the newest 200 items are kept, and retries happen only when something new is queued (`src/memory/sync.ts:103`).

## P3: noisy, misleading, or cosmetic

- [x] **CG-42 · Generation failures and bad API keys are never shown to the user.** The quiz silently falls back (`src/quiz.ts:61-63`).
- [x] **CG-43 · A missing CLI provider is reported as "returned an empty response" instead of "not installed".** `src/cliRunner.ts:167`.
- [x] **CG-44 · DNS, connection-refused, and TLS errors all log as a bare "fetch failed".**
- [x] **CG-45 · Wasted LLM calls.** The prompt allows one criterion but the check requires two (`src/llm.ts:186` vs `:327`), so those questions are generated twice. Every ordering question costs 2 calls and is always flagged (`src/walkthrough.ts:96` → `src/llm.ts:805`).
- [x] **CG-46 · `Retry-After` is ignored on 429 and 503.** `src/llm.ts:795`.
- [x] **CG-47 · Redo of a paste that already passed raises a second quiz.** `src/editGuard.ts:56-62`.
- [x] **CG-48 · `hook/notify.js` delivers an event twice when the endpoint accepts but never answers.** Once by HTTP and once through the inbox (`hook/notify.js:190`, `:198-201`, `:255-258`).
- [x] **CG-49 · `C:\ws\src\a.js` and `c:\ws\SRC\a.js` count as 2 files in a walkthrough.** `src/walkthrough.ts:149`.
- [x] **CG-50 · The guarded paste skips `editor.formatOnPaste`.**
- [x] **CG-51 · `scripts/cursor-ide.test.mjs` fails on Windows.** It expects a macOS path. This predates the robustness tests.

## Not bugs, for the record

- VSCodeVim's normal-mode Ctrl+V (block select) takes priority over the guard. Nothing is pasted, so nothing gets past the guard. Insert-mode Ctrl+V and normal-mode `p` both reach the guard.
- GitLens, EditorConfig, `insertFinalNewline`, and organize-imports on save caused no problems.
- Read-only editors, the terminal, the Debug Console, and the commit message box raise no quiz.
- Network failures before the quiz are handled well: the simple fallback quiz opens within about 30 ms, and Bypass keeps the code.

## Not tested yet

- MultiEdit. Claude Code 2.1.316 has no MultiEdit tool.
- ESLint fix-on-save. It needs the `eslint` npm package in the test workspace.
- JSON Format Document with Prettier installed. It timed out, probably on a "choose a formatter" prompt.
- Remote documents (SSH, WSL, containers).
- Walkthrough resume on the next launch and snooze expiry, in real VS Code. Unit tests with a fake `vscode` cover them.
- `npm run test:e2e:network` has never run, because of the VS Code update lock below.
- Hot exit restore (CG-27).

## Running the tests

| Command | Needs VS Code | Time | What it covers |
| --- | --- | --- | --- |
| `npm run test:unit` | No | ~30 s | Runs `test:network` and `test:claude-walkthrough` |
| `npm run test:network` | No | ~16 s | LLM, CLI runner, quiz flow, and Supabase sync under network failures (62 tests) |
| `npm run test:network:slow` | No | ~5 min | Real-time timeout and stalled-body tests (6 tests) |
| `npm run test:claude-walkthrough` | No | ~10 s | Real Claude Code 2.1.316 hook payloads and walkthrough logic (34 tests, 7 TODO) |
| `npm run test:agent` | No | ~5 s | The original agent-detection tests |
| `npm run test:integration` | Yes | ~10 min | Quiz interruptions: close, reload, crash, rename, undo (38 scenarios) |
| `npm run test:interference` | Yes | long | Other extensions and settings. Add `--use-copy` while VS Code is mid-update, `--patched` to also run the CG-01 trial build, and profile names (`plain`, `formatters`, `vim`) to run a subset |
| `npm run test:e2e:walkthrough` | Yes | long | Walkthrough and agent-quiz flows in real VS Code. `--phases live` runs one real Claude session; `--only <scenario>` runs a subset |
| `npm run test:e2e:network` | Yes | ? | Network failures in real VS Code. Not run yet |
| `npm run capture:claude -- <scenario> <outDir>` | No | ~1 min | Records a real `claude -p` run's hook payloads. Uses your Claude quota |

The VS Code suites launch the installed VS Code with a throwaway profile, extensions folder, workspace, and `COMPREHENSION_GUARD_HOME` under `%TEMP%`. They never touch your real profile, `~/.comprehension-guard`, or `~/.claude`. `test:interference` installs Vim, Prettier, ESLint, EditorConfig, and GitLens into its throwaway extensions folder only. To use a different VS Code, set `CG_VSCODE_PATH` (`test:integration`), `CG_VSCODE_EXE` (`test:interference`), or `CG_VSCODE` (`test:e2e:walkthrough`).

**VS Code update lock.** If VS Code has a background update waiting, `Code.exe` refuses to start with "Code is currently being updated". Close VS Code once to let the update finish. Until then, `test:interference --use-copy` and `test:integration` (which uses a shim automatically; set `CG_VSCODE_SHIM=0` to turn it off) run the same installed build from a temporary copy.

### Tests that encode a bug

Many tests assert today's wrong behaviour, so the suites pass while the bugs exist. When you fix a bug, flip its test:

- `test/network/`: tests named `BUG: ...` pass today and should fail after the fix. Rewrite them to assert the correct behaviour.
- `test/walkthrough.test.ts` and `test/claudeCodePayloads.test.ts`: the 7 bug tests are marked `todo`. Remove the `todo` once the fix lands.
- `test:integration` and `test:interference` report each scenario as PASS or BUG and exit 1 while any BUG remains, so they work as regression checks as they are.
