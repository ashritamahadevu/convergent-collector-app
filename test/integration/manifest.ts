/**
 * Scenario list shared by the orchestrator (runTest.ts, plain Node) and the
 * in-editor suite (suite/index.ts). No vscode imports here.
 *
 * Each phase is one VS Code launch (same profile, workspace and guard home).
 * The phase entry says how it ends: "normal" (suite returns), "crash" (the
 * suite SIGKILLs the extension host), or "reload" (the suite runs
 * workbench.action.reloadWindow; in extension-test mode that shuts the
 * extension host down gracefully and VS Code exits, so the next phase is a
 * fresh launch).
 */
export type LaunchEnd = "normal" | "crash" | "reload";

export type ScenarioMeta = {
  id: string;
  path: "paste" | "inline" | "agent" | "mixed";
  title: string;
  /** One entry per phase. */
  phases: LaunchEnd[];
  /** Setup the orchestrator does before the first launch (editor closed). */
  preLaunch?: "inbox-event";
};

/** Shared fixture text, so the orchestrator and the suite agree on file contents. */
export const AGENT_BEFORE = "export function total(items) {\n  return 0;\n}\n";

export const AGENT_NEW_BODY = [
  "export function total(items) {",
  "  let sum = 0;",
  "  for (const item of items) {",
  "    if (item && typeof item.price === 'number' && item.price > 0) {",
  "      sum += item.price * (typeof item.qty === 'number' ? item.qty : 1);",
  "    }",
  "  }",
  "  return Math.round(sum * 100) / 100;",
  "}",
  "",
].join("\n");

export const SCENARIOS: ScenarioMeta[] = [
  // Paste path
  { id: "paste-close-mid-question", path: "paste", title: "Close quiz tab mid-question", phases: ["normal"] },
  { id: "paste-close-mid-grading-pass", path: "paste", title: "Close quiz tab while the LLM grade is in flight (grade comes back pass)", phases: ["normal"] },
  { id: "paste-close-mid-grading-fail", path: "paste", title: "Close quiz tab while the LLM grade is in flight (grade comes back fail)", phases: ["normal"] },
  { id: "paste-close-during-followup", path: "paste", title: "Close quiz tab during a follow-up question", phases: ["normal"] },
  { id: "paste-save-then-close-quiz", path: "paste", title: "Save (Ctrl+S) while locked, then close the quiz", phases: ["normal"] },
  { id: "paste-close-editor-then-fail", path: "paste", title: "Save, close the locked file's editor tab, then close the quiz", phases: ["normal"] },
  { id: "paste-close-editor-then-pass", path: "paste", title: "Save, close the locked file's editor tab, then pass", phases: ["normal"] },
  { id: "paste-undo-while-locked", path: "paste", title: "Undo while the file is locked, then close the quiz", phases: ["normal"] },
  { id: "paste-undo-redo-after-fail", path: "paste", title: "Undo after a failed/closed quiz", phases: ["normal"] },
  { id: "paste-undo-redo-after-pass", path: "paste", title: "Undo then redo after a pass", phases: ["normal"] },
  { id: "paste-untitled-close", path: "paste", title: "Paste into an untitled document, close the quiz", phases: ["normal"] },
  { id: "paste-switch-file-inline-bypass", path: "mixed", title: "Switch to another file while locked and insert a large block there", phases: ["normal"] },
  { id: "paste-file-deleted-on-disk", path: "paste", title: "Locked file deleted on disk while the quiz is open, then close quiz", phases: ["normal"] },
  { id: "paste-file-renamed", path: "paste", title: "Locked file renamed (workspace rename) while the quiz is open, then close quiz", phases: ["normal"] },
  { id: "paste-bypass-command", path: "paste", title: "Run 'Bypass Next Insertion' while the paste quiz is open", phases: ["normal"] },
  { id: "paste-slow-generation", path: "paste", title: "Question generation slow: what can the user close? Bypass during generation", phases: ["normal"] },
  { id: "paste-reload-window", path: "paste", title: "Developer: Reload Window while the paste quiz is open", phases: ["reload", "normal"] },
  { id: "paste-crash", path: "paste", title: "Kill the extension host during the paste quiz", phases: ["crash", "normal"] },

  // Inline path
  { id: "inline-close-mid-question", path: "inline", title: "Close quiz tab mid-question", phases: ["normal"] },
  { id: "inline-close-mid-grading-pass", path: "inline", title: "Close quiz tab while the LLM grade is in flight (grade comes back pass)", phases: ["normal"] },
  { id: "inline-close-editor-then-fail", path: "inline", title: "Save, close the locked file's editor tab, then close the quiz", phases: ["normal"] },
  { id: "inline-undo-after-fail", path: "inline", title: "Undo after a failed/closed quiz", phases: ["normal"] },
  { id: "inline-untitled-close", path: "inline", title: "Inline insertion into an untitled document, close the quiz", phases: ["normal"] },

  // Agent path
  { id: "agent-close-mid-question", path: "agent", title: "Close quiz tab mid-question", phases: ["normal"] },
  { id: "agent-pass", path: "agent", title: "Pass the quiz (baseline)", phases: ["normal"] },
  { id: "agent-close-mid-grading-pass", path: "agent", title: "Close quiz tab while the LLM grade is in flight (grade comes back pass)", phases: ["normal"] },
  { id: "agent-close-editor-then-pass", path: "agent", title: "Close the locked file's editor tab, then pass", phases: ["normal"] },
  { id: "agent-bypass-command", path: "agent", title: "Run 'Bypass Next Insertion' while the agent quiz is open", phases: ["normal"] },
  { id: "agent-paste-while-open", path: "mixed", title: "Paste while an agent quiz is open", phases: ["normal"] },
  { id: "agent-two-files", path: "agent", title: "Agent edits two files in quick succession", phases: ["normal"] },
  { id: "agent-dirty-buffer", path: "agent", title: "Agent edits a file that has unsaved changes in the editor", phases: ["normal"] },
  { id: "agent-file-deleted-then-pass", path: "agent", title: "File deleted on disk while the agent quiz is open, then pass", phases: ["normal"] },
  { id: "agent-undo-after-fail", path: "agent", title: "Undo in the editor after the agent quiz was closed", phases: ["normal"] },
  { id: "agent-edit-active-editor", path: "agent", title: "Agent edits the file that is open in the focused editor, close the quiz", phases: ["normal"] },
  { id: "agent-reload-window", path: "agent", title: "Developer: Reload Window while the agent quiz is open", phases: ["reload", "normal"] },
  { id: "agent-crash", path: "agent", title: "Kill the extension host during the agent quiz", phases: ["crash", "normal"] },
  { id: "agent-two-files-crash", path: "agent", title: "Agent edits two files; crash while the first quiz is open", phases: ["crash", "normal"] },
  { id: "agent-inbox-replay-crash", path: "agent", title: "Event left in the inbox while VS Code is closed, crash during its quiz, restart", phases: ["crash", "normal"], preLaunch: "inbox-event" },
];
