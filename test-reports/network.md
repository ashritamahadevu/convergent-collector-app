# Comprehension Guard: internet and provider failure report

Scope: what happens to held code, the file lock, the quiz UI and the grade when the LLM provider, a CLI provider, Supabase or the misgrade report URL fails, hangs or returns junk. `src/` was not modified.

Tests were run on 2026-11-07, Windows 11, Node 24.11.1. VS Code 1.145.0 is installed at the default path.

## How it was tested

- **No mock on port 11434.** A real Ollama (PID 33436, `ollama.exe`, v0.40.5) was already listening on `127.0.0.1:11434`, so I did not bind that port. The harness wraps `globalThis.fetch` instead and rewrites any `http://127.0.0.1:11434/...` URL (and, in some tests, `https://api.openai.com/...`) to a mock HTTP server on a random port or to a closed port. Requests still go over real sockets through Node's real fetch (undici), so resets, stalls and timeouts behave as they do in production. The wrapper refuses any URL that still points at `:11434`, so the real Ollama was never contacted. No real API keys were used.
- **Unit and flow tests** use `node:test` through `tsx` (`test/network/*.test.ts`), with a small `vscode` stub (`test/network/vscodeStub.ts`). `quizFlow.network.test.ts` runs the real `runComprehensionGate` (src/quiz.ts), the same function paste, inline and agent edits all go through. The webview is replaced by a fake panel that the test drives (ready, submit, bypass, dispute, close).
- **CLI providers** use a fake `claude.cmd` / `agent.cmd` (a Node script) on a private PATH. That PATH holds only the fake directory and the Windows system directories, so the real CLIs on this machine could not run.
- **Supabase and the misgrade URL** point at the mock server or a closed port.
- **Slow real-time tests** (`test/network/slow/`) wait for the real 60 s fetch timeout and undici's socket timeouts. They take about 5 minutes and run in parallel processes.
- **E2E in real VS Code** (`test/e2e/`) uses `@vscode/test-electron` with the installed `Code.exe`, a throwaway `--user-data-dir` and `--extensions-dir`, a temp workspace, and a temp `COMPREHENSION_GUARD_HOME`. **It could not run.** See "Untested" below.

Every result below is marked **Observed** (a test ran it and asserted it) or **Inferred** (read from the code, not executed).

## Results by scenario

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Network down before the quiz (connection refused, DNS failure, TLS error, reset): question generation fails | **PASS**, with a UX note (L1) | Observed: each fails in 2-45 ms with one attempt and no retry. The min-length fallback quiz opens in about 30 ms. Bypass on it keeps the code. Any text of 15 or more characters passes it (as documented). Nothing tells the user that the AI grader is offline. |
| 2 | Provider accepts the request and never answers | **BUG M1, M3** (stuck UI) | Observed: generation gives up after **181.8 s** (3 attempts of 60 s, plus 0.6 s and 1.2 s backoff), then falls back. Until then there is no quiz tab, so the user cannot answer, close or click Bypass, and the file stays locked. The Bypass command is recorded, but the hold does not end until the question arrives and the user acts again. |
| 3 | Headers arrive, body stalls or trickles | **BUG M2** (stuck UI) | Observed: a stalled body is waited on for **304 s**, until undici's own 300 s body timeout fires (error `terminated`). A body that trickles 1 byte every 5 s was waited on for the full 150 s test, through a single request. It has no limit at all. |
| 4 | Slow responses near the timeout | **PASS** | Observed: a response at 55 s succeeds in one attempt. A response at 65 s is aborted and retried 3 times, then falls back after 181.8 s. |
| 5 | Network drops after the question is shown, during grading | **BUG H1** (wrong pass) | Observed: connection refused gives `no_decision` in 0.6 s. quiz.ts then **passes the student, records `outcome: "pass"`, and raises concept mastery** (0.677 after one ungraded nonsense answer). No feedback is shown. |
| 6 | Network drops during a follow-up | **BUG H1** | Observed: the first answer was judged fail. The network then dropped, and a nonsense second answer passed. |
| 7 | Network recovers a few seconds later | Mixed | Observed: an outage shorter than about 0.6 s is absorbed by the single judge retry (PASS). An outage of 2 s or more ends in `no_decision`, which passes the student (H1). |
| 8 | Judge hangs | **BUG M4** (stuck UI) | Observed: 2 attempts of 60 s give `no_decision(timeout)` after **120.6 s**, then a pass. Nothing is sent to the webview while grading runs (no spinner, and Submit stays enabled). |
| 9 | HTTP 429 / 500 / 502 / 503 during generation | **PASS** | Observed: 3 attempts with gaps of 610 ms and 1,218 ms (about 1.8 s total), then the fallback quiz. A 429 followed by a 200 recovers. Inferred: `Retry-After` is ignored (L5). |
| 10 | HTTP 401 (bad key) | **BUG L1** (noisy / silent) | Observed: generation fails in under 2 s with no retry and shows the fallback quiz. The user is never told the key is bad. The message only reaches the output log. During grading, a 401 gives `no_decision`, which passes the student. |
| 11 | 200 with an HTML page (captive portal), empty body, or truncated transport | **PASS** | Observed: each rejects without retry and falls back. |
| 12 | Truncated or non-JSON model text | **PASS** for generation, **H1** for grading | Observed: generation fails with a parse error and falls back. A truncated judge reply gives `no_decision(parse_failed)`, which passes the student. |
| 13 | Valid JSON with the wrong shape: free-text question with no `criteria` | **BUG H3** (wrong pass) | Observed: it is accepted after a second paid generation call (`flagged: true`, `criteria: []`). The judge is never called, and any answer of 15 or more characters passes and is recorded as a pass. |
| 14 | Valid JSON with the wrong shape: multiple-choice with empty `options` | **PASS** | Observed: it is rejected with "MCQ must have 3-4 options" and falls back. |
| 15 | Judge verdicts in upper case (`"FAIL"`) | **BUG H2** (wrong pass) | Observed: `parse_failed`, then `no_decision`. **The student is passed even though the judge said FAIL.** |
| 16 | Judge echoes different criterion ids (`"1"`, `"2"` instead of `"c1"`, `"c2"`) | **BUG H4** (wrong fail, code removed) | Observed: the result is still "decided", with ids that match nothing. A missing critical id counts as fail, so a correct answer is failed 3 times and the code is removed. |
| 17 | DNS failure vs connection refused vs TLS error | **PASS** behaviour, **L3** message | Observed: all three are fast and identical. Hosted providers log only `fetch failed`, with no cause. Ollama always says "Could not reach Ollama". |
| 18 | CLI missing from PATH | **BUG L2** (noisy) | Observed: rejected as `claude failed: claude returned an empty response.` instead of "not installed". Falls back in 388 ms. |
| 19 | CLI hangs past `timeoutMs` | **PASS** | Observed: rejected at the timeout, and `taskkill /T` killed the fake CLI process. Inferred: through llm.ts the timeout is 120 s per call, and grading makes 2 calls, so about 240 s before an auto-pass. |
| 20 | CLI prints garbage (exit 0) | **PASS** for generation, **H1** for grading | Observed: generation fails with a parse error and falls back. Grading gives `no_decision(parse_failed)`, which passes the student. |
| 21 | CLI exits non-zero, or is not signed in | **PASS** | Observed: stderr is surfaced. A "Please run /login" message is recognised as not signed in. |
| 22 | Supabase offline | **PASS** (does not block, does not throw) | Observed: `queueReview` returns immediately, the op stays queued, and there are no unhandled rejections. A hung Supabase does not block `logReview`. |
| 23 | Supabase queue retry and integrity | **BUG S1, S2, S3** (data, not code) | Observed: the queue is retried only when a new op is queued. There is no timer or online event. Concurrent flushes overwrite the queue, so `q2` was dropped and never sent. Online, the insert-only `review_events` row `q1` was POSTed twice. The queue silently keeps only the newest 200 ops. With an expired session every upsert gets a 401, no refresh is tried, and the queue never drains. |
| 24 | Misgrade report, URL unreachable | **PASS** | Observed: the report is saved locally, the quiz finishes, and the user is told "could not be reached". |
| 25 | Misgrade report, URL accepts but never answers | **BUG M5** (stuck UI) | Observed: after clicking "My answer was right" the quiz stays open and the file stays locked. It was still waiting after 3 s and finished only when the server answered. Inferred: undici's default 300 s headers timeout is the only limit. |
| 26 | `no_decision` outcome | **BUG H1** | Observed: quiz.ts:265-269 keeps the code and records a pass. Inferred: the walkthrough path (`runSession`, quiz.ts:372-374) also sets `passed = true`. |
| 27 | User actions during slow grading | **BUG H5, H7, L6** | Observed: a second Submit click is replayed, which uses up a follow-up and fails the user without them answering the follow-up. A Bypass button click during the last grading is ignored when that grade fails, so the code is removed. Closing the tab during grading still keeps the code if grading then fails over. The Bypass command (not the button) during grading is honoured. |
| 28 | Agent-edit quiz and the Bypass command | **BUG H6** | Observed at unit level: agent quizzes never set `quizActive`, so `bypassNext` cannot reach them. It arms a one-shot bypass for the next unrelated insertion instead. Closing the quiz then discards the agent's code. E2E confirmation was blocked (see Untested). |
| 29 | Reload or quit VS Code to escape a stuck agent-edit quiz | **BUG H8** (code loss) | Inferred: the agent's code is reverted on disk before the quiz (agentGuard.ts:357) and kept only in extension memory. A reload during a stuck generation loses it, and the hook event has already been consumed. Paste and inline code survive a reload because they stay in the dirty buffer. |

## Bugs

Severity order: code loss or wrong pass/fail, then stuck UI, then data/sync, then noisy error.

### Code loss / wrong pass or fail

**H1. A provider failure during grading passes the student and records a genuine pass.** (Observed)
- Repro: provider is ollama. Generation succeeds, then the provider becomes unreachable (or returns 429, 401, 5xx, garbage, truncated JSON, or times out). Submit any answer of 15 or more characters.
- Code: `src/quiz.ts:265-269` (`no_decision` leads to `recordAttempt(true, "pass")` and `return true`). The walkthrough has the same behaviour at `src/quiz.ts:372-374`. Mastery and Supabase are updated from it through `rememberCheck`.
- Fix: keep the "never trap the user's code" rule, but do not count the result. Record an `ungraded` outcome and skip `rememberCheck`. Tell the user ("Grader unreachable: code kept, not counted"). Better still, keep the quiz open with "Retry grading" and Bypass, or fall back to an MCQ/ordering question generated earlier.

**H2. Upper-case or other non-canonical verdicts turn a FAIL into a pass.** (Observed)
- Repro: the judge returns `"verdict":"FAIL"` (or `"Fail"`, or `"passed"`).
- Code: `src/llm.ts:749-754` (`normalizeVerdict` is case-sensitive) and `src/llm.ts:102` (`VERDICT_REGEX` has no `i` flag). The resulting `parse_failed` then hits H1.
- Fix: `String(v).trim().toLowerCase()`, accept `passed`/`failed`, add the `i` flag to the regex. Treat a parsed-but-unrecognised verdict as fail for that criterion, not as `no_decision`.

**H3. A generated free-text question with no criteria passes any answer.** (Observed)
- Repro: the generator returns valid JSON without `criteria`, or with an empty array.
- Code: `src/llm.ts:805-813` returns the retried question with `flagged: true` and `criteria: []`. `src/llm.ts:843-846` returns `decided` with no verdicts. `src/decision.ts:111` treats `[].every(...)` as all critical criteria passed. `flagged` is never read by `src/quiz.ts`.
- Fix: in `generateQuestion`, throw (so the caller falls back) when a free-text question has no criteria after the retry. In `aggregate`, return `fail` or `borderline` when the criteria list is empty.

**H4. Judge ids that differ from the rubric ids fail a correct answer.** (Observed)
- Repro: the judge echoes ids like `"1"`/`"2"` or `"criterion_1"` with `pass` verdicts.
- Code: `src/llm.ts:701` keeps the judge's `row.id`. `src/decision.ts:84-93` then counts each missing critical id as `fail`. After `maxFollowups` attempts the code is removed (quiz.ts:298-300).
- Fix: assign ids positionally (`id: ids[i]`), as the regex fallback already does. Or, if any id is unknown, map by position or return `parse_failed`.

**H5. Bypass clicked in the panel during the last grading is ignored if that grade fails, and the code is removed.** (Observed)
- Repro: `maxFollowups` = 1 (or the last attempt), with slow grading. Click Submit, then Bypass before the result comes back. The judge returns fail.
- Code: `src/quizPanel.ts:434-442` parks the Bypass message in `queuedAction`. `src/quiz.ts:251` checks only `takeQuizBypass()` (the command flag), and `src/quiz.ts:298-300` then returns `false`. For an agent edit, that discards the held code.
- Fix: after `judge` returns, check for a queued bypass or cancel action before acting on the verdict. Better, race the judge promise against panel actions and let Bypass win at once.

**H6. The Bypass command does not reach an agent-edit quiz, and it arms a bypass for the next unrelated insertion.** (Observed in a unit test; E2E was blocked.)
- Repro: an agent (or a disk write to an open background file) triggers a quiz. Run "Bypass Next Insertion" while it is generating or open, then close the quiz. The agent code is discarded, and the next large paste goes in without a check.
- Code: `src/agentGuard.ts:339-342` sets `state.processing` but never calls `setQuizActive(true)`. `src/extension.ts:72-85` then falls through to `setBypassArmed(true)`.
- Fix: call `setQuizActive(true)`/`(false)` around `runComprehensionGate` in `runAgentQuiz`, as pasteGuard and editGuard do.

**H7. A second Submit click during slow grading is replayed and uses up a follow-up.** (Observed)
- Repro: `maxFollowups` = 2 with a slow judge. Click Submit twice. The result is a fail without the user ever answering the follow-up.
- Code: `src/quizPanel.ts:434-442` queues the second submit. `src/quiz.ts:286-296` shows the follow-up (which clears the textarea), then `waitForQuizAction` returns the queued stale submit immediately. The webview never disables Submit (`src/quizPanel.ts:378`).
- Fix: post a `grading` state that disables Submit, and drop any submit that arrives while grading. Clear `queuedAction` when showing a follow-up.

**H8. Reloading during a stuck agent-edit quiz loses the agent's code.** (Inferred)
- Repro: an agent edit arrives while the provider hangs (M1/M2). The user reloads the window to get unstuck.
- Code: `src/agentGuard.ts:357` writes the previous text back to disk before the quiz. The new text exists only in `prepared` in memory.
- Fix: persist the withheld edit (for example under `COMPREHENSION_GUARD_HOME/held/`) before reverting, and offer to restore it on activation. Fixing M1/M3 also removes the reason to reload.

### Stuck UI

**M1. There is no UI while the question is generated: up to 181.8 s observed, about 364 s possible.** (Observed 181.8 s; the doubled figure is inferred.)
- Repro: the provider accepts the connection and never answers. Paste 200+ characters.
- Code: `src/quiz.ts:53-66`. The panel is created only after `generateQuestion` resolves. The retries come from `src/llm.ts:781-799`, and a lint retry adds a second full `runGenerateWithRetry` at `src/llm.ts:806`.
- Fix: open the panel immediately in a "Preparing question..." state with Bypass, Close and "Skip to simple check" buttons. Cap the total generation budget (for example 20-30 s across all attempts) rather than per attempt.

**M2. The fetch timeout does not cover the response body.** (Observed: 304 s stall, unbounded trickle.)
- Code: `src/llm.ts:432-443`. The timer is cleared in `finally` as soon as headers arrive, and the body reads (`res.json()`/`res.text()` at llm.ts:490/493, 525/528, 560/563, 608/611) have no deadline.
- Fix: keep the abort timer running until the body is consumed. For example, have `fetchWithTimeout` return `await res.text()` under the same signal, or use `AbortSignal.timeout(ms)` for the whole call.

**M3. The Bypass command during generation is deferred.** (Observed)
- Code: `src/quiz.ts:305-322`. `waitForQuizAction` subscribes only after the panel opens and checks `takeQuizBypass()` only after an action arrives, so a bypass requested earlier is not applied on its own.
- Fix: check `takeQuizBypass()` before waiting, and race generation against the bypass listener so the gate returns `true` immediately.

**M4. Grading can take 120.6 s (or about 240 s for CLIs) with no busy indicator.** (Observed 120.6 s; the CLI figure is inferred from `CLI_TIMEOUT_MS`, llm.ts:59, times 2.)
- Code: `src/quiz.ts:243`, `src/llm.ts:879-883`, and no "grading" message in `src/quizPanel.ts`.
- Fix: show a "Grading..." state, use a shorter judge budget, and treat the panel's Bypass and close as immediate.

**M5. A misgrade report POST without a timeout freezes the quiz and keeps the file locked.** (Observed; the 300 s limit is inferred from undici's default.)
- Code: `src/store.ts:98` (bare `fetch`), awaited in `src/quiz.ts:155`.
- Fix: save locally, close the quiz, and send the report in the background (`void`) with `AbortSignal.timeout(5000)`.

### Data and sync (no code loss)

**S1. The sync queue is not safe when flushes overlap.** (Observed: one queued op lost, one insert duplicated.)
- Code: `src/memory/sync.ts:101-122`. Every `queue*` fires `flushSync`. Each flush snapshots the queue, sends it, then writes its own `remaining`, overwriting ops queued in the meantime. `review_events` and `prep_sets` are insert-only, so a duplicate send creates duplicate rows.
- Fix: run one flush at a time (a promise chain or a flag plus a "dirty" re-run). Remove only the ops that succeeded, by id, from the current queue. Give insert-only rows a client UUID with `on_conflict`.

**S2. An expired session is never refreshed.** (Observed with a 401 mock.)
- Code: `src/memory/sync.ts:90-99`. `expiresAt` and `refreshToken` are stored but never used.
- Fix: refresh through `/auth/v1/token?grant_type=refresh_token` when the session has expired or a 401 comes back.

**S3. The queue keeps only the newest 200 ops and retries only on the next enqueue.** (Observed)
- Code: `src/memory/sync.ts:103` (`slice(-200)`). Flushes start only from `queue*` and `signIn`.
- Fix: raise the cap or compact it (keep only the latest upsert per key), retry on activation and on a backoff timer, and add timeouts to the fetch at `sync.ts:133`.

### Noisy or misleading errors

**L1. A generation failure is silent.** (Observed) `src/quiz.ts:61-63` swallows the error. The user gets "What does this code do?" with no hint that the grader is offline or that the API key was rejected (401). Fix: show a one-line notice in the fallback panel, and a distinct "API key rejected" message for 401/403.

**L2. A missing CLI is reported as "returned an empty response".** (Observed) At `src/cliRunner.ts:167`, `exit $LASTEXITCODE` exits 0 when PowerShell cannot find the command. Fix: `if (-not $?) { if ($LASTEXITCODE) { exit $LASTEXITCODE } else { exit 127 } }`, and include stderr ("is not recognized").

**L3. DNS, refused and TLS errors all log as `fetch failed`.** (Observed) Fix: include `err.cause?.code` (`ENOTFOUND`, `ECONNREFUSED`, `ERR_SSL_*`) in the messages from `callOpenAI`/`callAnthropic`/`callGemini`.

**L4. A 1-criterion rubric always triggers a second paid generation call.** (Observed) The prompt allows "1-3 atomic criteria" (`src/llm.ts:327`), but `rubricLintFailed` requires at least 2 (`src/llm.ts:186`). This doubles generation latency on slow networks.

**L5. `Retry-After` is ignored.** (Inferred) The backoff at `src/llm.ts:795` is a fixed 600 ms × 2^n.

**L6. Closing the tab during grading does not always remove the code.** (Observed) `src/quiz.ts:265-284` acts on the verdict without checking whether the panel was disposed. Fix: if the panel was disposed during grading, return `false` (or treat it as the user's cancel).

## Untested

- **E2E in real VS Code: blocked by the environment.** `Code.exe` refused to start both times: "Code is currently being updated. Please wait for the update to complete before launching." A VS Code background update (`CodeSetup-stable-*` processes) holds the `vscode-updating` mutex and waits for the running VS Code to close. I did not touch the installer or the running VS Code. The suite is ready (`npm run test:e2e:network`). It covers scenario A (offline paste: fallback, lock, Bypass keeps code), B (generation hang: no tab, lock, deferred Bypass), and C/C2 (agent disk-write quiz with a hang, then Bypass command ignored, armed bypass leaking to the next paste). Run it once the update has finished.
- The grading-phase webview cannot be clicked from an extension test, so grading scenarios are covered only by the fake-panel flow tests.
- The streaming case was not exercised: no provider call uses `stream: true`. The trickling body (M2) is the closest equivalent.
- The real proxy and `http.fetchAdditionalSupport` wrapper in the VS Code extension host was not exercised (it needs the E2E run). The undici 300 s defaults were observed under Node 24 and inferred for the Electron Node.
- Non-ASCII prompts through the Windows PowerShell pipe to stdin CLIs were not tested (only ASCII was verified).

## How to run

```powershell
npm install                       # once; adds @vscode/test-electron (devDependency)
npm run test:network              # 62 tests, about 16 s (llm, quiz flow, CLI, sync)
npm run test:network:slow         # 6 real-time tests, about 5 min (60 s timeouts, body stall, trickle)
npm run test:e2e:network          # real VS Code, throwaway profile; needs Code.exe startable
```

Set `VSCODE_EXE` to point the E2E run at another VS Code binary. The fast suite's `BUG:` tests assert the current (buggy) behaviour, so they pass today and are meant to be flipped when each fix lands.

Unrelated, pre-existing: `npm run test:agent` passes `agentDetection` (13/13), but `scripts/cursor-ide.test.mjs` fails one macOS-path test on Windows. I did not change it.

## Files added or changed

- `test/network/vscodeStub.ts`, `test/network/installVscodeStub.ts`: the `vscode` stub and its module-resolution hook.
- `test/network/harness.ts`: the mock provider server (hang, stall, trickle, reset, truncate, status codes), the fetch redirect with a :11434 guard, the fake ExtensionContext, and fixtures.
- `test/network/llm.network.test.ts`, `quizFlow.network.test.ts`, `cliRunner.network.test.ts`, `sync.network.test.ts`.
- `test/network/slow/common.ts` and `*.slow.test.ts` (genTimeout, judgeTimeout, underTimeout, bodyStall, drip).
- `test/e2e/run.mjs`, `test/e2e/suite/index.js`.
- `package.json` / `package-lock.json`: added the `@vscode/test-electron` devDependency and the scripts `test:network`, `test:network:slow`, `test:e2e:network`.
- `test-reports/network.md` (this file).
