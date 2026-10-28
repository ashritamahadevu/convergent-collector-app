import * as vscode from "vscode";
import { getCharThreshold, isEnabled, setBypassArmed, state } from "./state";
import { runComprehensionGate } from "./quiz";

const BUILTIN_PASTE = "editor.action.clipboardPasteAction";

/**
 * Registers the guarded paste command bound to Ctrl+V / Cmd+V.
 *
 * Flow:
 *  1. Read the clipboard text.
 *  2. If the guard is disabled, a bypass is armed, or the text is below the
 *     character threshold, run the real paste (consuming any armed bypass).
 *  3. Otherwise run the comprehension gate first; only paste on a pass.
 *
 * All real paste operations are wrapped so the edit guard ignores them.
 */
export function registerPasteGuard(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    "comprehensionGuard.paste",
    async () => {
      const clipboardText = await vscode.env.clipboard.readText();

      // Below threshold, disabled, or a bypass is armed -> just paste.
      if (
        !isEnabled() ||
        state.bypassArmed ||
        clipboardText.length < getCharThreshold()
      ) {
        if (state.bypassArmed) {
          setBypassArmed(false);
        }
        await performPaste();
        return;
      }

      const passed = await runComprehensionGate(clipboardText);
      if (passed) {
        await performPaste();
      }
      // On failure we do nothing -- the clipboard content is never inserted.
    },
  );

  context.subscriptions.push(disposable);
}

/** Runs the built-in paste while suppressing the edit guard. */
async function performPaste(): Promise<void> {
  state.suppressEditGuard = true;
  try {
    await vscode.commands.executeCommand(BUILTIN_PASTE);
  } finally {
    state.suppressEditGuard = false;
  }
}
