import * as vscode from "vscode";
import { getMinAnswerLength } from "./state";

/**
 * Runs the (fabricated, MVP) comprehension check for a snippet of code.
 *
 * For now this is a single deterministic question -- "What does this code
 * do?" -- shown in a modal input box. The student must provide an
 * explanation of at least `comprehensionGuard.minAnswerLength` characters.
 * If they answer too briefly we explain why and re-ask; if they cancel
 * (Escape) the gate fails and the code is held back.
 *
 * Later this is where real LLM question generation and LLM-as-judge /
 * multiple-choice grading will plug in.
 *
 * @returns `true` if the student passed and the code should be inserted,
 *          `false` if they cancelled and the code should be held.
 */
export async function runComprehensionGate(snippet: string): Promise<boolean> {
  const minAnswerLength = getMinAnswerLength();
  const preview = buildPreview(snippet);

  // Loop until the student passes or cancels.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const answer = await vscode.window.showInputBox({
      title: "Comprehension check",
      prompt: `What does this code do? (explain it to insert it)\n\n${preview}`,
      placeHolder: "Explain in your own words what this code does...",
      ignoreFocusOut: true,
    });

    if (answer === undefined) {
      // Cancelled (Escape or focus dismissed with no value) -> block.
      vscode.window.setStatusBarMessage(
        "Comprehension Guard: insertion blocked (no explanation given).",
        4000,
      );
      return false;
    }

    if (answer.trim().length < minAnswerLength) {
      await vscode.window.showWarningMessage(
        `Please explain a bit more (at least ${minAnswerLength} characters) to show you understand this code.`,
      );
      // Re-ask.
      continue;
    }

    return true;
  }
}

/**
 * Builds a short, single-line-friendly preview of the snippet for the input
 * box prompt. Input boxes render plainly, so we trim and cap the length.
 */
function buildPreview(snippet: string): string {
  const maxChars = 500;
  const trimmed = snippet.length > maxChars ? `${snippet.slice(0, maxChars)}…` : snippet;
  return trimmed;
}
