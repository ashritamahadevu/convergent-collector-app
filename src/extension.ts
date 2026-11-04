import * as vscode from "vscode";
import { registerPasteGuard } from "./pasteGuard";
import { registerAgentGuard } from "./agentGuard";
import { registerEditGuard } from "./editGuard";
import { setLogSink } from "./llm";
import { clearApiKey, setApiKey } from "./secrets";
import { getStats } from "./store";
import {
  getProvider,
  isEnabled,
  onStateChanged,
  setBypassArmed,
  state,
} from "./state";

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Comprehension Guard");
  context.subscriptions.push(output);
  setLogSink((line) => output.appendLine(line));

  // Status bar indicator (click to toggle).
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.command = "comprehensionGuard.toggle";
  context.subscriptions.push(statusBarItem);
  statusBarItem.show();
  updateStatusBar();

  // Core guards. The agent guard listens for document changes first so it can
  // tell an external write apart from an insertion the inline guard will quiz.
  registerPasteGuard(context);
  registerAgentGuard(context);
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

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "comprehensionGuard.setApiKey",
      async () => {
        const provider = getProvider();
        const key = await vscode.window.showInputBox({
          title: "Comprehension Guard API Key",
          prompt: "API key for " + provider,
          password: true,
          ignoreFocusOut: true,
        });
        if (!key || key.trim().length === 0) {
          return;
        }
        await setApiKey(context, provider, key.trim());
        vscode.window.showInformationMessage(
          "Comprehension Guard: API key saved for " + provider + ".",
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "comprehensionGuard.clearApiKey",
      async () => {
        await clearApiKey(context, getProvider());
        vscode.window.showInformationMessage(
          "Comprehension Guard: API key cleared for " + getProvider() + ".",
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("comprehensionGuard.showStats", () => {
      const stats = getStats(context);
      output.clear();
      output.appendLine("Comprehension Guard - Learning stats");
      output.appendLine("");
      output.appendLine("Total attempts: " + stats.total);
      output.appendLine("Passed: " + stats.passed);
      const pct = Math.round(stats.passRate * 1000) / 10;
      output.appendLine("Pass rate: " + pct + "%");
      output.appendLine("");
      if (stats.mostMissed.length === 0) {
        output.appendLine("Most missed concepts: (none yet)");
      } else {
        output.appendLine(
          "Most missed concepts: " + stats.mostMissed.join(", "),
        );
      }
      output.show(true);
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
