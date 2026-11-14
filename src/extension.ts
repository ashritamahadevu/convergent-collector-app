import * as vscode from "vscode";
import { registerPasteGuard } from "./pasteGuard";
import { registerAgentGuard } from "./agentGuard";
import { registerEditGuard } from "./editGuard";
import { setLogSink } from "./llm";
import { warmParsers } from "./sizing/parser";
import { clearApiKey, setApiKey } from "./secrets";
import { dueConcepts, getMastery, getProfile, saveProfile } from "./memory/remember";
import { showUnderstandingMapFor } from "./mapPanel";
import { buildPrepSet, offerLoginRecall, resumeWalkthrough } from "./walkthrough";
import { deleteCodeIndex, indexFile, indexWorkspace, searchCode } from "./memory/rag";
import { retrievability } from "./memory/scheduler";
import { signIn, signOut } from "./memory/sync";
import { getStats } from "./store";
import {
  getProvider,
  isEnabled,
  onStateChanged,
  requestQuizBypass,
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
  warmParsers();
  void resumeWalkthrough(context);
  void offerLoginRecall(context);

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
      if (requestQuizBypass()) {
        vscode.window.setStatusBarMessage(
          "Comprehension Guard: quiz bypassed. The code stays.",
          4000,
        );
        return;
      }
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
      const mastery = getMastery(context);
      output.appendLine("");
      output.appendLine("Concept mastery (Bayesian):");
      if (mastery.length === 0) {
        output.appendLine("(none yet)");
      } else {
        for (const row of mastery) {
          output.appendLine(
            row.concept + ": " + Math.round(row.mastery * 100) + "%  elo " + row.elo + "  attempts " + row.attempts,
          );
        }
      }
      output.show(true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("comprehensionGuard.showDueConcepts", () => {
      const now = Date.now();
      const due = dueConcepts(context, now);
      output.clear();
      output.appendLine("Comprehension Guard - Due concepts");
      output.appendLine("");
      if (due.length === 0) {
        output.appendLine("Nothing is due.");
      } else {
        for (const card of due) {
          const recall = Math.round(retrievability(card, now) * 100);
          output.appendLine(card.concept + "  recall " + recall + "%  due " + new Date(card.dueAt).toLocaleDateString());
        }
      }
      output.show(true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("comprehensionGuard.signIn", async () => {
      const email = await vscode.window.showInputBox({ prompt: "Supabase email", ignoreFocusOut: true });
      const password = await vscode.window.showInputBox({
        prompt: "Supabase password",
        password: true,
        ignoreFocusOut: true,
      });
      if (!email || !password) {
        return;
      }
      try {
        const userId = await signIn(context, email.trim(), password);
        vscode.window.showInformationMessage("Comprehension Guard: signed in (" + userId.slice(0, 8) + ").");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage("Comprehension Guard: " + message);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("comprehensionGuard.signOut", async () => {
      await signOut(context);
      vscode.window.showInformationMessage("Comprehension Guard: signed out. Local memory stays on this computer.");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("comprehensionGuard.setProfile", async () => {
      const current = getProfile(context);
      const examDate = await vscode.window.showInputBox({
        prompt: "Exam date (YYYY-MM-DD), or leave blank",
        value: current.examDate ?? "",
        ignoreFocusOut: true,
      });
      if (examDate === undefined) {
        return;
      }
      const interviewDate = await vscode.window.showInputBox({
        prompt: "Interview date (YYYY-MM-DD), or leave blank",
        value: current.interviewDate ?? "",
        ignoreFocusOut: true,
      });
      if (interviewDate === undefined) {
        return;
      }
      const preferredLanguage = await vscode.window.showInputBox({
        prompt: "Language you want to answer in, or leave blank",
        value: current.preferredLanguage ?? "",
        ignoreFocusOut: true,
      });
      if (preferredLanguage === undefined) {
        return;
      }
      const strictness = await vscode.window.showQuickPick(
        [
          { label: "lenient", description: "Multiple choice on every chunk" },
          { label: "standard", description: "Question type follows the preset and what you already know" },
          { label: "strict", description: "The deepest question the preset allows" },
        ],
        { title: "How strict should chunk checks be?", ignoreFocusOut: true },
      );
      if (!strictness) {
        return;
      }
      await saveProfile(context, {
        ...current,
        examDate: examDate.trim(),
        interviewDate: interviewDate.trim(),
        preferredLanguage: preferredLanguage.trim(),
        strictness: strictness.label,
      });
      vscode.window.showInformationMessage("Comprehension Guard: profile saved.");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("comprehensionGuard.indexCodebase", async () => {
      const count = await indexWorkspace(context);
      vscode.window.showInformationMessage("Comprehension Guard: indexed " + count + " code chunks locally.");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("comprehensionGuard.deleteCodeIndex", () => {
      deleteCodeIndex(context);
      vscode.window.showInformationMessage("Comprehension Guard: local code index deleted.");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("comprehensionGuard.showUnderstandingMap", () => {
      showUnderstandingMapFor(context);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("comprehensionGuard.buildPrepSet", async () => {
      const kind = await vscode.window.showQuickPick(["interview", "exam"], {
        placeHolder: "Which prep set?",
      });
      if (kind !== "interview" && kind !== "exam") {
        return;
      }
      await buildPrepSet(context, kind);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("comprehensionGuard.searchCodebase", async () => {
      const query = await vscode.window.showInputBox({ prompt: "Search your local code index", ignoreFocusOut: true });
      if (!query) {
        return;
      }
      const hits = searchCode(context, query);
      output.clear();
      output.appendLine("Comprehension Guard - Code search");
      output.appendLine("");
      if (hits.length === 0) {
        output.appendLine("No indexed chunks. Run Index Codebase first.");
      } else {
        for (const hit of hits) {
          output.appendLine(hit.path + ":" + hit.startLine + "  " + hit.name);
        }
      }
      output.show(true);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.uri.scheme !== "file") {
        return;
      }
      indexFile(context, document.uri.fsPath, document.getText());
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
  } else if (state.quizActive) {
    statusBarItem.text = "$(shield) Guard: Quiz open";
    statusBarItem.tooltip =
      "Finish the quiz, run Bypass Next Insertion to keep the code, or close the quiz tab to remove it.";
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
