import * as vscode from "vscode";
import { SCENARIOS } from "../manifest";
import {
  EXT_ID,
  Recorder,
  installClipboardMock,
  installFetchMock,
  installRejectionSpy,
  installWebviewSpy,
  restoreClipboard,
} from "./driver";
import { SCENARIO_IMPLS } from "./scenarios";

const SCENARIO_TIMEOUT_MS = 100_000;

/** Entry point called by VS Code's extension test runner. */
export async function run(): Promise<void> {
  // Install spies before the extension can create a quiz.
  installWebviewSpy();
  const clipboardMode = installClipboardMock();
  installFetchMock();
  installRejectionSpy();

  const id = process.env.CG_SCENARIO ?? "";
  const phase = Number(process.env.CG_PHASE ?? "1");
  const meta = SCENARIOS.find((s) => s.id === id);
  const impl = SCENARIO_IMPLS[id];
  const rec = new Recorder(id, phase);
  if (clipboardMode !== "mocked env.clipboard") {
    rec.note("clipboard: " + clipboardMode);
  }
  if (!meta || !impl) {
    rec.error = "unknown scenario " + id;
    rec.flush();
    return;
  }

  const ext = vscode.extensions.getExtension(EXT_ID);
  if (!ext) {
    rec.error = "extension " + EXT_ID + " not found";
    rec.flush();
    return;
  }
  await ext.activate();

  const step = impl[phase - 1];
  if (!step) {
    rec.error = "no implementation for phase " + phase;
    rec.flush();
    return;
  }
  const end = meta.phases[phase - 1];
  const ctx = {
    rec,
    phase,
    /** Writes results, then reloads the window into the next phase. */
    reload: async (): Promise<never> => {
      await restoreClipboard();
      rec.note("running workbench.action.reloadWindow (graceful extension host shutdown)");
      rec.flush();
      try {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
      } catch {
        // The command promise is cancelled when the extension host goes away.
      }
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      throw new Error("window did not reload within 60s");
    },
    /** Writes results, then kills the extension host process without any cleanup. */
    crash: async (): Promise<never> => {
      await restoreClipboard();
      rec.flush();
      process.kill(process.pid, "SIGKILL");
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      throw new Error("extension host survived SIGKILL");
    },
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      step(ctx),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("scenario timed out")), SCENARIO_TIMEOUT_MS);
      }),
    ]);
    if (end === "reload" || end === "crash") {
      rec.error = "phase was expected to " + end + " but returned";
    }
  } catch (err) {
    if (end === "reload" && err instanceof Error && err.message.includes("Canceled")) {
      // Shutdown in progress; results were already flushed.
      return;
    }
    rec.error = err instanceof Error ? err.stack ?? err.message : String(err);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
  await restoreClipboard();
  rec.flush();
}
