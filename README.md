# Comprehension Guard

A VS Code extension that makes sure you actually understand code before it lands in your file. When you paste a large chunk of code, or when a large AI-generated snippet is inserted inline (Copilot/Cursor/"apply"), the extension holds the code and asks you a quick comprehension question. The code is only inserted after you explain what it does.

This is an early MVP focused on the personal-project use case. The quiz is intentionally simple for now ("What does this code do?") and graded deterministically. LLM-based question generation and grading, a learning dashboard, and instructor/proctoring features are planned for later (see [Roadmap](#roadmap)).

## What it does today

- Intercepts `Ctrl+V` / `Cmd+V` and, if the clipboard content is large enough, runs a comprehension check before pasting.
- Detects large inline insertions (AI completions, apply-from-chat, snippet expansion) via document change events, removes the snippet, runs the check, and re-inserts it only on a pass.
- Comprehension check: a modal input box asking "What does this code do?" You must give an explanation of at least a configurable length to proceed; cancelling holds the code back.
- Deadline escape hatch: a one-shot "Bypass Next Insertion" command.
- Status bar indicator showing On / Off / Bypass armed (click to toggle).

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `comprehensionGuard.enabled` | `true` | Enable/disable the guard. |
| `comprehensionGuard.charThreshold` | `200` | Minimum characters in a single paste/insertion before the check triggers. |
| `comprehensionGuard.minAnswerLength` | `15` | Minimum explanation length (characters) required to pass. |

## Commands

- `Comprehension Guard: Paste (guarded)` - bound to `Ctrl+V` / `Cmd+V`.
- `Comprehension Guard: Toggle On/Off`.
- `Comprehension Guard: Bypass Next Insertion (deadline escape hatch)`.

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

Scoped for later, not in this MVP:

- LLM-generated, context-specific questions and LLM-as-judge / multiple-choice grading (with local Ollama/Qwen as a free, private option).
- `SecretStorage` for API keys.
- Webview-based quiz and learning dashboard.
- Learning analytics: track difficult concepts and improvement over time; generate practice and interview questions.
- Translate hard languages (e.g. C) to plain English or a familiar language.
- Instructor/university enforcement and proctoring; web dashboard (Next.js + Supabase/Firebase on Vercel).
