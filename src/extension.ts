import * as vscode from "vscode";
import { registerPasteGuard } from "./pasteGuard";
import { registerEditGuard } from "./editGuard";
import { isEnabled, onStateChanged, setBypassArmed, state } from "./state";

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  // Status bar indicator (click to toggle).
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.command = "comprehensionGuard.toggle";
  context.subscriptions.push(statusBarItem);
  statusBarItem.show();
  updateStatusBar();

  // Core guards.
  registerPasteGuard(context);
  registerEditGuard(context);

  // Toggle on/off.
  context.subscriptions.push(
    vscode.commands.registerCommand("comprehensionGuard.toggle", async () => {
      const config = vscode.workspace.getConfiguration("comprehensionGuard");
      const next = !config.get<boolean>("enabled", true);
      await config.update(
        "enabled",
        next,
        vscode.ConfigurationTarget.Global,
      );
      // Toggling off also clears any armed bypass.
      if (!next) {
        setBypassArmed(false);
      }
      updateStatusBar();
      vscode.window.setStatusBarMessage(
        `Comprehension Guard ${next ? "enabled" : "disabled"}.`,
        3000,
      );
    }),
  );

  // One-shot bypass (deadline escape hatch).
  context.subscriptions.push(
    vscode.commands.registerCommand("comprehensionGuard.bypassNext", () => {
      setBypassArmed(true);
      vscode.window.setStatusBarMessage(
        "Comprehension Guard: next insertion will be allowed without a check.",
        4000,
      );
    }),
  );

  // Keep the status bar in sync if the setting changes elsewhere.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("comprehensionGuard.enabled")) {
        updateStatusBar();
      }
    }),
  );

  // Refresh the status bar whenever the bypass state changes.
  context.subscriptions.push(onStateChanged.event(() => updateStatusBar()));
  context.subscriptions.push(onStateChanged);
}

function updateStatusBar(): void {
  if (!statusBarItem) {
    return;
  }
  if (!isEnabled()) {
    statusBarItem.text = "$(shield) Guard: Off";
    statusBarItem.tooltip = "Comprehension Guard is disabled. Click to enable.";
  } else if (state.bypassArmed) {
    statusBarItem.text = "$(shield) Guard: Bypass armed";
    statusBarItem.tooltip =
      "Next large paste/insertion will be allowed without a check. Click to toggle off.";
  } else {
    statusBarItem.text = "$(shield) Guard: On";
    statusBarItem.tooltip =
      "Comprehension Guard is active. Click to disable.";
  }
}

export function deactivate(): void {
  // Disposables are handled via context.subscriptions.
}
