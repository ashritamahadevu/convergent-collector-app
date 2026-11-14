import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import * as vscode from "vscode";
import {
  DISK_FALLBACK_DELAY_MS,
  type AgentEdit,
  diffAddedText,
  editsFromHookEnvelope,
  equivalentText,
  guardDirectory,
  isFreshEvent,
  isIgnoredCodePath,
  looksBinary,
  looksLikeAgentInvocation,
  normPath,
  parseConfigText,
  planHookInstall,
  prepareHeldEdit,
  quizSnippet,
  resolveGuardHome,
  revertHunks,
  shouldQuizDiskBurst,
  shouldUseDiskFallback,
  snapshotFileName,
  withBaseline,
  type ConfigInput,
} from "./agentProtocol";
import { lockDocument } from "./documentLock";
import { acceptedText, noteAccepted } from "./editorBaseline";
import {
  holdPath,
  isAgentClaimed,
  isCoveredByEditorGate,
  markEditorGate,
  releasePath,
} from "./gateLock";
import { runComprehensionGate, runSession } from "./quiz";
import { newDashboardCheckId, recordDashboardCheck } from "./dashboard/service";
import { generateQuestion } from "./llm";
import { getMastery, getProfile, logReview, rememberCheck } from "./memory/remember";
import type { LearnerPreferences } from "./sizing/chunkPolicy";
import { gradeLocal } from "./sizing/questions";
import { PauseSession, pauseSessionId, type PauseWire } from "./sizing/pauseSession";
import type { CheckPreset, LocalQuestion, QuestionType } from "./sizing/types";
import { offerWalkthrough } from "./walkthrough";
import { addAttempt } from "./store";
import type { AttemptRecord, QuestionKind } from "./types";
import { getCharThreshold, isEnabled, setBypassArmed, setQuizActive, state, wantsWalkthrough } from "./state";

/**
 * Quizzes code written by Claude Code, Codex, the Cursor agent, or Gemini CLI.
 *
 * Hooks are the reliable signal: a notifier posts the tool payload to a
 * localhost port, or leaves a file in an inbox if the editor is closed.
 * Open files also get a fallback for large disk changes that did not come
 * from the focused editor. A burst of many files (git checkout, pull) is ignored.
 */

const MAX_QUEUE = 12;

/** One checkpoint per agent session, and one question picker at a time. */
const pauseSessions = new PauseSession((questions) => askCheckpoint(questions));

type PendingDiskEdit = {
  fsPath: string;
  previous: string;
  current: string;
  snippet: string;
};

type QueuedEdit = AgentEdit & { key: string };

let activeContext: vscode.ExtensionContext | undefined;

export function registerAgentGuard(context: vscode.ExtensionContext): void {
  activeContext = context;
  const home = resolveGuardHome(process.env.COMPREHENSION_GUARD_HOME, os.homedir());
  const queue: QueuedEdit[] = [];
  const pending = new Map<string, PendingDiskEdit>();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let batchTimer: ReturnType<typeof setTimeout> | undefined;
  let draining = false;

  const enqueue = (edit: AgentEdit): void => {
    const snippet = quizSnippet(edit.snippet);
    if (snippet.length < getCharThreshold() || looksBinary(snippet)) {
      return;
    }
    if (isIgnoredCodePath(edit.filePath)) {
      return;
    }
    if (
      isCoveredByEditorGate(edit.filePath, snippet) ||
      isCoveredByEditorGate(edit.filePath, edit.snippet)
    ) {
      return;
    }
    const key = normPath(edit.filePath) + "\0" + snippet;
    if (queue.some((item) => item.key === key)) {
      return;
    }
    if (queue.length >= MAX_QUEUE) {
      void vscode.window.setStatusBarMessage(
        "Comprehension Guard: skipping extra agent edits until the current check finishes.",
        4000,
      );
      return;
    }
    queue.push({ ...edit, snippet, key });
    if (batchTimer) {
      clearTimeout(batchTimer);
    }
    batchTimer = setTimeout(() => void drain(), 700);
  };

  const drain = async (): Promise<void> => {
    if (draining) {
      return;
    }
    draining = true;
    try {
      while (queue.length > 0) {
        while (state.processing) {
          await delay(200);
        }
        const batch = queue.splice(0);
        const lines = batch.reduce((count, edit) => count + edit.snippet.split("\n").length, 0);
        if (!readAgentPause() && wantsWalkthrough(new Set(batch.map((edit) => edit.filePath)).size, lines)) {
          await offerWalkthrough(context, batch);
          continue;
        }
        for (const edit of batch) {
          if (readAgentPause() && isCoveredByEditorGate(edit.filePath, edit.snippet)) {
            continue;
          }
          await runAgentQuiz(context, edit);
        }
      }
    } finally {
      draining = false;
      if (queue.length > 0 && !state.processing) {
        void drain();
      }
    }
  };

  const onHook = (body: unknown): void => {
    if (!isEnabled() || !acceptIncoming(body)) {
      return;
    }
    const edits = editsFromHookEnvelope(body, {
      readFile: readOptional,
      readSnapshot: (absPath) => readSnapshot(home, absPath),
    });
    for (const edit of edits) {
      const prepared = withBaseline(edit, edit.restore ? undefined : acceptedText(edit.filePath));
      enqueue(prepared);
    }
  };

  const acceptHook = (body: unknown): void => {
    if (!readAgentPause()) {
      onHook(body);
      return;
    }
    pauseSessions.track(noteEditedFiles(home, body));
  };

  const transport = startTransport(home, acceptHook, (body) =>
    pauseSessions.onPause(body, {
      enabled: readAgentPause() && isEnabled(),
      preferences: readPreferences(),
    }),
  );
  context.subscriptions.push(transport);

  const flushPending = (): void => {
    flushTimer = undefined;
    const items = [...pending.values()];
    pending.clear();
    if (!shouldQuizDiskBurst(items.length)) {
      for (const item of items) {
        if (!isAgentClaimed(item.fsPath)) {
          noteAccepted(item.fsPath, item.current);
        }
      }
      return;
    }
    for (const item of items) {
      if (isAgentClaimed(item.fsPath) || isCoveredByEditorGate(item.fsPath, item.snippet)) {
        continue;
      }
      if (item.snippet.length < getCharThreshold()) {
        noteAccepted(item.fsPath, item.current);
        continue;
      }
      if (readAgentPause()) {
        pauseSessions.track(
          pauseSessions.noteFile("disk", readPreferences(), item.fsPath, item.current, {
            snippet: item.snippet,
            hunks: [{ newText: item.snippet }],
          }),
        );
        continue;
      }
      enqueue({
        agent: "disk",
        filePath: item.fsPath,
        snippet: item.snippet,
        hunks: [],
        restore: { previous: item.previous, next: item.current },
        next: item.current,
      });
    }
  };

  const scheduleFlush = (): void => {
    if (flushTimer) {
      clearTimeout(flushTimer);
    }
    flushTimer = setTimeout(flushPending, DISK_FALLBACK_DELAY_MS);
  };

  for (const doc of vscode.workspace.textDocuments) {
    rememberOpen(doc, pending);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => rememberOpen(doc, pending)),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      observeDocument(event, pending, scheduleFlush);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("comprehensionGuard.installAgentHooks", () => {
      void installAgentHooks(context, home);
    }),
  );

  context.subscriptions.push({
    dispose: () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
      }
    },
  });
}

function observeDocument(
  event: vscode.TextDocumentChangeEvent,
  pending: Map<string, PendingDiskEdit>,
  scheduleFlush: () => void,
): void {
  const doc = event.document;
  if (doc.uri.scheme !== "file") {
    return;
  }
  const fsPath = doc.uri.fsPath;
  if (state.suppressEditGuard || state.processing || isAgentClaimed(fsPath)) {
    return;
  }

  const key = normPath(fsPath);
  const current = doc.getText();
  if (!isEnabled()) {
    if (!pending.has(key)) {
      noteAccepted(fsPath, current);
    }
    return;
  }
  const tracked = pending.get(key);
  if (tracked) {
    pending.set(key, {
      fsPath,
      previous: tracked.previous,
      current,
      snippet: diffAddedText(tracked.previous, current),
    });
    scheduleFlush();
    return;
  }

  const previous = acceptedText(fsPath);
  const active = vscode.window.activeTextEditor;
  const isActive = !!active && active.document === doc;
  const threshold = getCharThreshold();
  let totalInserted = 0;
  let bigSingle = false;
  for (const change of event.contentChanges) {
    totalInserted += change.text.length;
    if (change.text.length >= threshold) {
      bigSingle = true;
    }
  }

  // The inline guard records the accepted text when it finishes this insertion.
  if (isActive && bigSingle && !isUndoRedo(event)) {
    return;
  }

  const take = shouldUseDiskFallback({
    suppressed: false,
    processing: false,
    claimed: false,
    undoOrRedo: isUndoRedo(event),
    ignoredPath: isIgnoredCodePath(fsPath),
    isActive,
    isDirty: doc.isDirty,
    bigSingle,
    totalInserted,
    threshold,
    hasBaseline: previous !== undefined,
  });

  if (!take || previous === undefined || looksBinary(current) || looksBinary(previous)) {
    noteAccepted(fsPath, current);
    return;
  }

  const snippet = diffAddedText(previous, current);
  if (snippet.length < threshold) {
    noteAccepted(fsPath, current);
    return;
  }

  pending.set(key, { fsPath, previous, current, snippet });
  scheduleFlush();
}

function rememberOpen(doc: vscode.TextDocument, pending: Map<string, PendingDiskEdit>): void {
  if (doc.uri.scheme !== "file") {
    return;
  }
  if (isAgentClaimed(doc.uri.fsPath) || pending.has(normPath(doc.uri.fsPath))) {
    return;
  }
  if (acceptedText(doc.uri.fsPath) === undefined) {
    noteAccepted(doc.uri.fsPath, doc.getText());
  }
}

async function runAgentQuiz(
  context: vscode.ExtensionContext,
  edit: AgentEdit,
): Promise<void> {
  const fileText = await readText(edit.filePath);
  const prepared = prepareHeldEdit(edit, fileText, acceptedText(edit.filePath));
  const added = prepared.restore
    ? diffAddedText(prepared.restore.previous, prepared.restore.next)
    : "";
  if (looksLikeAgentInvocation(prepared.snippet) || looksLikeAgentInvocation(added)) {
    // The terminal command landed in the file. Remove it and wait for generated code.
    if (prepared.restore && looksLikeAgentInvocation(added)) {
      await revertEdit(prepared);
    }
    return;
  }
  const snippet = quizSnippet(prepared.snippet);
  if (!isEnabled() || snippet.length < getCharThreshold()) {
    return;
  }
  if (isCoveredByEditorGate(edit.filePath, snippet)) {
    return;
  }
  if (state.bypassArmed) {
    setBypassArmed(false);
    await rememberFile(edit.filePath);
    return;
  }

  holdPath(edit.filePath);
  markEditorGate(edit.filePath, snippet);
  state.suppressEditGuard = true;
  state.processing = true;
  let release: (() => void) | undefined;
  let released = false;
  const unlock = (): void => {
    if (!released) {
      released = true;
      release?.();
    }
  };
  try {
    void vscode.window.setStatusBarMessage(
      "Comprehension Guard: checking code from " + agentLabel(edit.agent) + ".",
      4000,
    );
    // Keep the generated code out of the file while the quiz is open.
    const withheld = await revertEdit(prepared);
    let language: string | undefined;
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(edit.filePath));
      language = doc.languageId;
      await vscode.window.showTextDocument(doc, {
        preview: false,
        preserveFocus: false,
      });
      release = lockDocument(doc).release;
    } catch {
      language = undefined;
    }
    const passed = await runComprehensionGate(snippet, context, language, {
      source: "agent",
      filePath: edit.filePath,
    });
    unlock();
    if (passed) {
      const inserted = await applyHeldEdit(prepared);
      if (!inserted) {
        void vscode.window.showWarningMessage(
          "Comprehension Guard: the check was passed, but the generated code could not be written into the file.",
        );
      }
    } else if (!withheld) {
      const reverted = await revertEdit(prepared);
      if (!reverted) {
        await rememberFile(edit.filePath);
        void vscode.window.showWarningMessage(
          "Comprehension Guard: the check did not pass, but the file had already changed again so it was left as-is.",
        );
      }
    } else if (prepared.restore) {
      noteAccepted(edit.filePath, prepared.restore.previous);
    }
  } catch {
    unlock();
    await applyHeldEdit(prepared);
  } finally {
    state.processing = false;
    await delay(150);
    state.suppressEditGuard = false;
    releasePath(edit.filePath);
  }
}

/** Writes the generated code into the file after a pass or Bypass. */
async function applyHeldEdit(edit: AgentEdit): Promise<boolean> {
  const next = edit.restore?.next ?? edit.next;
  const previous = edit.restore?.previous;
  if (next === undefined) {
    return false;
  }
  const open = findOpen(edit.filePath);
  const current = open ? open.getText() : await readText(edit.filePath);
  if (current !== undefined && equivalentText(current, next)) {
    noteAccepted(edit.filePath, next);
    return true;
  }
  if (edit.created || previous === "") {
    await fs.promises.mkdir(path.dirname(edit.filePath), { recursive: true });
    await fs.promises.writeFile(edit.filePath, next, "utf8");
    if (open) {
      await replaceDocument(open, next);
      if (open.isDirty) {
        await open.save();
      }
    }
    noteAccepted(edit.filePath, next);
    return true;
  }
  if (previous === undefined) {
    return false;
  }
  return writeBack(edit.filePath, next, previous);
}

async function revertEdit(edit: AgentEdit): Promise<boolean> {
  if (edit.created && edit.next !== undefined) {
    const disk = await readText(edit.filePath);
    if (disk !== undefined && equivalentText(disk, edit.next)) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(edit.filePath), { useTrash: true });
      } catch {
        return false;
      }
      return true;
    }
  }
  if (edit.restore) {
    return writeBack(edit.filePath, edit.restore.previous, edit.restore.next);
  }
  if (edit.hunks.length === 0) {
    return false;
  }
  const open = findOpen(edit.filePath);
  if (open) {
    const fromBuffer = revertHunks(open.getText(), edit.hunks);
    if (fromBuffer !== open.getText()) {
      return writeBack(edit.filePath, fromBuffer, open.getText());
    }
  }
  const disk = await readText(edit.filePath);
  if (disk === undefined) {
    return false;
  }
  const fromDisk = revertHunks(disk, edit.hunks);
  if (fromDisk === disk) {
    return false;
  }
  try {
    await fs.promises.writeFile(edit.filePath, fromDisk, "utf8");
  } catch {
    return false;
  }
  noteAccepted(edit.filePath, fromDisk);
  return true;
}

async function writeBack(fsPath: string, previous: string, expected: string): Promise<boolean> {
  const open = findOpen(fsPath);
  if (open && equivalentText(open.getText(), expected)) {
    const applied = await replaceDocument(open, previous);
    if (!applied) {
      return false;
    }
    if (open.isDirty) {
      await open.save();
    }
    noteAccepted(fsPath, previous);
    return true;
  }
  const disk = await readText(fsPath);
  if (disk === undefined || !equivalentText(disk, expected)) {
    return false;
  }
  await fs.promises.writeFile(fsPath, previous, "utf8");
  if (open && equivalentText(open.getText(), expected)) {
    await replaceDocument(open, previous);
    if (open.isDirty) {
      await open.save();
    }
  }
  noteAccepted(fsPath, previous);
  return true;
}

async function replaceDocument(doc: vscode.TextDocument, text: string): Promise<boolean> {
  const full = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, full, text);
  return vscode.workspace.applyEdit(edit);
}

async function installAgentHooks(
  context: vscode.ExtensionContext,
  home: string,
): Promise<void> {
  const sourcePath = path.join(context.extensionPath, "hook", "notify.js");
  let scriptSource: string;
  try {
    scriptSource = await fs.promises.readFile(sourcePath, "utf8");
  } catch {
    void vscode.window.showErrorMessage(
      "Comprehension Guard: notifier script is missing from the extension install.",
    );
    return;
  }
  let pauseSource: string | undefined;
  try {
    pauseSource = await fs.promises.readFile(path.join(context.extensionPath, "hook", "pause.js"), "utf8");
  } catch {
    void vscode.window.showWarningMessage(
      "Comprehension Guard: pause script is missing from the extension install. Agent pause was not installed.",
    );
  }
  const nodePath = resolveNodeBinary();
  const plan = planHookInstall({
    homeDir: home,
    nodePath,
    scriptSource,
    pauseSource,
    claude: readConfig(path.join(home, ".claude", "settings.json")),
    codex: readConfig(path.join(home, ".codex", "hooks.json")),
    cursor: readConfig(path.join(home, ".cursor", "hooks.json")),
    gemini: readConfig(path.join(home, ".gemini", "settings.json")),
    copilot: readConfig(path.join(home, ".copilot", "hooks", "comprehension-guard.json")),
    droid: readConfig(path.join(home, ".factory", "hooks.json")),
    goose: readConfig(path.join(home, ".agents", "plugins", "comprehension-guard", "hooks", "hooks.json")),
    antigravity: readConfig(path.join(home, ".gemini", "config", "hooks.json")),
  });
  for (const write of plan.writes) {
    await fs.promises.mkdir(path.dirname(write.path), { recursive: true });
    await fs.promises.writeFile(write.path, write.contents, { mode: 0o600 });
  }
  const parts: string[] = [];
  if (plan.installed.length > 0) {
    parts.push("Installed hooks for " + plan.installed.join(", ") + ".");
  }
  if (plan.unchanged.length > 0) {
    parts.push("Already set up: " + plan.unchanged.join(", ") + ".");
  }
  parts.push(
    "Start a new agent session so the hooks load. In Codex, run /hooks and trust the comprehension-guard hook.",
  );
  if (nodePath === "node") {
    parts.push("Node was not found on PATH; the hook command uses `node` and will fail until it is installed.");
  }
  void vscode.window.showInformationMessage("Comprehension Guard: " + parts.join(" "));
  if (plan.errors.length > 0) {
    void vscode.window.showWarningMessage(
      "Comprehension Guard: " + plan.errors.join(" "),
    );
  }
}

function startTransport(
  home: string,
  onEvent: (body: unknown) => void,
  onPause: (body: unknown) => Promise<PauseWire>,
): vscode.Disposable {
  const dir = guardDirectory(home);
  const token = crypto.randomBytes(16).toString("hex");
  const endpointFile = path.join(dir, "endpoint.json");
  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? "").split("?")[0];
    if (req.method !== "POST" || (pathname !== "/event" && pathname !== "/pause")) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.headers["x-guard-token"] !== token) {
      res.writeHead(401);
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2_000_000) {
        rejected = true;
        res.writeHead(413);
        res.end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (rejected) {
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      if (pathname === "/pause") {
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          writePause(res, continueWire());
          return;
        }
        void onPause(body)
          .then((decision) => {
            if (!res.writableEnded) {
              writePause(res, decision);
            }
          })
          .catch(() => {
            if (!res.writableEnded) {
              writePause(res, continueWire());
            }
          });
        return;
      }
      res.writeHead(204);
      res.end();
      try {
        onEvent(JSON.parse(raw));
      } catch {
        // Ignore malformed bodies.
      }
    });
  });
  server.on("error", () => {
    void vscode.window.showWarningMessage(
      "Comprehension Guard: could not listen for AI agent edits. Hook events will queue on disk until the editor is restarted.",
    );
  });
  server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      endpointFile,
      JSON.stringify({ port: addr.port, token, pid: process.pid }) + "\n",
      { mode: 0o600 },
    );
  });

  const inbox = path.join(dir, "inbox");
  const poll = setInterval(() => {
    let names: string[] = [];
    try {
      names = fs.readdirSync(inbox);
    } catch {
      return;
    }
    names.sort();
    for (const name of names) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const full = path.join(inbox, name);
      let raw: string;
      try {
        raw = fs.readFileSync(full, "utf8");
        fs.unlinkSync(full);
      } catch {
        continue;
      }
      try {
        onEvent(JSON.parse(raw));
      } catch {
        // Drop unreadable events.
      }
    }
  }, 800);

  return {
    dispose: () => {
      clearInterval(poll);
      server.close();
      try {
        const current = JSON.parse(fs.readFileSync(endpointFile, "utf8")) as { pid?: number; token?: string };
        if (current.pid === process.pid && current.token === token) {
          fs.unlinkSync(endpointFile);
        }
      } catch {
        // Already gone.
      }
    },
  };
}

function writePause(res: http.ServerResponse, body: PauseWire): void {
  const raw = JSON.stringify(body);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

function continueWire(): PauseWire {
  return { allow: true, reason: "continue", userMessage: "", agentMessage: "" };
}

function readAgentPause(): boolean {
  return vscode.workspace.getConfiguration("comprehensionGuard").get<boolean>("agentPause", true);
}

function readPreset(): CheckPreset {
  const value = vscode.workspace.getConfiguration("comprehensionGuard").get<string>("checkPreset", "standard");
  if (value === "quick" || value === "standard" || value === "deep") {
    return value;
  }
  return "standard";
}

function readPreferences(): LearnerPreferences {
  const config = vscode.workspace.getConfiguration("comprehensionGuard");
  const profile = activeContext ? getProfile(activeContext) : {};
  const settingLanguage = (config.get<string>("preferredLanguage", "") ?? "").trim();
  const settingStrict = (config.get<string>("strictness", "") ?? "").trim();
  const masteryByConcept: Record<string, number> = {};
  if (activeContext) {
    for (const row of getMastery(activeContext)) {
      if (row.concept) {
        masteryByConcept[row.concept] = row.mastery;
      }
    }
  }
  return {
    preset: readPreset(),
    preferredLanguage: settingLanguage || profile.preferredLanguage,
    strictness: profile.strictness || settingStrict || "standard",
    examDate: profile.examDate,
    interviewDate: profile.interviewDate,
    masteryByConcept,
  };
}

async function noteEditedFiles(home: string, body: unknown): Promise<void> {
  try {
    if (!isEnabled() || !acceptIncoming(body)) {
      return;
    }
    const edits = editsFromHookEnvelope(body, {
      readFile: readOptional,
      readSnapshot: (absPath) => readSnapshot(home, absPath),
    });
    const sessionId = pauseSessionId(body);
    const preferences = readPreferences();
    for (const edit of edits) {
      const text = edit.next ?? (await readCurrentText(edit.filePath));
      if (text === undefined) {
        continue;
      }
      await pauseSessions.noteFile(sessionId, preferences, edit.filePath, text, {
        snippet: edit.snippet,
        hunks: edit.hunks,
        created: edit.created,
      });
    }
  } catch {
    // Leave the agent unblocked if analysis cannot run.
  }
}

type AskStep = "pass" | "fail" | "bypass";
type PickResult = number | "bypass" | "dismiss";

async function askCheckpoint(questions: LocalQuestion[]): Promise<boolean> {
  if (questions.length === 0) {
    return true;
  }
  setQuizActive(true);
  try {
    for (const question of questions) {
      if (question.file) {
        markEditorGate(question.file, question.code ?? question.prompt);
      }
      const result = await askOne(question);
      if (result === "bypass") {
        void vscode.window.setStatusBarMessage(
          "Comprehension Guard: check bypassed. The agent can continue.",
          4000,
        );
        return true;
      }
      if (result === "fail") {
        return false;
      }
    }
    void vscode.window.showInformationMessage("Comprehension Guard: check passed. The agent can continue.");
    return true;
  } finally {
    setQuizActive(false);
  }
}

async function askOne(question: LocalQuestion): Promise<AskStep> {
  const context = activeContext;
  if (context && question.code && question.requestedKind && question.requestedKind !== "multiple_choice") {
    try {
      const passed = await askWithEngine(context, question);
      return passed ? "pass" : "fail";
    } catch {
      // Fall back to the local question when the model is unavailable.
    }
  }
  const result = question.type === "ordering" ? await askOrdering(question) : await askChoice(question);
  await recordLocalPause(question, result === "pass", result === "bypass");
  return result;
}

async function askWithEngine(context: vscode.ExtensionContext, question: LocalQuestion): Promise<boolean> {
  const kind = engineKind(question.requestedKind ?? "multiple_choice");
  const generated = await generateQuestion({
    context,
    snippet: question.code ?? "",
    language: "",
    mode: kind === "multiple-choice" ? "multiple-choice" : "free-text",
    kind,
  });
  generated.conceptTags = question.concept ? [question.concept] : generated.conceptTags;
  return runSession(context, {
    snippet: question.code ?? "",
    filePath: question.file,
    questions: [generated],
    source: "agent",
  });
}

function engineKind(kind: QuestionType): QuestionKind {
  if (kind === "ordering") return "ordering";
  if (kind === "change") return "debug";
  if (kind === "explain") return "free-text";
  return "multiple-choice";
}

async function recordLocalPause(question: LocalQuestion, passed: boolean, bypassed = false): Promise<void> {
  const context = activeContext;
  if (!context || !question.concept) {
    return;
  }
  await recordDashboardCheck(context, {
    eventId: newDashboardCheckId(), timestamp: Date.now(), filePath: question.file,
    check: {
      concepts: [question.concept], question: question.prompt,
      // This local picker currently returns only an outcome, not the selected answer.
      answer: "", feedback: bypassed ? "Check bypassed." : passed ? "Correct." : "Not quite.",
      misconception: "", outcome: bypassed ? "bypass" : passed ? "pass" : "fail",
      score: bypassed ? null : passed ? 1 : 0, source: "agent",
      mode: question.type === "ordering" ? "ordering" : "multiple-choice", filePath: null, retries: 0,
    },
  });
  if (bypassed) return;
  const record: AttemptRecord = {
    timestamp: Date.now(),
    language: "",
    charCount: question.code?.length ?? 0,
    mode: "multiple-choice",
    conceptTags: [question.concept],
    passed,
    outcome: passed ? "pass" : "fail",
    followups: 0,
    judgeConfigId: "local-pause",
    score: passed ? 1 : 0,
    source: "agent",
    filePath: question.file,
  };
  await addAttempt(context, record);
  const masteryAfter = await rememberCheck(context, record);
  await logReview(context, {
    concepts: record.conceptTags,
    eventKind: "check",
    source: "agent",
    mode: "multiple-choice",
    score: record.score,
    passed,
    followups: 0,
    masteryAfter,
    filePath: question.file,
    question: question.prompt,
    studentAnswer: "",
    misconception: "",
    askedForExplanation: false,
    explanation: "",
    judgeConfigId: "local-pause",
  });
}

async function askChoice(question: LocalQuestion): Promise<AskStep> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const picked = await pickOption(question);
    if (picked === "dismiss") {
      return "fail";
    }
    if (picked === "bypass") {
      return "bypass";
    }
    if (gradeLocal(question, { selectedIndex: picked })) {
      return "pass";
    }
    if (attempt === 0) {
      await vscode.window.showWarningMessage(question.hint);
    }
  }
  return "fail";
}

async function askOrdering(question: LocalQuestion): Promise<AskStep> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const order: number[] = [];
    const used = new Set<number>();
    while (order.length < question.options.length) {
      const picked = await pickOption(question, used);
      if (picked === "dismiss") {
        return "fail";
      }
      if (picked === "bypass") {
        return "bypass";
      }
      order.push(picked);
      used.add(picked);
    }
    if (gradeLocal(question, { order })) {
      return "pass";
    }
    if (attempt === 0) {
      await vscode.window.showWarningMessage(question.hint);
    }
  }
  return "fail";
}

async function pickOption(question: LocalQuestion, hidden?: ReadonlySet<number>): Promise<PickResult> {
  const items: Array<vscode.QuickPickItem & { pick: PickResult }> = [];
  question.options.forEach((label, index) => {
    if (hidden?.has(index)) {
      return;
    }
    items.push({ label, pick: index });
  });
  items.push({ label: "Bypass this check", pick: "bypass" });
  const picked = await vscode.window.showQuickPick(items, {
    title: question.prompt,
    placeHolder: question.prompt,
    ignoreFocusOut: true,
  });
  if (!picked) {
    return "dismiss";
  }
  return picked.pick;
}

async function readCurrentText(fsPath: string): Promise<string | undefined> {
  const open = findOpen(fsPath);
  if (open) {
    return open.getText();
  }
  return readText(fsPath);
}

function acceptIncoming(body: unknown): boolean {
  if (!body || typeof body !== "object") {
    return false;
  }
  const receivedAt = (body as { receivedAt?: unknown }).receivedAt;
  if (typeof receivedAt !== "number") {
    return true;
  }
  return isFreshEvent(receivedAt, Date.now());
}

function readConfig(filePath: string): ConfigInput {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { kind: "missing" };
    }
    const reason = err instanceof Error ? err.message : "unreadable";
    return { kind: "invalid", reason };
  }
  if (!text.trim()) {
    return { kind: "missing" };
  }
  const parsed = parseConfigText(text);
  if (!parsed.ok) {
    return { kind: "invalid", reason: parsed.reason };
  }
  return { kind: "ok", value: parsed.value };
}

function readOptional(fsPath: string): string | undefined {
  try {
    return fs.readFileSync(fsPath, "utf8");
  } catch {
    return undefined;
  }
}

function readSnapshot(home: string, absPath: string): string | undefined {
  try {
    return fs.readFileSync(
      path.join(guardDirectory(home), "snapshots", snapshotFileName(absPath)),
      "utf8",
    );
  } catch {
    return undefined;
  }
}

async function readText(fsPath: string): Promise<string | undefined> {
  try {
    return await fs.promises.readFile(fsPath, "utf8");
  } catch {
    return undefined;
  }
}

async function rememberFile(fsPath: string): Promise<void> {
  const open = findOpen(fsPath);
  if (open) {
    noteAccepted(fsPath, open.getText());
    return;
  }
  const disk = await readText(fsPath);
  if (disk !== undefined) {
    noteAccepted(fsPath, disk);
  }
}

function findOpen(fsPath: string): vscode.TextDocument | undefined {
  const want = normPath(fsPath);
  return vscode.workspace.textDocuments.find(
    (doc) => doc.uri.scheme === "file" && normPath(doc.uri.fsPath) === want,
  );
}

function resolveNodeBinary(): string {
  const override = process.env.COMPREHENSION_GUARD_NODE;
  if (override && override.trim()) {
    return override.trim();
  }
  try {
    const command = process.platform === "win32" ? "where.exe" : "which";
    const out = execFileSync(command, ["node"], { encoding: "utf8" });
    const first = out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (first) {
      return first;
    }
  } catch {
    // Fall through to a PATH lookup at hook time.
  }
  return "node";
}

function agentLabel(agent: string): string {
  if (agent === "claude-code") {
    return "Claude Code";
  }
  if (agent === "codex") {
    return "Codex";
  }
  if (agent === "cursor") {
    return "Cursor agent";
  }
  if (agent === "gemini") {
    return "Gemini CLI";
  }
  if (agent === "droid") {
    return "Droid";
  }
  if (agent === "goose") {
    return "Goose";
  }
  if (agent === "antigravity") {
    return "Antigravity";
  }
  if (agent === "disk") {
    return "an external edit";
  }
  return "an AI coding agent";
}

function isUndoRedo(event: vscode.TextDocumentChangeEvent): boolean {
  return (
    event.reason === vscode.TextDocumentChangeReason.Undo ||
    event.reason === vscode.TextDocumentChangeReason.Redo
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
