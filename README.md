# Comprehension Guard

A VS Code extension that makes sure you actually understand code before it lands in your file. When you paste a large chunk of code, or when a large AI-generated snippet is inserted inline (Copilot/Cursor/"apply"), the extension holds the code and asks you a comprehension question. The code is only inserted after you demonstrate understanding.

## What it does today

- Intercepts `Ctrl+V` / `Cmd+V` and, if the clipboard content is large enough, runs a comprehension check before pasting.
- Detects large inline insertions (AI completions, apply-from-chat, snippet expansion) via document change events, removes the snippet, runs the check, and re-inserts it only on a pass.
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
| `comprehensionGuard.charThreshold` | `200` | Minimum characters in a single paste/insertion before the check triggers. |
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

## Output channel and judge validation

When an API key is configured, judge and generator logs (config id, verdicts, latency, `no_decision` reasons, etc.) are appended to the **Comprehension Guard** output channel (View > Output, then select the channel).

To regression-test the judge against a small gold set:

```powershell
npm run eval:judge
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
- **Inline path:** `workspace.onDidChangeTextDocument` flags any single insertion at or above the threshold. Since the text is already inserted when the event fires, it is undone, held, and re-inserted after the gate passes. A re-entrancy flag ensures the guard ignores its own edits. See [src/editGuard.ts](src/editGuard.ts).

## Roadmap

Still planned, not implemented yet:

- Local LLM via Ollama/Qwen (free, private; separate validation from hosted judges).
- Translate hard languages (e.g. C) to plain English or a familiar language.
- Full web learning dashboard (Next.js + Supabase/Firebase on Vercel).
- Generate practice and interview questions from your history.
- Instructor/university enforcement and proctoring.
