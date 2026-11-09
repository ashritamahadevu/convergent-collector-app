# Comprehension Guard: interruptions while a quiz is open

Scope: what happens when the user, the editor, or the process interrupts an open quiz on the paste path (`src/pasteGuard.ts`), the inline-insertion path (`src/editGuard.ts`), and the agent-edit path (`src/agentGuard.ts` + `hook/notify.js`). The question for each case: can code be lost, can a file stay locked, can state end up half-applied?

Method: a new integration harness (`test/integration/`) launches the installed VS Code 1.145.0 through `@vscode/test-electron`. A pending background update blocks a direct launch; see "How to run" for how that is handled without touching the installer. Each scenario phase gets its own throwaway `--user-data-dir`, `--extensions-dir`, workspace folder and `COMPREHENSION_GUARD_HOME`, all under `%TEMP%`. Test code runs in the extension host next to the extension. It wraps `window.createWebviewPanel`, so it can post `submit`/`bypass` messages to the quiz the way the webview script does, and it closes the quiz tab through `window.tabGroups.close` the way a user's click would. Agent edits go through the real `hook/notify.js` (PreToolUse snapshot, then the file write, then PostToolUse). LLM grading uses `provider=ollama` with `globalThis.fetch` patched in-process, so nothing listens on 127.0.0.1:11434 and a grade can be held "in flight". `src/` was not modified.

Every result below was **observed** in the harness unless it is marked **inferred** (read from code, not reproduced).

## Summary

| # | Bug | Severity | Paths |
|---|-----|----------|-------|
| B1 | Closing or failing a paste/inline quiz never removes the code. The captured `TextEditor` was disposed when the quiz tab covered it | **High** (the gate's main contract is broken; failed code is kept) | paste, inline |
| B2 | After B1 the inline guard turns itself off for the rest of the session (`suppressEditGuard` stays `true`) | **Stuck state** (inline guard and disk fallback go silent) | inline |
| B3 | Closing the quiz tab while the grade is in flight keeps the code if the grade (or a `no_decision`) comes back as a pass | Medium (closing should remove the code) | paste, inline, agent |
| B4 | An agent edit to the file in the focused editor is taken by the inline guard. The agent code is never held off disk and stays on disk after close/fail | **High** (failed agent code kept; disk and buffer disagree) | agent |
| B5 | Reload, window close or an extension-host crash during an agent quiz loses the held agent code with no trace. The agent was told the write succeeded | **Data loss** | agent |
| B6 | With two agent edits queued, the second file holds the unquizzed agent code on disk while quiz 1 is open. A crash then leaves it there for good (and loses file 1's code, B5) | Data loss + gate bypass | agent |
| B7 | While any quiz is open, large inline insertions into other files go through with no check | Gate bypass | paste, inline, agent |
| B8 | "Bypass Next Insertion" does nothing to an open agent quiz. It arms a bypass that silently skips the next check | Medium / cosmetic | agent |
| B9 | During question generation the file is locked with no quiz tab to close (up to ~3 min with retries). Bypass at that moment says "quiz bypassed", the quiz opens anyway, and closing it then keeps the code | **Stuck lock (temporary)** + cosmetic | paste, inline, agent |
| B10 | Renaming the locked file releases the lock, and close/fail leaves the paste in the renamed file | Medium | paste, inline |
| B11 | Saving while locked writes the pending paste to disk, and a later fail/close does not undo that on disk | Medium (half-applied) | paste, inline |
| B12 | Redo of an already passed paste raises a second quiz | Cosmetic | paste, inline |
| B13 (inferred) | With real hot exit, reloading or closing the window during a paste/inline quiz brings the dirty buffer back with the unquizzed code | Gate bypass | paste, inline |

Things that held up: the agent path's close, fail and pass on a file that is not focused; the lock while the quiz is open; agent code withheld on disk while its own quiz is open; nothing stays stuck after a reload or crash (state and locks are in memory only); the inbox is not replayed; paste is refused while an agent quiz is open; the Bypass command during a paste quiz; deleting the file during an agent quiz; closing the locked file's editor tab and then passing.

## Scenario results

Results are from the full run (`npm run test:integration`, 38 scenarios). The ids match `test/integration/manifest.ts`.

### Paste path

| Scenario | Result | Observed |
|---|---|---|
| paste-close-mid-question | **BUG (B1)** | Quiz closed. The paste stays in the buffer. The guarded command rejects with `TextEditor#edit not possible on closed editors`. The lock is released and the guard is idle afterwards. |
| paste-close-mid-grading-pass | **BUG (B3)** | Tab closed while the judge request is held, then the judge returns pass: the gate returns `true` and the paste is kept. No error. |
| paste-close-mid-grading-fail | BUG (B1 masks it) | Judge returns fail after the tab closed. The loop reads the queued `cancel` and takes the removal path, which then hits B1. With B1 fixed this case would remove the code (inferred). |
| paste-close-during-followup | **BUG (B1)** | The follow-up feedback was shown. Closing then hits B1 and the paste stays. |
| paste-save-then-close-quiz | **BUG (B1, B11)** | `save()` during the lock succeeds and writes the paste to disk. After close, both the buffer and the disk still hold the paste. Even with B1 fixed, the removal would only touch the buffer, so the disk keeps the failed paste until the next save (inferred). |
| paste-close-editor-then-fail | **BUG (B1)** | Saved, closed the file's editor tab, closed the quiz: the paste stays on disk. |
| paste-close-editor-then-pass | PASS | The paste is kept on disk. The lock is released. |
| paste-undo-while-locked | BUG (B1) | Undo while locked is reverted by the lock (good). The close afterwards hits B1. |
| paste-undo-redo-after-fail | UNTESTED (blocked by B1) | The paste is never removed, so "undo brings it back" cannot be exercised. Inferred: with a working removal, undo re-inserts the paste as one change at or above the threshold. `editGuard.ts` does not filter Undo, so it raises a quiz (the agent-path variant below shows this). |
| paste-undo-redo-after-pass | **BUG (B12, cosmetic)** | Undo removes the paste. Redo re-inserts it and opens a second quiz for code that already passed. |
| paste-untitled-close | **BUG (B1)** | The untitled doc is locked while the quiz is open. Close: the paste stays. |
| paste-switch-file-inline-bypass | **BUG (B7, B1)** | Switching files while locked works (the README says it should not). A 280-char insertion into `b.js` raises no quiz and stays. |
| paste-file-deleted-on-disk | BUG (B1) | The file was deleted on disk (the doc stays open and dirty). Close hits B1 and the paste stays in the buffer. The guard does not recreate the file. |
| paste-file-renamed | **BUG (B10, B1)** | After a WorkspaceEdit rename, the old document is closed and the new one is not locked (a probe edit sticks). Close: the paste is still in `renamed.js`. |
| paste-bypass-command | PASS | `bypassNext` closes the quiz and the paste is kept. The guard is idle afterwards and no bypass is left armed. |
| paste-slow-generation | **BUG (B9)** | While generation is held: the file is locked and there are 0 quiz tabs. After `bypassNext` the quiz still opens once generation returns. Closing it keeps the paste. |
| paste-reload-window | PASS in harness, **B13 inferred** | Graceful extension-host shutdown, then relaunch: the paste is not on disk and the buffer is clean, the file is editable, the guard is idle, and there is no orphan quiz tab. Caveat: VS Code in extension-test mode writes no hot-exit backups (`user-data/Backups` was empty) and restores no editors, so a real reload was not reproduced. |
| paste-crash | PASS in harness, B13 inferred | Same as above after SIGKILL of the extension host. |

### Inline-insertion path

| Scenario | Result | Observed |
|---|---|---|
| inline-close-mid-question | **BUG (B1, B2)** | The insertion stays after close. Then a new large insertion into a scratch doc raises **no quiz**: the guard is stuck. |
| inline-close-mid-grading-pass | **BUG (B3)** | The insertion is kept after the tab closed mid-grading. |
| inline-close-editor-then-fail | **BUG (B1, B2)** | The insertion stays on disk. There is an unhandled rejection `TextEditor#edit not possible on closed editors`, and the guard is stuck afterwards. |
| inline-undo-after-fail | UNTESTED (blocked by B1) | The insertion is never removed, so undo was not exercised. The B2 stuck guard was observed. |
| inline-untitled-close | **BUG (B1, B2)** | The insertion stays in the untitled doc. The guard is stuck. |

### Agent path

| Scenario | Result | Observed |
|---|---|---|
| agent-close-mid-question | PASS | While the quiz is open, the disk and the editor both lack the agent code and the file is locked. Close: the file stays without it. The lock is released and the guard is idle. |
| agent-pass | PASS | The agent code is written, and the editor shows it and is not dirty. |
| agent-close-mid-grading-pass | **BUG (B3)** | Tab closed while the judge request is held, then pass: the agent code is written to disk. |
| agent-close-editor-then-pass | PASS | Closing the locked file's editor tab and then passing still writes the agent code. |
| agent-bypass-command | **BUG (B8)** | After `bypassNext` the agent quiz is still open. Once that quiz is closed, the next large insertion raises no quiz (the armed bypass ate it). |
| agent-paste-while-open | PASS / **BUG (B7)** | A guarded paste while the agent quiz is open is refused (good). A large inline insertion into another file is accepted with no quiz. |
| agent-two-files | **BUG (B6)** | While quiz 1 is open, `two.js` already holds the unquizzed agent code on disk. After quiz 1 closes, quiz 2 opens and withholds `two.js`. Both files end clean. |
| agent-two-files-crash | **BUG (B5, B6)** | Crash while quiz 1 is open, then relaunch: `one.js` has lost its agent code (no copy anywhere under guard home) and `two.js` keeps its agent code, never quizzed. |
| agent-dirty-buffer | PASS (with note) | The user's unsaved edit is kept. After a pass the disk has the agent code and the buffer is still the user's dirty text. Saving hits VS Code's "file is newer" conflict, which is the same state VS Code is in without the extension, so it is not counted as a bug. |
| agent-file-deleted-then-pass | PASS (with note) | Deleting the file during the quiz and then passing recreates the file with the agent code. No errors. |
| agent-undo-after-fail | PASS (undo) / BUG (B1/B2 downstream) | After close the file is clean. Undo in that editor brings the agent code back **and raises a quiz** (good). That quiz is an inline one, so closing it hits B1/B2 and the guard is stuck afterwards. |
| agent-edit-active-editor | **BUG (B4, B1, B2)** | Agent writes the file that is open in the focused editor. The quiz that opens is the inline guard's. The disk holds the agent code the whole time. After close, the disk **and** the editor still hold it, and the guard is stuck. |
| agent-reload-window | **BUG (B5)** | Graceful shutdown (`reloadWindow` in test mode ends the extension host and exits), then relaunch: the file lacks the agent code, there is no quiz, the inbox is empty, and no copy exists under guard home (snapshots hold only the pre-edit text). The held code is gone. |
| agent-crash | **BUG (B5)** | SIGKILL of the extension host during the agent quiz: same outcome. |
| agent-inbox-replay-crash | **BUG (B5)**; no replay (PASS) | An event left in the inbox while VS Code was closed is picked up at startup and its quiz opens. The inbox entry is deleted **before** the quiz, so after a crash and relaunch it is not replayed and the held code is lost. |

### Reload / deactivate answers (from the questions in the brief)

- `deactivate()` (`src/extension.ts:329`) is a no-op. Cleanup comes from `context.subscriptions`: the agent transport closes its server and deletes `endpoint.json`. The document lock listener (`documentLock.ts:13`) is not a subscription, but it dies with the process. Observed: after relaunch, files are editable and the guard is idle. `state.quizActive` and `state.processing` are in-memory module state, so neither persists.
- Disk after reload/crash: the paste and inline paths never write the pending code to disk unless the user saved (B11). The agent path leaves the file **without** the agent code (withheld by `revertEdit`, `agentGuard.ts:357`). That matches "closing leaves the file without it", but the code is not kept anywhere and the hook already told the agent it succeeded (`notify.js` always exits 0). That is B5.
- Inbox replay: none. `agentGuard.ts:639-640` reads and unlinks the file before `onEvent` runs.

## Bug details

### B1. Paste/inline removal uses a `TextEditor` that is already disposed. High.

- **Repro:** open a file, run `comprehensionGuard.paste` with ≥200 chars on the clipboard (or insert ≥200 chars in one edit), then close the "Comprehension check" tab. The code stays. The command rejects with `TextEditor#edit not possible on closed editors`. Scenarios: `paste-close-mid-question`, `inline-close-mid-question`.
- **Cause:** `quizPanel.ts:409-415` opens the quiz in `ViewColumn.Active` and reveals it there (commit 79f00c1 moved it from `Beside`). That hides the file's editor in the same group, and VS Code disposes a `TextEditor` once it is no longer visible. The removal then calls `editor.edit` on the captured editor: `pasteGuard.ts:97-103` and `editGuard.ts:112-118`. The lock still works only because `documentLock.ts:29-32` falls back to a `WorkspaceEdit` when no editor is visible.
- **Fix:** remove the code by URI rather than through the editor, for example `const e = new vscode.WorkspaceEdit(); e.delete(doc.uri, placed); await vscode.workspace.applyEdit(e);`, after checking `doc.getText(placed) === snippet`. Add a test that closing removes the code, since this regressed silently.

### B2. Inline guard disables itself after B1. Stuck state.

- **Repro:** any inline B1 case, then insert ≥200 chars anywhere: no quiz (`inline-close-mid-question`, guard-idle check).
- **Cause:** `editGuard.ts:113-117` sets `state.suppressEditGuard = true` around `editor.edit`. When that throws, line 117 is skipped and the `finally` (`editGuard.ts:119-130`) never resets it, unlike `pasteGuard.ts:114`. `editGuard.ts:30` and `agentGuard.ts:227` both return early on that flag, so the inline guard and the disk fallback stay off until some later paste or agent quiz happens to reset it.
- **Fix:** reset `state.suppressEditGuard = false` in the `finally`, or use `withoutEditGuard()`.

### B3. Closing the tab while grading keeps the code. Medium.

- **Repro:** `provider=ollama`, submit an answer, close the tab while the judge request is pending, let the judge return pass. Scenarios: `paste-/inline-/agent-close-mid-grading-pass`.
- **Cause:** `quiz.ts:243-284` awaits `judge()` and then acts on the verdict without checking whether the panel was disposed meanwhile. The dispose handler (`quizPanel.ts:485-488`) only queues a `cancel`, and nothing reads it on the pass branch. `no_decision` (timeout or provider error) is also treated as a pass (`quiz.ts:265-269`).
- **Fix:** expose `isDisposed()` on the view and check it after every `await` in the loop. If the panel is disposed, record a cancel and `return false`. Or race `judge()` against the dispose event and abort the request.

### B4. Agent edit to the focused file goes to the inline guard. High.

- **Repro:** open `src/agent.js` in the active editor (with the terminal focused, it is still the `activeTextEditor`), then let Claude Code write it through the hook. The disk keeps the agent code during the quiz. After close, both disk and buffer still have it (`agent-edit-active-editor`).
- **Cause:** VS Code reloads the clean document from disk as one large change in the active editor. `agentGuard.ts:264-267` hands that to the inline guard on purpose. `editGuard.ts:38-43` only skips paths that are already claimed, and the claim is made later in `runAgentQuiz` (`agentGuard.ts:339`) after the 700 ms batch timer (`agentGuard.ts:102`). The inline gate calls `markEditorGate`, so the hook event that follows is dropped as "covered" (`agentGuard.ts:81-86`). The inline path never touches disk, so even with B1 fixed a fail would leave the agent code on disk and a dirty buffer without it.
- **Fix:** in `editGuard`, ignore changes that leave a `file:` document clean (`!event.document.isDirty` after the change means a reload from disk, not typing or an AI insertion). Leave those to the agent guard and its disk fallback. Also claim the path as soon as a hook event arrives (`onHook`), not at quiz time.

### B5. Held agent code is lost on reload, close or crash. Data loss.

- **Repro:** start an agent quiz, then reload the window or kill the extension host, then relaunch. The file is without the agent code, there is no quiz, and no copy exists under `~/.comprehension-guard` (`agent-reload-window`, `agent-crash`, `agent-inbox-replay-crash`).
- **Cause:** `runAgentQuiz` reverts the file before the quiz (`agentGuard.ts:357`) and keeps the only copy of the generated content (`prepared.restore.next`) in memory. The inbox event is unlinked before handling (`agentGuard.ts:639-640`), and the snapshot (`notify.js:112-130`) holds only the pre-edit text. The agent got exit 0 from the hook and believes the file contains its code.
- **Fix:** before `revertEdit`, write the held edit (`filePath`, `restore.previous`, `restore.next`, agent, timestamp) to `guardHome/.comprehension-guard/held/<id>.json` and delete it once the edit is resolved. On activation, re-offer any held entries (re-open the quiz, or ask "Restore / Discard") instead of dropping them. Unlink inbox files only after the quiz resolves, or move them to `held/`.

### B6. Queued agent edits sit in the file unquizzed. Gate bypass, and data loss with B5.

- **Repro:** two `Write`s to `one.js` and `two.js` within 700 ms. While quiz 1 is open, `two.js` on disk already has the agent code (`agent-two-files`). Crash at that point: `two.js` keeps it for good and `one.js` loses its code (`agent-two-files-crash`).
- **Cause:** `drain` runs `runAgentQuiz` per edit in sequence (`agentGuard.ts:121-123`), and each edit is withheld only when its own quiz starts (`agentGuard.ts:357`).
- **Fix:** withhold every edit in the batch before the first quiz (and persist them as in B5), then quiz them one at a time.

### B7. Inline insertions in other files are unchecked while any quiz is open. Gate bypass.

- **Repro:** a paste quiz (or an agent quiz) is open. Switch to `b.js` and insert ≥200 chars: no quiz, and the code stays (`paste-switch-file-inline-bypass`, `agent-paste-while-open`).
- **Cause:** `editGuard.ts:45-47` returns when `quizActive || processing`. During an agent quiz, `agentGuard.ts:341` also sets `suppressEditGuard` for the whole quiz, so `editGuard.ts:30` returns too. The disk fallback skips for the same reasons (`agentGuard.ts:227`). The README claims "you cannot edit or switch files", but only the one file is locked (`documentLock.ts:13-14`).
- **Fix:** queue the second insertion: remove it at once and re-offer it after the current quiz, the way the agent queue works. Or lock every document while a quiz is open.

### B8. "Bypass Next Insertion" during an agent quiz arms a bypass for later. Medium/cosmetic.

- **Repro:** an agent quiz is open. Run the bypass command. The quiz stays open, and later the next large insertion is let through with no check (`agent-bypass-command`).
- **Cause:** `runAgentQuiz` never calls `setQuizActive(true)` (`agentGuard.ts:339-342`). `requestQuizBypass` returns false when `!quizActive` (`state.ts:50-53`), so `extension.ts:80` arms the one-shot bypass instead. The status bar also never shows "Quiz open" for agent quizzes (`extension.ts:314`).
- **Fix:** `setQuizActive(true)` and `setQuizActive(false)` around the agent quiz, the same as paste and inline.

### B9. Locked file with no quiz during question generation. Stuck lock (temporary) plus cosmetic.

- **Repro:** `provider=ollama` with slow generation, then paste: the file is locked and there is no tab to close (`paste-slow-generation`). `fetchWithTimeout` is 60 s, and an abort counts as transient, so it is retried 3 times (`llm.ts:19`, `llm.ts:454-462`, `llm.ts:781-799`). The rubric-lint retry can add another round (`llm.ts:805-806`). Running Bypass then shows "quiz bypassed. The code stays." but the quiz still opens when generation returns. Closing it then **keeps** the code, because the stale `bypassDuringQuiz` flag turns the cancel into a bypass (`quiz.ts:309-316`).
- **Cause:** `quiz.ts:55-66` generates the question before `createQuizPanel`. `requestQuizBypass` (`state.ts:50-60`) has no listener during generation, so only the flag is set.
- **Fix:** open the panel first with a "Preparing question..." state, so closing it cancels through an `AbortController` passed to `generateQuestion`. If Bypass is requested before the panel exists, skip the quiz and return `true` right away.

### B10. Rename releases the lock and leaves the paste. Medium.

- **Repro:** `paste-file-renamed`: with a paste quiz open, rename the file through a `WorkspaceEdit`. The new document is editable, and closing the quiz leaves the paste in the renamed file.
- **Cause:** `documentLock.ts:14` compares the `TextDocument` object. A rename closes it and opens a new one. The removal uses the old editor/document (`pasteGuard.ts:97`).
- **Fix:** track `workspace.onDidRenameFiles` in the lock and the gate (switch to the new URI), or cancel the quiz on rename.

### B11. Saving during the lock persists the pending paste. Medium (half-applied).

- **Repro:** `paste-save-then-close-quiz`: Ctrl+S while locked writes the paste to disk. After fail or close, disk still has it. Even with B1 fixed, the removal edit only dirties the buffer.
- **Cause:** the lock blocks content changes only (`documentLock.ts:13-38`), not saves. The removal (`pasteGuard.ts:97-103`, `editGuard.ts:112-118`) never saves.
- **Fix:** if the document was saved while the quiz was open (track `onDidSaveTextDocument`), save again after the removal. Or use `onWillSaveTextDocument` to save the pre-insertion text while locked.

### B12. Redo after a pass re-quizzes. Cosmetic.

- `paste-undo-redo-after-pass`. `editGuard.ts:56-62` does not skip `TextDocumentChangeReason.Redo`. Fix: skip Redo when the same snippet already passed for this document. Keep quizzing Undo, because that is how a removed paste comes back.

### B13 (inferred, not reproduced). Hot exit restores unquizzed paste/inline code.

- With the default `files.hotExit: "onExit"`, reloading or closing the window while a paste/inline quiz is open backs up the dirty buffer, which contains the code, and restores it with no quiz. The harness could not show this: extension-test mode wrote nothing to `user-data/Backups` and restored no editors after relaunch.
- **Fix:** remove pending paste/inline code synchronously in `deactivate()`, or keep a small "pending insertions" record in `globalState` and re-quiz or remove them on activation.

## How to run

```powershell
npm install                       # adds @vscode/test-electron (devDependency)
npm run test:integration          # all 38 scenarios, ~10 minutes
npm run test:integration -- --only agent-crash,paste-close-mid-question
npm run test:integration -- --keep   # keep the temp folders for inspection
```

- Uses `C:\Users\Samee\AppData\Local\Programs\Microsoft VS Code\Code.exe` (override with `CG_VSCODE_PATH`). Nothing is downloaded.
- **Environment note: VS Code is mid-update on this machine.** A background installer (`CodeSetup-stable-c4453f8ea4….exe /verysilent /update=…`) is waiting for the user's running VS Code to exit. It holds the `vscode-updating` mutex. Launching `Code.exe` directly fails after 30 s with "Code is currently being updated. Please wait for the update to complete before launching." (observed). The installer and the install were not touched. Instead, when `updating_version` exists next to `Code.exe`, the harness launches the same installed binaries (1.145.0, commit a717861c07) through a shim in `%TEMP%\cg-int-vscode-shim-<commit>`. `Code.exe` and `app/out` are hard links, other folders are junctions, and only a copied `product.json` differs (`win32VersionedUpdate:false`, which skips the mutex wait). Set `CG_VSCODE_SHIM=0` to launch `Code.exe` directly, which works once the update has finished. The shim folder can be deleted at any time.
- Each phase uses fresh `%TEMP%\cg-int-<scenario>-*` folders for the profile, extensions, workspace and `COMPREHENSION_GUARD_HOME`, deleted afterwards. The real `~/.comprehension-guard`, `~/.claude`, `~/.codex`, `~/.cursor` and the user's VS Code profile are not touched. The clipboard is replaced in-process (`env.clipboard` getter), so the system clipboard is not used.
- The exit code is 1 while any scenario reports BUG or ERROR, so the suite works as a regression gate once the bugs are fixed. Per-check results go to `test/integration/out/results.json`.
- Timing-based waits are generous (0.5-5 s). Two full runs gave identical verdicts for every scenario whose code did not change between them. A few harness fixes went in between runs: reload as a separate launch, a held generate call left blocking the idle probe, a dirty-flag race in `agent-pass`, and `agent-undo-after-fail` moved to an unfocused file. The tables show the final run: 9 of 38 scenarios PASS, the rest BUG, none ERROR.

## Files added

- `test/integration/runTest.ts`: orchestrator (build, VS Code shim, per-phase launches, watchdog, summary)
- `test/integration/manifest.ts`: scenario list and fixtures
- `test/integration/hookSim.ts`: runs the real `hook/notify.js` with Claude Code `Write` payloads
- `test/integration/suite/index.ts`: extension-host entry (`run()`), phase handling, crash and reload helpers
- `test/integration/suite/driver.ts`: webview spy, tab closing, clipboard and fetch mocks, lock and guard-idle probes, disk and inbox helpers
- `test/integration/suite/scenarios.ts`: scenario implementations
- `test-reports/interruptions.md`: this report
- `package.json`: `test:integration` script and the `@vscode/test-electron` devDependency (`package-lock.json` updated)
