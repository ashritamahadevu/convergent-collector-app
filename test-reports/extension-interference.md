# Comprehension Guard: other extensions and editor settings

Robustness test of Comprehension Guard (worktree at commit `3b713e8`, `dist/extension.js` built with `node esbuild.js`) against other extensions, editor settings, and non-standard editors. Every scenario ran in a real VS Code window driven by `@vscode/test-electron`. Key presses were real keyboard events sent into the workbench over the Chrome DevTools Protocol (CDP), so keybinding resolution and `when` clauses were exercised. The quiz was answered or closed the way a user would: closing the tab = fail, typing an answer and clicking Submit in the webview = pass, Bypass command = bypass.

**Legend.** PASS = guard behaved correctly. BUG = bypass, false trigger, corruption, or loop. INFO = behaviour worth knowing, not clearly wrong. UNTESTED = could not be exercised (reason given). "Observed" means seen in the test run. "Inferred" means read from the code and not proven by a test.

## Environment and versions

| Item | Version / note |
|---|---|
| VS Code | 1.145.0 (commit `a717861c07`), the user's installed build |
| Comprehension Guard | 0.0.1 from this worktree |
| VSCodeVim | `vscodevim.vim@1.32.4` |
| Prettier | `esbenp.prettier-vscode@12.4.0` |
| ESLint | `dbaeumer.vscode-eslint@3.0.34` |
| EditorConfig | `editorconfig.editorconfig@0.18.2` |
| GitLens | `eamodio.gitlens@19.5.0` |
| Helper | `cgtest.cg-test-helper@0.0.1`, written for this test (`test/interference/helper-ext`). It simulates AI/agent extensions with `editor.edit`, `WorkspaceEdit`, `insertSnippet`, streamed edits, an `InlineCompletionItemProvider`, and `workspace.fs.writeFile`. |

**Launch note (needs your attention).** The installed `Code.exe` would not start. A pending background update held the `vscode-updating` mutex: `CodeSetup-stable-c4453f8...` PIDs 17924 and 32676, running since Nov 6. VS Code printed "Code is currently being updated. Please wait for the update to complete before launching."

I did not touch the installer, the updater, or your install. Instead, the harness (`--use-copy`) copies the same installed build (`Code.exe` + `a717861c07\` + `bin\`) into `%TEMP%\cg-interference\vscode-copy`. In that copy only, it sets `product.json` `win32VersionedUpdate=false` and renames the mutex, so the copy skips the update-mutex check. Same binaries, same version, no download.

Everything else was throwaway:
- `--user-data-dir`, `--extensions-dir`, workspace and `COMPREHENSION_GUARD_HOME` all under `%TEMP%\cg-interference\run-*`.
- Marketplace extensions were installed only into `%TEMP%\cg-interference\ext-formatters` and `ext-vim`.
- No API key, so the quiz is the built-in fallback webview.
- No LLM was used. Port 11434 was never bound.

Once the update finishes, `npm run test:interference` runs against the installed `Code.exe` directly.

**Patched probe build.** Most fail-path results were hidden by one bug (BUG-1 below). So the suite was also run against a temp build with a single change, made in memory at bundle time; `src/` was not modified. In that build, the post-fail `editor.edit(builder.delete(placed))` in `pasteGuard.ts`/`editGuard.ts` becomes a `WorkspaceEdit` delete. Rows marked "patched:" come from that run. They show which results BUG-1 explains, and which are separate bugs.

## Results by scenario

Profiles: **plain** = built-in extensions only; **fmt** = Prettier + ESLint + EditorConfig + GitLens; **vim** = VSCodeVim. Unless noted, a result was the same in all profiles where the test ran.

### Baseline (all profiles)

| ID | Scenario | Result | Observed |
|---|---|---|---|
| A1 | Guarded paste command, close quiz | **BUG** (patched: PASS) | Quiz opens and paste is visible. On close the paste stays; the command rejects with `TextEditor#edit not possible on closed editors`. See BUG-1. |
| A1b | Guarded paste, Bypass | PASS | Paste kept |
| A2 | Real Ctrl+V key in a focused editor | plain/fmt **BUG** (patched: PASS); vim INFO | Ctrl+V resolves to `comprehensionGuard.paste`. Fail leaves the paste (BUG-1). In Vim normal mode, VSCodeVim takes Ctrl+V (visual block): no paste, no quiz. |
| A3 | Helper `editor.edit` 300+ chars, fail | **BUG** (patched: PASS) | Quiz opens; insertion is not removed (BUG-1) |
| A5 | Is the guard still alive after one failed inline quiz? | **BUG** (patched: PASS) | Second inline insertion: no quiz. Disk change on an open background file: no quiz. See BUG-2. |
| A4 | Disk write to open background file, answer quiz | PASS | Code is withheld on disk during the quiz and written back after the pass |
| A6 | Same, close quiz | PASS | Agent code removed from disk |

### Keybindings and editor contexts

| ID | Scenario | Result | Observed |
|---|---|---|---|
| K0 | Registered Ctrl+V bindings | INFO | Plain: `editor.action.clipboardPasteAction`, terminal ×2, explorer, then `comprehensionGuard.paste when editorTextFocus && !editorReadonly`. With Vim, `extension.vim_ctrl+v when editorTextFocus && vim.active && vim.use<C-v> && !inDebugRepl` is registered after the guard, so it wins whenever `vim.use<C-v>` is set. |
| K1 | Read-only editor | PASS | No quiz, no change |
| K2 | SCM commit message box | PASS (partial) | Focus confirmed inside `.scm-editor`. The guard did not fire and the active code file was untouched. Where the text lands is not observable: CDP-generated Ctrl+V does not trigger native paste in the SCM box even for short text. |
| K3 | Integrated terminal | PASS | No quiz, file untouched |
| K4 | Debug Console input | PASS | No quiz, file untouched |
| K5 | User `settings.json` (`vscode-userdata:`) | INFO | Paste: quiz opens (patched: removed on fail). An extension inserting into settings.json is not quizzed (scheme filter). |
| K6 / K6b | Ctrl+V / paste command in the modified side of a diff editor | **BUG** (patched: still BUG) | No quiz, nothing pasted. The diff tab is replaced by a plain `k6-right.ts` editor. The command rejects with `TextEditor#edit not possible on closed editors`. Afterwards the status bar says **"Guard: Quiz open" with no quiz**, every later ≥200-char Ctrl+V shows "finish the open quiz before pasting again", and the inline and disk guards are off. Lasts until window reload. See BUG-3. |
| K7 | Multi-cursor paste (3 cursors, 3-line clipboard) | **BUG** | Built-in paste puts one line per cursor. The guard puts the whole clipboard at the primary cursor only. In Vim the result was different again (lines duplicated across cursors). See BUG-10. |
| K8 | Jupyter notebook cell | **BUG** (patched: still BUG) | Ctrl+V in a cell: quiz opens, but the paste stays after fail even with the probe fix. An extension inserting 348 chars into a cell: **no quiz, code kept** (scheme `vscode-notebook-cell` is ignored). See BUG-7. |

### Other extensions inserting code (helper extension)

| ID | Scenario | Result | Observed |
|---|---|---|---|
| D2 | One `WorkspaceEdit`: small insert above + 300-char insert below, fail | **BUG** (patched: still BUG) | Quiz opens; the 300-char block **stays after fail**. See BUG-6. |
| D3 | One `WorkspaceEdit` with two 300-char inserts, fail | **BUG** (patched: still BUG) | One quiz; **both blocks stay** |
| D4 | Inline-chat style streaming: 762 chars in 40-char edits | **BUG** | No quiz at all. See BUG-5. |
| S5c | One `WorkspaceEdit` of 10 small inserts (450 chars) on a dirty active file | **BUG** | No quiz at all. See BUG-5. |
| D5 | `insertSnippet` with tab stops | **BUG** (patched: PASS) | BUG-1 only |
| D6 | Inline completion (ghost text) accepted with Tab | **BUG** (patched: PASS) | Quiz opens on accept. Fail does not remove it (BUG-1 only). |
| D7 | Extension edits an open but not visible document, fail | PASS | Disk-fallback quiz; buffer reverted |
| D7b | Same, pass | **BUG** (patched: still BUG) | After a correct answer **the generated code is gone** from the buffer. See BUG-8. |
| D8 | Extension edits a visible but unfocused split | PASS | One quiz (no duplicate); reverted |
| D9 | Agent-style `workspace.fs.writeFile` to the active, clean file, fail | **BUG** (patched: still BUG) | Inline guard quizzes. **Disk has the code during the quiz and still after fail.** With the probe fix the buffer is cleaned (dirty), but disk keeps the agent code. See BUG-9. |
| D10 | Another extension re-applies its edit while the file is locked | **BUG** | **403 change events in 3 s** (stopped by the test's cap). The lock and the other extension fight forever. See BUG-4. |

### Editor settings and save participants

| ID | Scenario | Result | Observed |
|---|---|---|---|
| S1 | `files.autoSave=afterDelay` (300 ms) during a paste quiz | **BUG** | **Pasted code is on disk while the quiz is open.** Real build: still on disk after fail. Patched: removed after fail (autosave saved the deletion). See BUG-11. |
| S1b | `files.autoSave=onFocusChange` + inline insertion quiz | **BUG** | Opening the quiz webview is a focus change, so **the code is saved at once**. It is still on disk after fail, in both builds. |
| S2 | `files.trimTrailingWhitespace` + autoSave during a paste quiz | **BUG** | **38 change events and 19 saves in 4 s.** The save trims, the lock restores, autoSave saves again. See BUG-4. |
| S3 | `trimTrailingWhitespace` on; agent edit to an open file whose user code has trailing spaces; **pass** | **BUG** (patched: still BUG) | Agent code **not written back after a correct answer**, and the user's file was reformatted by the guard's own save. See BUG-12. |
| S3b | `insertFinalNewline` on; user file without final newline; agent edit; pass | PASS | `equivalentText` tolerates one trailing `\n` |
| S4 | `codeActionsOnSave: source.organizeImports` on the user's imports | PASS | Largest change 5 chars; no quiz |
| S5 | Format Document on the user's own minified JSON (clean file) | **BUG** (fmt: UNTESTED, timed out) | 142 changes in one event, largest 9 chars, total 621. `doc.isDirty` was **false** in that event. **A quiz opened on the user's own reformatted JSON.** See BUG-13. |
| S5b | Rename / replace-all style edit: 30 × 7 chars on a clean active file | **BUG** | Same: quiz on the user's own rename |
| S6 | `editor.formatOnPaste` with a large guarded paste | INFO (fmt: PASS) | The guarded paste is not formatted; the same paste with the guard off is. The guard inserts with `editor.edit`, so format-on-paste never runs. Cosmetic. |

### Formatters profile (Prettier, ESLint, EditorConfig, GitLens)

All baseline and D/S rows above reproduced the same way with these four extensions active.

| ID | Scenario | Result | Observed |
|---|---|---|---|
| F1 | Prettier `formatOnSave`; agent edit to an open file not formatted by Prettier; **pass** | **BUG** | Agent code **not written back after a correct answer**, and the user's code was reformatted by Prettier during the guard's revert save. Same root cause as S3 (BUG-12). |
| F2 | Prettier Format Document on the user's own unformatted one-liner | PASS | Largest change 5 chars; no quiz. Unlike S5, Prettier's minimal edits stayed under the threshold here. |
| F3 | Prettier + `formatOnPaste` paste | INFO | The 5-line clipboard turned out to be under 200 chars, so the built-in paste ran and Prettier formatted it. No second quiz came from the formatting. Weak test. |
| F4 | EditorConfig trim/final-newline on save + autoSave during a paste quiz | PASS | 2 change events, 1 save; no loop |
| F5 | ESLint fix-on-save | UNTESTED | Needs the `eslint` npm package in the workspace, and npm downloads were not approved. The same mechanism (`codeActionsOnSave`) is covered by S4. ESLint's edits apply as save-participant edits, so S3/BUG-12 also applies (inferred). |
| F6 | GitLens: commit, change on disk, open a git diff | INFO | GitLens active; no extra quiz from `git:` documents. GitLens's heavy document listeners did not interfere. |

### Vim profile (VSCodeVim 1.32.4)

| ID | Scenario | Result | Observed |
|---|---|---|---|
| A2 | Ctrl+V in normal mode | INFO | Vim takes it (visual block), so the guard never sees it. Not a bypass: nothing is pasted. |
| V1 | Ctrl+V in insert mode | PASS for detection; fail path hit by BUG-1 (patched: PASS) | Quiz opens and the text is pasted. Real build: not removed on fail. Patched: removed. |
| V2 | Normal-mode `p` with `vim.useSystemClipboard` | **BUG** in real build, BUG-1 only (patched: PASS) | Vim's own paste edit is caught by the inline guard. Removed on fail in the patched build. Vim still responds afterwards. No fight between Vim and the guard. |
| V3 | Guard paste command in normal mode, then Bypass | INFO | Paste kept. Afterwards `x` did not delete a character, so Vim's mode/cursor state changed after the quiz (inferred: the editor lost and regained focus through the webview). |
| A3, D*, S* | Inline/agent/settings scenarios with Vim loaded | same as plain | Vim did not change any guard outcome |

## Bugs (ordered by severity)

Severity order: file corruption or guard bypass > false trigger > cosmetic. Line numbers refer to `src/` at `3b713e8`.

### BUG-1: Failed quiz never removes pasted or inline code (guard bypass, critical)

- **Repro:** paste ≥200 chars with Ctrl+V into any file (or let any extension insert ≥200 chars with `editor.edit`), then close the quiz tab. The code stays. The paste command rejects with `TextEditor#edit not possible on closed editors`.
- **Observed:** A1, A2, A3, D5, D6, K5, V1, V2 in all profiles. All of them PASS with the probe fix.
- **Cause:** `createQuizPanel` opens the webview in `ViewColumn.Active` (`src/quizPanel.ts:409-415`). That covers the text editor in the same group, and VS Code disposes the hidden `TextEditor`. The post-fail delete then uses that dead handle:
  - `src/pasteGuard.ts:97-101`
  - `src/editGuard.ts:112-116`
- **Fix:** delete through `vscode.workspace.applyEdit` on `editor.document.uri`. This is exactly what the probe build does, and it fixes all the rows above. Or open the quiz `ViewColumn.Beside`. Wrap the delete in `try/catch` either way.

### BUG-2: After BUG-1, the inline and disk guards stay off for the session (guard bypass, critical)

- **Repro:** fail one inline quiz (A3). Then any later inline insertion, or disk change to an open file, is not quizzed. This lasts until the next guarded paste resets the flag.
- **Observed:** A5, all profiles. PASS with the probe fix.
- **Cause:** `src/editGuard.ts:113` sets `state.suppressEditGuard = true`, and the delete then throws. The `finally` block (`src/editGuard.ts:119-130`) resets `processing` and `quizActive` but **not** `suppressEditGuard`. That flag gates both `editGuard.ts:30` and `agentGuard.ts:227`.
- **Fix:** reset `suppressEditGuard` in the `finally`. Better, use `withoutEditGuard()` from `state.ts:88` for every guard-owned edit.

### BUG-3: Ctrl+V in a diff editor wedges the guard and breaks large pastes until reload (guard bypass + paste broken, critical)

- **Repro:** open a diff (for example SCM "Open Changes", or `vscode.diff`). Paste ≥200 chars into the modified side. Nothing is pasted, no quiz opens, and the diff view is replaced by a plain editor. From then on the status bar shows "Guard: Quiz open" with no quiz. Every ≥200-char Ctrl+V anywhere says "finish the open quiz before pasting again". The inline and disk guards stay off.
- **Observed:** K6 (real key) and K6b (command; error `TextEditor#edit not possible on closed editors`). Not fixed by the probe fix.
- **Cause:**
  - `src/pasteGuard.ts:71-74` sets `suppressEditGuard`, `processing` and `quizActive` **before** `insertSnippet`, and outside the `try`.
  - `insertSnippet` calls `showTextDocument(editor.document, { viewColumn })` (`src/pasteGuard.ts:129-133`). For a diff's modified side, that opens a normal editor in place of the diff. The diff's `TextEditor` closes and `editor.edit` (`:134`) throws. Nothing resets the three flags.
- **Fix:** move the flag setup inside the `try/finally`. Drop the `showTextDocument` call, or use the `TextEditor` it returns. Insert with `WorkspaceEdit`.

### BUG-4: The document lock fights other writers in an endless loop (loop, high)

- **Repro A (D10):** any extension that re-applies an edit when the document changes (header/license inserters, auto-fixers, live collaboration) while a quiz is open. Observed: 403 change events in 3 s, stopped only by the test's cap.
- **Repro B (S2):** `files.autoSave: afterDelay` + `files.trimTrailingWhitespace: true`, then paste code with trailing spaces. Observed: 19 saves and 38 change events in 4 s. The file on disk is rewritten about every 200 ms for the whole quiz.
- **Cause:** `src/documentLock.ts:13-38` reverts every change to the snapshot with a whole-document replace, with no limit and no backoff. Its `finally` also clears the global `suppressEditGuard` (`:36`) even when another guard set it.
- **Fix:**
  - Block user typing instead, for example with `files.readonlyInclude` / `workbench.action.files.setActiveEditorReadonlyInSession`, rather than reverting edits after they happen.
  - Failing that, stop re-reverting after N attempts.
  - Skip changes that arrive while a save is in progress (`onWillSaveTextDocument`).
  - Never write to the shared `suppressEditGuard` flag from inside the lock.

### BUG-5: Large AI insertions split into small edits are not quizzed (guard bypass, high)

- **Repro:**
  - Streaming: a helper streams 762 chars as 40-char `editor.edit` calls (how inline chat and "apply" stream results). No quiz (D4).
  - One `WorkspaceEdit` of 10 small inserts (450 chars) on a dirty active file: no quiz (S5c).
- **Cause:**
  - The inline guard needs a **single** change of at least the threshold (`src/editGuard.ts:57-59`).
  - The disk fallback skips the active dirty editor (`src/agentProtocol.ts:203`, called from `src/agentGuard.ts:269-281`).
  - Nothing adds up insertions over time.
- **Fix:** keep a per-document rolling sum of inserted characters from non-user sources, over a short window (for example 2 s, or until the next undo stop). Quiz on the sum. Undo/redo and the user's own typing (`reason === undefined` with single-character changes) can be excluded.

### BUG-6: Multi-edit `WorkspaceEdit`: the quizzed block is not removed on fail (guard bypass, high)

- **Repro:** one `WorkspaceEdit` that inserts a line at the top and 300 chars further down (D2), or two 300-char blocks (D3). The quiz opens; after fail every block stays, even with the probe fix.
- **Cause:** `src/editGuard.ts:72-74` builds `placed` from `bigChange.range.start`, which is in **pre-edit** coordinates. Any other change above it moves the real position. The safety check `getText(placed) === snippet` (`:112`) then fails, so nothing is deleted. Only the first big change is ever considered (`.find`, `:57`).
- **Fix:** compute post-edit ranges by applying the `contentChanges` offsets in order (use `rangeOffset`/`rangeLength` and adjust by the deltas of earlier changes). Quiz the combined text of all large changes, and remove all of them on fail.

### BUG-7: Notebook cells are not guarded (guard bypass, high)

- **Repro (K8):** an extension inserts 348 chars into a Jupyter cell: no quiz, code kept. A Ctrl+V paste into a cell does open a quiz, but after fail the paste stays, even with the probe fix.
- **Cause:**
  - `src/editGuard.ts:34` only accepts the `file` and `untitled` schemes. Cells are `vscode-notebook-cell`.
  - `agentGuard.ts:223` only accepts `file`.
  - The paste path calls `showTextDocument` on a cell document (`pasteGuard.ts:129`). Inferred: that resolves to a different editor, so `placed` no longer matches.
- **Fix:** accept `vscode-notebook-cell` (and `vscode-remote` for Remote-SSH/WSL/containers, which this filter also excludes; inferred, not tested). In the paste path, use the cell's editor directly.

### BUG-8: An extension's in-memory edit to a background file is lost even after a pass (generated code lost, high)

- **Repro (D7b):** with a file open in a background tab, an extension applies a 300-char `WorkspaceEdit` to it (not saved). The disk-fallback quiz opens; answer correctly. The code is not in the file afterwards.
- **Cause:** `runAgentQuiz` reads the **disk** text (`src/agentGuard.ts:314`), which does not have the in-memory edit. It passes that as `fileText` to `prepareHeldEdit` (`:315`). There, `landed = fileText` (`src/agentProtocol.ts:347`) equals `previous`, so `restore.next` is set to the pre-edit text. `applyHeldEdit` then "restores" the file without the code.
- **Fix:** when the document is open, use `findOpen(edit.filePath)?.getText()` as `fileText`. For `agent: "disk"` edits, keep the `restore.next` that `observeDocument` captured.

### BUG-9: Agent writes to the active file stay on disk after a failed quiz (guard bypass, high)

- **Repro (D9):** an agent extension (Cline/Roo/Continue style) writes ≥200 chars to the active, clean file with `workspace.fs.writeFile`. VS Code reloads the buffer as one big change, so the inline guard quizzes it, not the disk fallback.
- **Observed:** the code is on disk during the quiz. After fail it is **still on disk**. With the probe fix the buffer is cleaned but left dirty. If the user picks "Don't Save" or reverts, the agent code stays live.
- **Cause:** `src/agentGuard.ts:265-267` hands this case to the inline guard. The inline guard only edits the buffer (`editGuard.ts:112-117`) and never saves or restores the disk.
- **Fix:** in the inline guard, if the change came from a reload (document not dirty right after the change, and disk equals the buffer), treat it as a disk edit. That means reverting on disk, as `writeBack` does. Or let the agent path claim it.

### BUG-10: Multi-cursor paste is collapsed to one cursor (wrong paste result, medium)

- **Repro (K7):** 3 cursors, 3-line clipboard ≥200 chars, Ctrl+V. The built-in paste (`editor.multiCursorPaste: spread`) puts one line at each cursor. The guard pastes the whole clipboard at the primary cursor only. Under Vim the text was also duplicated at a second cursor.
- **Cause:** `src/pasteGuard.ts:43` and `:135` use `editor.selection` (singular).
- **Fix:** run the built-in `editor.action.clipboardPasteAction` inside `withoutEditGuard`, then compute the inserted ranges from the resulting change event. Or replace each `editor.selections` entry following the spread rule.

### BUG-11: Held code reaches disk through autoSave while the quiz is open (guard bypass, medium-high)

- **Repro:**
  - S1: `files.autoSave: afterDelay`. The pasted code is on disk within about 300 ms of the quiz opening.
  - S1b: `files.autoSave: onFocusChange`. The quiz webview taking focus triggers the save immediately. After fail the code is still on disk, in both builds, because the deletion is not saved until the next focus change.
- **Why it matters:** builds, test watchers, hot reload, and coding agents read the file while the quiz is still open.
- **Cause:** paste and inline code stays in the buffer during the quiz by design (`pasteGuard.ts:74`, `editGuard.ts` comment at `:24`). AutoSave is not paused.
- **Fix:** hold the code out of the buffer while the quiz is open, as the agent path already does (`runAgentQuiz` withholds). Or veto the save during the quiz: in `onWillSaveTextDocument`, `waitUntil` an edit that removes the held range. After fail, save the document if it was clean before the paste.

### BUG-12: Save participants (Prettier, trimTrailingWhitespace, ESLint fix) make the agent quiz lose the code after a pass and reformat the user's file (generated code lost + user code changed, high)

- **Repro:**
  - S3: `files.trimTrailingWhitespace: true`. Open a file that has trailing spaces in the user's code, in a background tab. An agent appends 300 chars on disk. Answer the quiz correctly. The agent code is not written back, and the user's trailing spaces were removed by the guard.
  - F1: same with Prettier `formatOnSave` and a file not formatted by Prettier.
- **Cause:**
  1. `writeBack` replaces the document with `previous`, then calls `open.save()` (`src/agentGuard.ts:480-486`). The save participants rewrite the buffer.
  2. `noteAccepted(fsPath, previous)` (`:487`) records text that is no longer in the buffer.
  3. On pass, `applyHeldEdit` → `writeBack(next, previous)` (`:432`). The buffer and the disk now differ from `previous` beyond what `equivalentText` (`src/agentProtocol.ts:96-106`) tolerates, so it returns `false`. The user sees "the check was passed, but the generated code could not be written into the file".
- **Fix:**
  - Revert without running save participants: write disk with `fs.writeFile` and then `workbench.action.files.revert` the document, or use `doc.save()` only when no participant is configured.
  - Record the post-save buffer text as the baseline.
  - On pass, re-apply the hunks to the current text (`applyHunks(current, ...)`) instead of requiring the exact `previous`.

### BUG-13: Format Document / rename / replace-all on a clean file triggers a quiz on the user's own code (false trigger, medium)

- **Repro:** open any clean file and run Format Document. For example, built-in JSON formatter on a 600-char minified JSON (S5), or a rename-style edit touching ≥200 chars (S5b). A disk-fallback quiz opens showing the user's own reformatted code. On fail the change was kept, but the quiz still says "The code was removed".
- **Observed:** `doc.isDirty === false` inside the change event for the first edit to a clean document.
- **Cause:**
  - `observeDocument` (`src/agentGuard.ts:269-281`) only skips the active editor when `isDirty` (`src/agentProtocol.ts:203`). That flag is not yet `true` when the first edit's event fires.
  - The summed total (621 / 210 chars) passes the threshold.
  - Inferred: VS Code sends the dirty-state update after the content change.
- **Fix:**
  - Treat any change with `event.reason === undefined` in the active editor as editor-originated, whatever `isDirty` says.
  - Only use the disk fallback when the change is a reload: disk content equals the new buffer text, which `fs.readFile` can confirm.
- **Prettier (F2):** its minimal edits stayed under the threshold for the tested file, but a larger file would hit this too (inferred).

### Lower-severity notes

- **formatOnPaste is skipped** for guarded pastes (S6, cosmetic). See `pasteGuard.ts:134`. Fix: use the built-in paste action inside `withoutEditGuard`, as for BUG-10.
- **`settings.json` / `keybindings.json`** (`vscode-userdata:`): pastes are quizzed, but extension insertions there are not (K5). Inconsistent, low impact.
- **README drift (inferred):** README says inline insertions are "taken back out immediately and written again only if you pass". The code leaves them in the buffer during the quiz (`editGuard.ts:24-26`). That is what makes BUG-11 possible.
- **Vim:** with VSCodeVim, Ctrl+V in normal/visual mode is Vim's visual-block command, because Vim's binding is registered after the guard's. The guard is not involved, which is correct. Insert-mode Ctrl+V and normal-mode `p` both reach the guard. After a guarded paste + Bypass, Vim's state changed (V3, inferred to be the focus round-trip through the webview).

## Patched probe build: what BUG-1 was hiding

Same suite, same profiles, one in-memory change (post-fail delete through `WorkspaceEdit`).

- **Now PASS (BUG-1 / BUG-2 only):** A1, A2, A3, A5, D5, D6, K5 (removed on fail), V1, V2.
- **Still BUG (independent bugs):** K6/K6b (BUG-3), K7 (BUG-10), K8 (BUG-7), D2/D3 (BUG-6), D4/S5c (BUG-5), D7b (BUG-8), D9 (BUG-9: buffer cleaned, disk still has the code), D10/S2 (BUG-4), S1/S1b (BUG-11: code on disk during quiz; S1b still on disk after fail), S3/F1 (BUG-12), S5/S5b (BUG-13).
- **Totals across 6 runs** (3 profiles × real/patched): 108 BUG rows and 2 ERROR rows. Both ERRORs are S5 in the fmt profile: Format Document on JSON did not finish within 60 s with Prettier installed. Inferred: the "multiple formatters" prompt. So S5 is UNTESTED in the fmt profile.

## How to run

```powershell
npm install                      # adds @vscode/test-electron (devDependency)
npm run test:interference -- --use-copy            # all profiles, real build
npm run test:interference -- plain --use-copy --patched   # plus the probe-fix build
$env:CG_ONLY="K6-diff-editor,S3-trim-agent-pass"; npm run test:interference -- plain --use-copy
```

- Leave out `--use-copy` once the pending VS Code update finishes; the harness then launches the installed `Code.exe`. `CG_VSCODE_EXE` overrides the path.
- Throwaway dirs live under `%TEMP%\cg-interference` (`CG_TMP_ROOT` overrides). Extension installs are cached per profile in `ext-<profile>`.
- Results: `test-reports/interference-results/<profile>[-patched].json`.
- Exit code is 1 while any BUG row exists.
- If a scenario wedges the guard (status "Quiz open" with no quiz), the suite stops and the runner relaunches a fresh window that continues with the next test.

## Files added (worktree only, nothing committed)

- `test/interference/runInterference.js`: launcher (profiles, throwaway dirs, extension installs, `--use-copy`, `--patched`, relaunch on wedge)
- `test/interference/suite/index.js`: in-window runner (helpers, quiz pass/fail/bypass, guard status, wedge detection)
- `test/interference/suite/tests.js`: all scenarios
- `test/interference/suite/cdp.js`: dependency-free CDP client for real key presses and webview input
- `test/interference/helper-ext/{package.json,extension.js}`: simulated AI/agent/snippet extensions
- `test-reports/extension-interference.md` (this file) and `test-reports/interference-results/*.json`
- `package.json`: `test:interference` script and `@vscode/test-electron` devDependency (`package-lock.json` updated)
