# Comprehension Guard: Claude Code detection and walkthrough mode

Tested 2026-11-07/08 on Windows 11, Node 24.11.1.

- **Claude Code 2.1.316**, `claude -p ... --model haiku --permission-mode acceptEdits --setting-sources project`. That makes 9 real headless runs in all: 8 capture runs plus 1 live run against the running extension. Total cost was about $0.07.
- **VS Code 1.145.0** (commit a717861c07), the user's per-user install, driven by `@vscode/test-electron` with a throwaway `--user-data-dir`, `--extensions-dir` and workspace, and `COMPREHENSION_GUARD_HOME` set to a temp dir.
- `src/` was not changed and nothing was committed. `~/.claude/settings.json` and `~/.comprehension-guard` were never touched. Every Claude run used a project-level `.claude/settings.json` built from `planHookInstall()` output, plus a capture hook.

**Environment note.** The installed VS Code would not start: `Code is currently being updated`. Two `CodeSetup-stable-*` processes hold the `vscode-updating` mutex while the user's own VS Code window stays open. I did not touch the installer. Instead I copied the install (`Code.exe` + `a717861c07\` + `bin\`) into my scratchpad and set `"win32VersionedUpdate": false` in **the copy's** `product.json`. That one setting is what enables the mutex check. The binaries are the user's installed build and nothing was downloaded. The copy has been deleted. To re-run `npm run test:e2e`, either finish or restart the pending VS Code update, or point `CG_VSCODE` at a similar copy.

Legend:
- **PASS**: works as documented.
- **BUG**: does not work as documented.
- **UNTESTED**: could not be tested, with the reason.
- **[observed]**: I saw it in a real run (live Claude, or the real extension in VS Code).
- **[inferred]**: read from the code and not reproduced.

## 1. Scenarios

### A. Does it detect Claude Code edits?

| # | Scenario | Result | Evidence |
|---|---|---|---|
| A1 | Edit **below** 200 chars (`'hi'` -> `'hello'`) | PASS [observed] | Payload delivered; the parsed snippet is 17 chars, so it is skipped. |
| A2 | Edit **above** 200 chars, then pass | PASS [observed] | Captured payload replayed in VS Code: 1 quiz, code kept off disk while the quiz is open, file locked (my typing was rolled back), code written back on pass. |
| A3 | Same, then close the quiz (fail) | PASS [observed] | File equals the text before the edit. |
| A4 | Write of a **new** file, then fail | PASS [observed] | `tool_response.type === "create"` gives `created: true`. File hidden during the quiz and gone after it (sent to the Recycle Bin). |
| A5 | Write **overwriting** a file, then pass | PASS [observed] | The PreToolUse snapshot comes back in the envelope. Old text on disk during the quiz, new text after a pass. |
| A6 | **MultiEdit** | UNTESTED | Claude Code 2.1.316 has no MultiEdit tool: the `init` tool list has Edit, Write, NotebookEdit, Bash and PowerShell. The matcher entry does no harm. The parser path is covered by the existing synthetic tests. |
| A7 | **NotebookEdit** on .ipynb | Detected: PASS. Revert: **BUG-A1** [observed] | Quiz opens, but closing it leaves the new cell in the notebook and shows the warning "the file had already changed again so it was left as-is". |
| A8 | Edits via **Bash** (`sed -i`, `cat >>`, `echo >`) | Missed by hooks, as expected [observed] | 3 Bash PostToolUse events, 0 notifier calls. The Windows build also has a **PowerShell** tool, which is missed the same way [inferred from the tool list]. |
| A9 | Bash-style write to a file **open** in the editor | PASS [observed] | The disk fallback quizzed it, and closing the quiz reverted it. |
| A10 | Bash-style write to a file **not** open | Missed (documented limitation) [observed] | — |
| A11 | 4 open files changed at once (checkout) | PASS [observed] | No quiz. |
| A12 | Relative vs absolute path | PASS [observed] | Even when told to use `src/rel.js`, Claude sends an absolute `file_path`. A relative path resolves against `cwd` (unit test). |
| A13 | Windows paths with spaces | PASS [observed] | Project `proj with spaces`, guard home `guard home (x86)`, files `my module.js` and `sub dir\new file.js`. Hooks ran, posts arrived, paths parsed exactly. |
| A14 | Same file edited twice in one run (hooks only) | PASS [observed] | Two ordered events, each with its own snapshot. The small edit is skipped and the large one quizzed. |
| A15 | Same file edited twice **with the extension live** | PASS, but see **BUG-L1** [observed] | Details below the table. |
| A16 | Editor closed: inbox | PASS [observed] | With no endpoint, `notify.js` writes `inbox/<ts>.json`. |
| A17 | Inbox freshness (3 min) | PASS [observed] | In VS Code, an inbox event 181 s old was deleted without a quiz. One 170 s old was quizzed and reverted. |
| A18 | Does the notifier block or slow Claude? | PASS [observed] | Synchronous PreToolUse plus the tool itself takes about 200 ms per Edit. PostToolUse is `async: true`. With an endpoint that never answers, the run took 14 s, the same as normal runs. |
| A19 | Hook output Claude could read as a decision | PASS [observed] | In 88 hook runs across 8 sessions, `stdout`, `stderr` and `output` were empty, `exit_code` was 0 and `outcome` was `success`. |
| A20 | Endpoint accepts but never answers | Minor **BUG-A2** [observed] | `notify.js` gives up after 1.5 s and also writes the inbox, so the same event is delivered twice. |
| A21 | Last edit lost when `claude -p` exits | Not observed | Every edit PostToolUse was delivered, including the last edit before exit. |

**A15 in detail.** The first edit was held behind a quiz left open for 25 s. Claude's second Edit then failed with `File has been modified since read`. Claude re-read the file, saw the TODO back, and re-applied the first block, then the second. The re-applied code sat on disk without a check while the first quiz was still open, and the student was quizzed 3 times for 2 edits. The final file was correct, with one `clamp`, plus `median`.

### B. Walkthrough mode

These ran in real VS Code with the real extension. Edits were fed through `hook/notify.js` exactly like Claude: PreToolUse, then the file write, then PostToolUse, using the captured payload shapes.

| # | Scenario | Result | Evidence |
|---|---|---|---|
| B1 | auto, 2 files / 80 lines in one batch | PASS [observed] | 2 quizzes, no toast. |
| B2 | auto, 7 files in one batch | PASS [observed] | Toast "7 files changed..." with Start session 1 / Later today / Snooze. |
| B3 | Held code and locks while a walkthrough is offered | **BUG-B1** [observed] | Agent code is on disk in 7/7 files. No file lock and no quiz. It stays after Snooze, Later today or dismiss. |
| B4 | New agent edit while the walkthrough toast is unanswered | **BUG-B2** [observed] | 0 quizzes while the toast was pending, and the new file's code was on disk. The quiz appeared only after the toast was answered. |
| B5 | auto, **one** file, 600 short lines | **BUG-B3** [observed] | "1 files changed" walkthrough instead of a held check. Code on disk during and after the session. |
| B5a | auto, one file, 600 lines of about 50 chars (30 kB) | Held quiz (inconsistent with B5) [observed] | Lines are counted after the 24 000-char cut, so this file counts as about 480 lines, under 500. |
| B6 | Start: session 1 with MC, free-text and ordering, all correct | PASS [observed] | One panel with 3 questions in that order. |
| B7 | mode=walkthrough, 2 files, toast dismissed | PASS [observed] | Toast shown and no quiz. Saved with a 24 h snooze (unit test). |
| B8 | mode=walkthrough, 2 files, Later today | PASS [observed] | 8 h snooze (unit test checks the value). |
| B9 | mode=learn, 8 files in one batch | PASS [observed] | 8 quizzes, no toast. |
| B10 | Real Claude timing: 8 Writes about 1.5 s apart, first quiz open 13 s | **BUG-B4** [observed] | Details below the table. |
| B11 | 15 agent edits while one check is open (learn) | **BUG-B5** [observed] | 13 quizzes. 2 edits were dropped ("skipping extra agent edits") and their code stays on disk without a check. |
| B12 | Snooze, Later today, dismiss values | PASS [observed, unit] | +24 h, +8 h, +24 h. |
| B13 | Resume on next activation; snooze expiry | Unit test: PASS [observed with fake vscode]. Real VS Code: UNTESTED | VS Code 1.145 under test-electron wrote no `state.vscdb`, so globalState did not survive between launches and the resume phases had nothing to resume. Code also shows resume is only checked at activation (`extension.ts:46`): a snooze that expires while the editor stays open is never re-offered [inferred]. |
| B14 | Pass a session | PASS [observed] | `session` goes 0 -> 1. The last session clears state and shows "walkthrough finished". |
| B15 | Fail a session (every answer wrong) | **BUG-W1** [observed, unit] | The session still counts as passed and advances. |
| B16 | Close the quiz mid-session | PASS [observed, unit] | Not advanced, no snooze, offered again on the next activation. |
| B17 | No question could be generated (LLM down or no key) | **BUG-W2** [observed, unit] | 0 questions counts as a pass. |
| B18 | Mastery-based group size | PASS by itself [observed, unit] | Mastery under 0.75 (including none) gives 1 file per session; 0.75 or more gives 2. The size is recomputed each session, which causes **BUG-W4**. |
| B19 | More than 6 groups (`slice(0, 6)`) | **BUG-W3** [observed, unit] | With 7 files and low mastery (exactly the auto threshold), the 7th file is never walked through, yet "walkthrough finished" is shown. |
| B20 | Duplicate paths / `\` vs `/` in `collapse()` | PASS [observed, unit] | Merged, and the snippets are concatenated. |
| B21 | Case or drive-letter variants (`C:\ws\src` vs `c:\ws\SRC`) | **BUG-W6** (cosmetic) [observed, unit] | Counted as 2 files. |
| B22 | Second large change while a walkthrough is saved | **BUG-W5** [observed, unit] | The single globalState slot is overwritten and the earlier walkthrough is lost. |
| B23 | Non-core files (md, json, css, html) | Counted in "N files changed" but never quizzed [observed, unit] | — |

**B10 in detail.** In the live capture, 8 Writes issued in **one** assistant message reached the notifier 1.4 to 1.8 s apart. That is wider than the 700 ms batch window. Replayed in VS Code: mod1 got a held quiz. mod2 to mod8 were on disk without a check while that quiz was open. Then they were offered as a "7 files changed" walkthrough and kept after Snooze.

**Is keeping the code during a walkthrough intended?** The code is written to show the walkthrough as an after-the-fact study session. `offerWalkthrough` takes the edits and never holds, reverts or locks anything. The README, though, says "The code stays only after you demonstrate understanding" and "The generated code stays in the quiz, not in the file". So either the README or the behavior is wrong. Combined with B5, B10 and B11, ordinary Claude Code use lands agent code with no check at all. I treat it as a bug.

## 2. Bugs, by severity

### Severity 1: undetected agent edit, or code kept without a check

**BUG-B1: a walkthrough never holds, reverts or locks the agent code.**
- Repro: `mode=auto`, an agent writes 7 or more files within 700 ms (or `mode=walkthrough` with 2 files). Choose Snooze, Later today, dismiss, or Start and then close.
- Seen: all code is on disk and the files are editable [observed, B3].
- Code: `src/agentGuard.ts:117-119` sends the batch to `offerWalkthrough`, skipping `runAgentQuiz`'s `holdPath`, `revertEdit` and `lockDocument`. `src/walkthrough.ts:21-59` only saves state.
- Fix: decide the contract. If code should be gated, withhold all files in the batch (reuse `revertEdit`) until session 1 passes, or at least until the user picks Start. Otherwise, fix the README and the mode description so they say a walkthrough does not gate code.

**BUG-B4: real Claude multi-file changes never batch. The first file gets a quiz and the rest become an ungated walkthrough.**
- Repro: `claude -p "In ONE response issue 8 parallel Write calls..."` (fixture `parallel-writes.json`). Events arrive about 1.5 s apart. Leave the first quiz open for more than 10 s.
- Seen: 1 quiz, then "7 files changed", with 8/8 files on disk [observed, B10].
- Code: `src/agentGuard.ts:99-102` (700 ms debounce) and `:115-118` (the backlog collected during a quiz is judged as one batch).
- Fix: group edits by Claude `session_id` / `prompt_id` (both are in the payload) over a longer window, or until a `Stop` hook. Hold every queued edit the moment it is enqueued, not when its quiz starts.

**BUG-B3: a single large file escapes the quiz (auto line threshold).**
- Repro: `mode=auto`, an agent Writes one file of 500 or more lines with short lines (under 24 kB).
- Seen: "1 files changed" walkthrough, code kept [observed, B5].
- Code: `src/state.ts:172-175` (`lineCount >= threshold` with no file-count minimum). `src/agentGuard.ts:116` also counts lines on snippets already cut to 24 000 chars (`:74`, `:98`), so a 30 kB file of the same line count gets a held quiz instead (B5a).
- Fix: require `fileCount > 1` in auto mode (as walkthrough mode already does), and count lines on the untruncated snippet.

**BUG-B2: an unanswered walkthrough toast stalls the guard. Later agent edits sit on disk without a check.**
- Repro: trigger B2 and leave the toast alone. Have the agent write another large file.
- Seen: no quiz while the toast is pending. The code is on disk. The quiz appears only after the toast is answered [observed, B4]. VS Code notification promises stay pending until the user acts.
- Code: `src/agentGuard.ts:118` awaits `offerWalkthrough`, which awaits `showInformationMessage` (`src/walkthrough.ts:41`) inside `drain`.
- Fix: do not await the toast inside `drain`. Save the offer and return, or keep processing individual quizzes while the offer is open.

**BUG-B5: more than 12 queued edits are silently dropped.**
- Repro: `mode=learn`, keep one check open, and have the agent write 14 more large files.
- Seen: 13 quizzes for 15 edits, 2 "skipping extra agent edits" status messages, 14/14 files on disk [observed, B11].
- Code: `src/agentGuard.ts:91-96`.
- Fix: never drop silently. Hold the extra edits (revert them) and process them later, or fold the overflow into a walkthrough that actually gates (see BUG-B1).

**BUG-A1: failing a NotebookEdit check keeps the new cell.**
- Repro: the captured `notebook.json` NotebookEdit. Close the quiz.
- Seen: the notebook is unchanged by the revert, with the warning "the file had already changed again so it was left as-is" [observed, A7].
- Cause: `.ipynb` stores `new_source` JSON-escaped, so `revertHunks` on the file text finds nothing. `old_source`, `original_file` and `updated_file` are in `tool_response` and the PreToolUse snapshot is in the envelope, but `src/agentProtocol.ts:577-605` reads `old_source` only from `tool_input` (`:588`) and ignores both. Then `src/agentGuard.ts:382-389` keeps the code.
- Fix: for NotebookEdit, set `restore = { previous: snapshot ?? tool_response.original_file, next: readFile(path) ?? tool_response.updated_file }` (as `editsFromWrite` does).

**BUG-W1: a walkthrough session passes even when every answer is wrong.**
- Seen: `session` advances [observed, unit test `BUG-W1`].
- Code: `src/quiz.ts:411-416`. A wrong answer only shows feedback and the function then returns `true`.
- Fix: return `passed` only when enough questions pass (for example, all of them, or 2 of 3), and keep the session index otherwise.

**BUG-W2: a session with no questions counts as passed.** This happens with no API key, the model down, or parse failures.
- Code: `src/quiz.ts:334-336`. `src/walkthrough.ts:90-102` swallows every generate error.
- Fix: treat 0 questions as "not run". Fall back to `runComprehensionGate`'s offline gate, or keep the session pending.

**BUG-W3: only the first 6 groups are ever walked through.**
- Repro: 7 core files (the default auto threshold) and mastery under 0.75. The 7th file is never covered, yet "walkthrough finished" is shown.
- Code: `src/walkthrough.ts:143`.
- Fix: drop the `slice(0, 6)`. To cap the effort, merge the leftovers into the last session or schedule more sessions.

**BUG-W4: a file is skipped when mastery crosses 0.75 mid-walkthrough.**
- For a new user, passing session 1 alone lifts `unspecified` or the tag's mastery past 0.75, so session 2 jumps from file 1 to file 3 [observed, unit].
- Code: `src/walkthrough.ts:81-82` and `:66` recompute groups from live mastery, while `saved.session` is an index into the old grouping (`:138`).
- Fix: compute the groups once in `offerWalkthrough`, store them in `SavedWalk`, or track completed file paths instead of an index.

**BUG-W5: a new walkthrough overwrites one in progress.**
- Code: `src/walkthrough.ts:11` (one key) and `:49`, `:54`, `:57`.
- Fix: keep a list keyed by project or batch, or merge the files.

**BUG-L1: withholding the code confuses a live agent.**
- Repro: a real Claude run that edits the same file twice while the first check is open.
- Seen: Claude's second Edit fails with "File has been modified since read". Claude re-reads and re-applies the withheld block, which then sits on disk without a check while the first quiz is still open (its own quiz comes later). The student answers 3 quizzes for 2 edits [observed, live L1].
- Code: `src/agentGuard.ts:357` (revert while the agent is still running) and `:115` (the queue waits for the open quiz).
- Fix: hold new edits as soon as they arrive (see BUG-B4), and dedupe an edit whose added text matches the held one (`isCoveredByEditorGate` only lasts 3 s, `gateLock.ts:53`). Or tell the agent through a PostToolUse `additionalContext` message that the code is held pending a check. That needs JSON output, which the notifier deliberately avoids today.

**Inferred only: any exception during the quiz writes the code in.**
- Code: `src/agentGuard.ts:393-395` (`catch { unlock(); await applyHeldEdit(prepared); }`). This fails open.
- Fix: on error, keep the code withheld and show a warning, or re-queue the edit.

### Severity 2: wrong revert

None observed. Reverts for Edit, Write (new and overwrite), the disk fallback and the inbox event were all exact (A2 to A5, A9, A17).

### Severity 3: cosmetic or cost

- **BUG-A2: duplicate delivery.** When the endpoint accepts but does not answer within 1.5 s, the event goes both by HTTP and to the inbox [observed]. It only happens if the extension host is stalled. Code: `hook/notify.js:190`, `:198-201`, `:255-258`. Fix: put a unique id (`tool_use_id`) in the envelope and dedupe in `onHook`.
- **BUG-W6: case or drive-letter variants are counted twice.** `collapse()` only swaps slashes (`src/walkthrough.ts:149`). Fix: key by `normPath()`.
- **Line count measured after truncation** (`src/agentGuard.ts:116`). See BUG-B3.
- **Every ordering question costs 2 generate calls and is always flagged.** `src/walkthrough.ts:96` passes `mode: "free-text"` for ordering, so `rubricLintFailed([])` (`src/llm.ts:805`) runs on it [observed, unit]. Fix: pass the kind as the mode, or skip the lint when `kind !== "free-text"`.
- **No re-offer after a snooze expires while the editor stays open.** Resume runs only at activation (`src/extension.ts:46`). Fix: add a timer [inferred].
- **Pre-existing failure** in `scripts/cursor-ide.test.mjs` on Windows. A macOS path regex fails against `\Users\...` output. This is not related to this work and was there before.

## 3. How to run

```powershell
npm install
npm run test:claude-walkthrough   # node:test, no editor, no network: 34 tests (27 pass, 7 TODO = known bugs)
npm run test:e2e                  # builds, then launches VS Code; needs no pending VS Code update, or CG_VSCODE=<Code.exe>
node test/e2e/run.js --keep --phases main --only auto-2files,notebook-fail   # a subset
node test/e2e/run.js --phases live   # 1 real `claude -p --model haiku` run against the live extension
npm run capture:claude -- edit-twice <outDir>   # 1 real Claude run, records payloads
npx tsx test/claude-live/analyze.ts <outDir>    # feeds captures through editsFromHookEnvelope
npx tsx test/claude-live/make-fixtures.ts <outDir>   # writes test/fixtures/claude-code/<version>/
```

Tests marked `{ todo: "BUG-..." }` assert the documented behavior. They fail today and are reported as TODO, so the suite stays green. The paired `observed: ...` tests pin the current behavior.

Capture scenarios (`test/claude-live/run-scenario.ts`): `edit-twice`, `write-new-overwrite`, `multiedit` (not run, since the tool is absent), `notebook`, `bash-edits`, `relative-inbox`, `spaces`, `parallel-writes`, `blackhole`.

## 4. Files added

All paths are under `C:\Users\Samee\Documents\GitHub\convergent-collector-app\.claude\worktrees\agent-a91f994235ecb4992`.

- `test/claude-live/capture.js` is the capture hook. `receiver.js` stands in for the endpoint. `run-scenario.ts` runs one real Claude session. `analyze.ts` and `make-fixtures.ts` process the results.
- `test/fixtures/claude-code/2.1.316/*.json` holds 8 sanitized real captures: hook stdin, delivered envelopes and final files.
- `test/claudeCodePayloads.test.ts` replays the real payloads through the parser and `notify.js`.
- `test/walkthrough.test.ts` and `test/walkthrough/{fake-vscode,mock-llm,register}.cjs` test the walkthrough logic with a fake `vscode` and an in-process LLM mock (fetch is replaced, so 11434 is never bound).
- `test/e2e/run.js` is the launcher. `test/e2e/suite.js` holds the in-extension-host scenarios. `test/e2e/live.js` is the live Claude phase.
- `test-reports/e2e-full-run.json` is the full main/resume run. `test-reports/e2e-last-run.json` is the B5/B6 re-run and the live run.
- `package.json` gains the devDependency `@vscode/test-electron` and the scripts `test:claude-walkthrough`, `test:e2e` and `capture:claude`. `package-lock.json` changed with it.
