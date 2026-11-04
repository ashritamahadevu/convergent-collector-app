# Comprehension Guard

A VS Code extension that makes sure you actually understand code before it lands in your file. When you paste a large chunk of code, when a large AI-generated snippet is inserted inline (Copilot/Cursor/"apply"), or when an AI coding agent such as Claude Code writes a file, the extension asks you a comprehension question. The code stays only after you demonstrate understanding.

## What it does today

- Intercepts `Ctrl+V` / `Cmd+V` and, if the clipboard content is large enough, runs a comprehension check before pasting.
- Detects large inline insertions (AI completions, apply-from-chat, snippet expansion) via document change events. The code stays visible during the check and is removed if you do not pass.
- Detects file edits from AI coding agents (Claude Code, Codex, and the Cursor agent) after you install their hooks, and runs the same check. A large change that lands on an open file from outside the focused editor can raise the check even without hooks.
- **AI-powered comprehension checks:** when an API key is configured, the extension generates a context-specific question for the snippet and opens a webview quiz. In **free-text** mode your answer is graded by an LLM-as-judge against atomic criteria; in **multiple-choice** mode you pick an option and grading is deterministic. Without an API key, it falls back to the simple modal prompt ("What does this code do?") with a minimum explanation length.
- **Local learning stats:** attempts (including concept tags and pass/fail) are stored in the extension's global state.
- Deadline escape hatch: a one-shot "Bypass Next Insertion" command.
- Status bar indicator showing On / Off / Bypass armed (click to toggle).

## Setup: API key

1. Set `comprehensionGuard.provider` (and optionally `comprehensionGuard.model`) in Settings.
2. Run **Comprehension Guard: Set API Key** from the Command Palette. The key is stored encrypted in VS Code **SecretStorage** (per provider).

To remove a key, run **Comprehension Guard: Clear API Key**.

Design details for question generation and grading: [docs/llm-grading.md](docs/llm-grading.md).

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `comprehensionGuard.enabled` | `true` | Enable/disable the guard. |
| `comprehensionGuard.charThreshold` | `200` | Minimum characters in a single paste, inline insertion, or AI-agent edit before the check triggers. |
| `comprehensionGuard.minAnswerLength` | `15` | Minimum explanation length (characters) for the **offline** input-box fallback when no API key is set. |
| `comprehensionGuard.provider` | `openai` | LLM provider: `openai`, `anthropic`, `gemini`, or `ollama` (local, no API key; default model `qwen2.5-coder:7b`). |
| `comprehensionGuard.model` | `""` | Model id; empty uses a sensible mid-tier default for the provider. |
| `comprehensionGuard.gradingMode` | `free-text` | `free-text` (LLM judge) or `multiple-choice` (deterministic). |
| `comprehensionGuard.nonCriticalPassFraction` | `0.5` | Fraction of non-critical rubric criteria that must pass (all critical criteria must pass). |
| `comprehensionGuard.maxFollowups` | `3` | Maximum follow-up questions in one gate session. |

## Commands

- `Comprehension Guard: Paste (guarded)` - bound to `Ctrl+V` / `Cmd+V`.
- `Comprehension Guard: Toggle On/Off`.
- `Comprehension Guard: Bypass Next Insertion (deadline escape hatch)`.
- `Comprehension Guard: Set API Key`.
- `Comprehension Guard: Clear API Key`.
- `Comprehension Guard: Show Learning Stats` - summary in the **Comprehension Guard** output channel.
- `Comprehension Guard: Install AI Agent Hooks` - register Claude Code, Codex, and Cursor hooks so edits from those agents raise the same check. Safe to run again.

## Output channel and judge validation

When an API key is configured, judge and generator logs (config id, verdicts, latency, `no_decision` reasons, etc.) are appended to the **Comprehension Guard** output channel (View > Output, then select the channel).

To regression-test the judge against a small gold set:

```powershell
npm run eval:judge
npm run test:agent   # agent-edit detection, no editor required
```

## Develop and run from source

Prerequisites: Node.js 20+.

```powershell
npm install
```

Then press `F5` in VS Code / Cursor. This runs the `watch` build task and launches an **Extension Development Host** window with the extension loaded. Open a file in that window and try pasting a large block of code (200+ characters) or triggering an AI completion to see the comprehension check.

Other scripts:

```powershell
npm run compile   # one-off production build to dist/
npm run watch     # rebuild on change (used automatically by F5)
```

## Install into your own VS Code / Cursor

To use it day-to-day (outside the debug host), package it into a `.vsix` and install:

```powershell
npm run package
```

This produces `comprehension-guard-0.0.1.vsix` in the project root. Install it with either method:

- CLI: `code --install-extension comprehension-guard-0.0.1.vsix` (use `cursor --install-extension ...` for Cursor).
- UI: open the Extensions panel, click the `...` menu at the top, choose **Install from VSIX...**, and select the file.

Reload the window after installing. The status bar should show a shield icon with "Guard: On".

> Note: the first `npm run package` may prompt about a missing publisher or repository field; those are fine to ignore for local installs, or add a `publisher` to `package.json` before publishing to a marketplace.

## How detection works

- **Paste path:** a keybinding remaps `Ctrl+V` to `comprehensionGuard.paste`, which reads the clipboard, checks the threshold, runs the gate, and then calls the built-in paste command. See [src/pasteGuard.ts](src/pasteGuard.ts).
- **Inline path:** `workspace.onDidChangeTextDocument` flags any single insertion at or above the threshold in the focused editor. The inserted code stays visible during the check and is removed if you do not pass. A re-entrancy flag ensures the guard ignores its own edits. See [src/editGuard.ts](src/editGuard.ts).
- **Agent path:** Claude Code, Codex, and Cursor can run `hook/notify.js` after they edit a file. The script posts the edit to the extension on localhost, or leaves it in an inbox if the editor is closed. The same check runs, and a failed check reverts that edit. See [AI coding agents](#ai-coding-agents) and [src/agentGuard.ts](src/agentGuard.ts).

## AI coding agents

Paste and inline detection only see edits made inside the editor. Claude Code, Codex, and the Cursor agent write files from their own processes. Hooks are how the extension hears about those writes. A command installs them for you.

1. Open this extension (F5 for a development host, or an installed VSIX).
2. Run **Comprehension Guard: Install AI Agent Hooks** from the Command Palette.
3. Start a **new** agent session so it picks up the hooks. The editor window has to stay open with the extension running.

The command copies `hook/notify.js` to `~/.comprehension-guard/notify.js` and merges user-level hook config. It does not change the project, and running it again refreshes the script without duplicating hooks.

| Agent | Config file | What it listens for |
| --- | --- | --- |
| Claude Code | `~/.claude/settings.json` | `PreToolUse` snapshots the file, then `PostToolUse` on `Edit`, `Write`, `NotebookEdit`, and `MultiEdit` notifies the extension |
| Codex | `~/.codex/hooks.json` | Same pair of hooks for `apply_patch` (also matched as Edit/Write). Open `/hooks` in Codex and trust the comprehension-guard hook |
| Cursor agent | `~/.cursor/hooks.json` | `afterFileEdit`. Cursor reloads hook files on its own |

The notifier needs Node.js on your PATH (Node 20+, the same requirement as building this extension). It always exits successfully and prints nothing, so the agent is not blocked and is not asked to judge the quiz. Re-run the install command after you upgrade the extension or switch Node installs (for example nvm).

What you should see: ask Claude Code to edit a source file with a change of at least `comprehensionGuard.charThreshold` characters (200 by default). The editor opens that file and shows the same comprehension quiz as a large paste. If you pass, the edit stays. If you fail or cancel, that edit is reverted. A file the agent created is moved to the trash.

If the editor was not running, the event waits in `~/.comprehension-guard/inbox` for about three minutes and is picked up when the extension activates.

Without hooks, there is a narrower fallback for files you already have open. A large change that arrives from disk, and that is not a single insertion in the editor you are typing in, raises the same quiz. More than three files changing at once (a git checkout or pull) does not, so branch switches stay quiet. Hooks are what cover files that are not open.

## Roadmap

Still planned, not implemented yet:

- Local LLM via Ollama/Qwen (free, private; separate validation from hosted judges).
- Translate hard languages (e.g. C) to plain English or a familiar language.
- Full web learning dashboard (Next.js + Supabase/Firebase on Vercel).
- Generate practice and interview questions from your history.
- Instructor/university enforcement and proctoring.
