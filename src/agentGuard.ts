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
import { checkShapeFor, collapseEdits, modelKindFor, planForEdits, type CodeChunk } from "./heldReview";
import { beginQuestion, runComprehensionGate } from "./quiz";
import { getMastery, getProfile } from "./memory/remember";
import type { LearnerPreferences } from "./sizing/chunkPolicy";
import { pauseSessionId, type PauseWire } from "./sizing/pauseSession";
import type { CheckPreset } from "./sizing/types";
import { offerWalkthrough } from "./walkthrough";
import { getCharThreshold, isEnabled, setBypassArmed, setQuizActive, state, wantsWalkthrough } from "./state";

/**
 * Quizzes code written by Claude Code, Codex, the Cursor agent, or Gemini CLI.
 *
 * Hooks are the reliable signal: a notifier posts the tool payload to a
 * localhost port, or leaves a file in an inbox if the editor is closed.
 * Open files also get a fallback for large disk changes that did not come
 * from the focused editor. A burst of many files (git checkout, pull) is ignored.
 */

const QUIET_BATCH_MS = 700;
/** Claude Code writes the next file about 1.4–1.8s later, so a session stays open longer. */
const SESSION_BATCH_MS = 2500;

/** Quiet time after the agent's last tool call before the held code is checked. */
const REVIEW_SETTLE_MS = 1200;

type PendingDiskEdit = {
  fsPath: string;
  previous: string;
  current: string;
  snippet: string;
};

type QueuedEdit = AgentEdit & { key: string; lineCount: number; group: string };

let activeContext: vscode.ExtensionContext | undefined;

export function registerAgentGuard(context: vscode.ExtensionContext): void {
  activeContext = context;
  const home = resolveGuardHome(process.env.COMPREHENSION_GUARD_HOME, os.homedir());
  const queue: QueuedEdit[] = [];
  const pending = new Map<string, PendingDiskEdit>();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let batchTimer: ReturnType<typeof setTimeout> | undefined;
  let reviewTimer: ReturnType<typeof setTimeout> | undefined;
  let reviewActive = false;
  const reviewQueue: AgentEdit[] = [];
  let draining = false;

  const enqueue = (edit: AgentEdit, group = ""): void => {
    const lineCount = edit.snippet.split(/\r?\n/).length;
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
    if (heldKeys.has(key)) {
      void revertEdit(edit);
      return;
    }
    holdPath(edit.filePath);
    queue.push({ ...edit, snippet, key, lineCount, group });
    if (batchTimer) {
      clearTimeout(batchTimer);
    }
    const wait = group && !group.startsWith("default\0") ? SESSION_BATCH_MS : QUIET_BATCH_MS;
    batchTimer = setTimeout(() => void drain(), wait);
  };

  const drain = async (): Promise<void> => {
    if (draining) {
      return;
    }
    draining = true;
    try {
      while (queue.length > 0) {
        while (state.processing) {
          await delay(40);
        }
        const group = queue[0].group;
        const batch: QueuedEdit[] = [];
        for (let i = 0; i < queue.length; ) {
          if (queue[i].group === group) {
            batch.push(queue.splice(i, 1)[0]);
          } else {
            i += 1;
          }
        }
        const lines = batch.reduce((count, edit) => count + edit.lineCount, 0);
        const files = new Set(batch.map((edit) => normPath(edit.filePath))).size;
        if (!readAgentPause() && wantsWalkthrough(files, lines)) {
          for (const edit of batch) {
            releasePath(edit.filePath);
          }
          void offerWalkthrough(context, batch).catch(() => undefined);
          continue;
        }
        for (const edit of batch) {
          try {
            await persistHeld(home, edit);
            await revertEdit(edit);
          } catch {
            // The quiz still runs. The in-memory edit is the copy we can write back.
          }
        }
        for (const edit of batch) {
          if (readAgentPause() && isCoveredByEditorGate(edit.filePath, edit.snippet)) {
            releasePath(edit.filePath);
            continue;
          }
          await runAgentQuiz(context, edit, home);
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
    const group = hookGroup(body);
    for (const edit of edits) {
      const open = findOpen(edit.filePath);
      const baseline = edit.restore
        ? undefined
        : open?.isDirty
          ? open.getText()
          : acceptedText(edit.filePath);
      const prepared = withBaseline(edit, baseline);
      enqueue(prepared, group);
    }
  };

  const scheduleReview = (): void => {
    if (reviewTimer) {
      clearTimeout(reviewTimer);
    }
    reviewTimer = setTimeout(() => void runSettledReview(), REVIEW_SETTLE_MS);
  };

  const collectReview = (body: unknown): void => {
    const edits = editsFromHookEnvelope(body, {
      readFile: readOptional,
      readSnapshot: (absPath) => readSnapshot(home, absPath),
    });
    for (const edit of edits) {
      const prepared = withBaseline(edit, edit.restore ? undefined : acceptedText(edit.filePath));
      const snippet = quizSnippet(prepared.snippet);
      if (snippet.length < getCharThreshold() || looksBinary(snippet) || isIgnoredCodePath(prepared.filePath)) {
        continue;
      }
      reviewQueue.push({ ...prepared, snippet });
    }
    if (reviewQueue.length > 0) {
      scheduleReview();
    }
  };

  const runSettledReview = async (): Promise<void> => {
    reviewTimer = undefined;
    if (reviewActive || reviewQueue.length === 0) {
      return;
    }
    const batch = collapseEdits(reviewQueue.splice(0));
    reviewActive = true;
    state.processing = true;
    setQuizActive(true);
    for (const edit of batch) {
      holdPath(edit.filePath);
    }
    try {
      const preferences = readPreferences();
      const planned = await planForEdits(batch, preferences);
      if (planned.chunks.length === 0) {
        if (!planned.sawUnits) {
          await runGeneralReview(context, batch);
        }
        return;
      }
      if (checkShapeFor(preferences) === "chunks") {
        await runChunkReview(context, batch, planned.chunks);
      } else {
        await runGeneralReview(context, batch, planned.chunks);
      }
    } catch {
      for (const edit of batch) {
        await applyHeldEdit(edit);
      }
    } finally {
      setQuizActive(false);
      state.processing = false;
      reviewActive = false;
      for (const edit of batch) {
        releasePath(edit.filePath);
      }
      await vscode.commands.executeCommand("setContext", "comprehensionGuard.holdingCode", false);
      if (reviewQueue.length > 0) {
        scheduleReview();
      }
    }
  };

  const acceptHook = (body: unknown): void => {
    if (!isEnabled() || !acceptIncoming(body)) {
      return;
    }
    if (!readAgentPause()) {
      onHook(body);
      return;
    }
    collectReview(body);
  };

  const transport = startTransport(home, acceptHook, async () => {
    if (!readAgentPause() || !isEnabled()) {
      return continueWire();
    }
    if (reviewActive || state.processing) {
      return {
        allow: false,
        reason: "failed",
        userMessage: "Comprehension Guard is checking the code the agent just wrote.",
        agentMessage:
          "Comprehension Guard is checking the code you already wrote. Wait until that check finishes, then continue.",
      };
    }
    if (reviewQueue.length > 0) {
      scheduleReview();
    }
    return {
      allow: true,
      reason: "continue",
      userMessage: "",
      agentMessage:
        "Finish the whole change. Comprehension Guard checks it after you stop writing, not between files.",
    };
  });
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
        reviewQueue.push({
          agent: "disk",
          filePath: item.fsPath,
          snippet: item.snippet,
          hunks: [],
          restore: { previous: item.previous, next: item.current },
          next: item.current,
        });
        scheduleReview();
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
    const delay = pending.size <= 1 ? 160 : DISK_FALLBACK_DELAY_MS;
    flushTimer = setTimeout(flushPending, delay);
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
      if (batchTimer) {
        clearTimeout(batchTimer);
      }
      if (reviewTimer) {
        clearTimeout(reviewTimer);
      }
    },
  });

  void offerHeldEdits(home, enqueue);
}

function heldPath(home: string, filePath: string): string {
  return path.join(guardDirectory(home), "held", snapshotFileName(filePath) + ".json");
}

const heldKeys = new Set<string>();

async function persistHeld(home: string, edit: AgentEdit): Promise<void> {
  const file = heldPath(home, edit.filePath);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify(edit), "utf8");
  heldKeys.add(normPath(edit.filePath) + "\0" + quizSnippet(edit.snippet));
}

async function clearHeld(home: string, filePath: string): Promise<void> {
  await fs.promises.rm(heldPath(home, filePath), { force: true });
}

async function offerHeldEdits(
  home: string,
  enqueue: (edit: AgentEdit, group?: string) => void,
): Promise<void> {
  const dir = path.join(guardDirectory(home), "held");
  let names: string[] = [];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return;
  }
  const edits: AgentEdit[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = await fs.promises.readFile(path.join(dir, name), "utf8");
      const edit = JSON.parse(raw) as AgentEdit;
      if (edit && typeof edit.filePath === "string" && typeof edit.snippet === "string") {
        edits.push(edit);
      }
    } catch {
      // Skip a damaged record.
    }
  }
  if (edits.length === 0 || !isEnabled()) {
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    "Comprehension Guard: " + edits.length + " agent edit" + (edits.length === 1 ? "" : "s") + " still need a check.",
    "Check them",
    "Discard",
  );
  if (choice === "Discard") {
    for (const edit of edits) {
      await clearHeld(home, edit.filePath);
    }
    return;
  }
  if (choice !== "Check them") {
    return;
  }
  for (const edit of edits) {
    enqueue(edit, "held");
  }
}

function hookGroup(body: unknown): string {
  const session = pauseSessionId(body);
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const payload = record.payload && typeof record.payload === "object"
    ? record.payload as Record<string, unknown>
    : record;
  const prompt = typeof payload.prompt_id === "string"
    ? payload.prompt_id
    : typeof payload.promptId === "string"
      ? payload.promptId
      : "";
  return session + "\0" + prompt;
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

  let onDisk = "";
  try {
    onDisk = fs.readFileSync(fsPath, "utf8");
  } catch {
    noteAccepted(fsPath, current);
    return;
  }
  if (!equivalentText(onDisk, current)) {
    noteAccepted(fsPath, current);
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

async function runGeneralReview(
  context: vscode.ExtensionContext,
  edits: AgentEdit[],
  chunks?: CodeChunk[],
): Promise<void> {
  const held: AgentEdit[] = [];
  for (const edit of edits) {
    held.push(prepareHeldEdit(edit, await readText(edit.filePath), acceptedText(edit.filePath)));
  }
  const questions = (chunks ?? []).map((chunk) =>
    beginQuestion(
      context,
      chunk.code,
      languageFromPath(chunk.filePath),
      modelKindFor(chunk.questionType),
      chunk.filePath,
    ),
  );
  const snippet = held
    .map((edit) => quizSnippet(edit.snippet))
    .filter((text) => text.trim().length > 0)
    .join("\n\n")
    .slice(0, 8000);
  if (questions.length === 0 && !snippet.trim()) {
    return;
  }
  const first = held[0];
  if (!first) {
    return;
  }
  if (questions.length === 0) {
    questions.push(beginQuestion(context, snippet, languageFromPath(first.filePath), undefined, first.filePath));
  }
  for (const edit of held) {
    await revertEdit(edit);
  }
  const asked = chunks && chunks.length > 0 ? chunks : [{ code: snippet, filePath: first.filePath, unit: first.filePath }];
  for (let index = 0; index < asked.length; index += 1) {
    const item = asked[index];
    void vscode.window.setStatusBarMessage(
      `Comprehension Guard: question ${index + 1} of ${asked.length}.`,
      4000,
    );
    const passed = await runComprehensionGate(item.code, context, languageFromPath(item.filePath), {
      source: "agent",
      filePath: item.filePath,
      prepared: questions[index],
    });
    if (!passed) {
      return;
    }
  }
  for (const edit of held) {
    markEditorGate(edit.filePath, edit.snippet);
    const inserted = await applyHeldEdit(edit);
    if (!inserted) {
      void vscode.window.showWarningMessage(
        "Comprehension Guard: the check was passed, but the generated code could not be written into the file.",
      );
    }
  }
}

async function runChunkReview(
  context: vscode.ExtensionContext,
  edits: AgentEdit[],
  chunks: CodeChunk[],
): Promise<void> {
  await vscode.commands.executeCommand("setContext", "comprehensionGuard.holdingCode", true);
  const locks = new Map<string, ReturnType<typeof lockDocument>>();
  const questions = chunks.map((chunk) =>
    beginQuestion(
      context,
      chunk.code,
      languageFromPath(chunk.filePath),
      modelKindFor(chunk.questionType),
      chunk.filePath,
    ),
  );
  try {
    for (const edit of edits) {
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(edit.filePath));
        locks.set(normPath(edit.filePath), lockDocument(doc));
      } catch {
        // A missing file is still covered by the later revert.
      }
    }
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(chunk.filePath));
      const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
      const range = lineRange(doc, chunk.startLine, chunk.endLine);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      void vscode.window.setStatusBarMessage(
        `Comprehension Guard: ${chunk.unit} (${index + 1} of ${chunks.length}).`,
        4000,
      );
      const passed = await runComprehensionGate(chunk.code, context, languageFromPath(chunk.filePath), {
        source: "agent",
        filePath: chunk.filePath,
        prepared: questions[index],
        editor,
        range,
        lock: locks.get(normPath(chunk.filePath)),
      });
      if (!passed) {
        for (const lock of locks.values()) {
          lock.release();
        }
        locks.clear();
        for (const edit of edits) {
          await revertEdit(prepareHeldEdit(edit, await readText(edit.filePath), acceptedText(edit.filePath)));
        }
        return;
      }
    }
    for (const edit of edits) {
      const kept = edit.restore?.next ?? edit.next;
      if (kept !== undefined) {
        noteAccepted(edit.filePath, kept);
      }
      markEditorGate(edit.filePath, edit.snippet);
    }
    void vscode.window.showInformationMessage("Comprehension Guard: chunk checks passed. The generated code stays.");
  } finally {
    for (const lock of locks.values()) {
      lock.release();
    }
  }
}

function lineRange(document: vscode.TextDocument, startLine: number, endLine: number): vscode.Range {
  const start = Math.max(0, startLine - 1);
  const end = Math.min(document.lineCount - 1, Math.max(start, endLine - 1));
  return new vscode.Range(new vscode.Position(start, 0), document.lineAt(end).range.end);
}

async function runAgentQuiz(
  context: vscode.ExtensionContext,
  edit: AgentEdit,
  home: string,
): Promise<void> {
  const open = findOpen(edit.filePath);
  const buffer = open?.getText();
  const disk = await readText(edit.filePath);
  let landed = disk ?? buffer;
  if (edit.restore && landed !== undefined && equivalentText(landed, edit.restore.previous)) {
    landed = edit.restore.next;
  }
  const baseline = open?.isDirty && buffer !== undefined && landed !== undefined && !equivalentText(buffer, landed)
    ? buffer
    : acceptedText(edit.filePath);
  const prepared = prepareHeldEdit(edit, landed, baseline);
  const added = prepared.restore
    ? diffAddedText(prepared.restore.previous, prepared.restore.next)
    : "";
  if (looksLikeAgentInvocation(prepared.snippet) || looksLikeAgentInvocation(added)) {
    // The terminal command landed in the file. Remove it and wait for generated code.
    if (prepared.restore && looksLikeAgentInvocation(added)) {
      await revertEdit(prepared);
    }
    releasePath(edit.filePath);
    return;
  }
  const snippet = quizSnippet(prepared.snippet);
  if (!isEnabled() || snippet.length < getCharThreshold()) {
    releasePath(edit.filePath);
    return;
  }
  if (isCoveredByEditorGate(edit.filePath, snippet)) {
    releasePath(edit.filePath);
    return;
  }
  if (state.bypassArmed) {
    setBypassArmed(false);
    await rememberFile(edit.filePath);
    await clearHeld(home, edit.filePath);
    releasePath(edit.filePath);
    return;
  }

  markEditorGate(edit.filePath, snippet);
  state.suppressEditGuard = true;
  state.processing = true;
  const questionPromise = beginQuestion(
    context,
    snippet,
    languageFromPath(edit.filePath),
    undefined,
    edit.filePath,
  );
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
    // The batch revert already ran. Revert again only if the agent text is still in the file.
    const alreadyHeld = prepared.restore !== undefined && (
      (disk !== undefined && equivalentText(disk, prepared.restore.previous)) ||
      (buffer !== undefined && equivalentText(buffer, prepared.restore.previous))
    );
    const withheld = alreadyHeld || await revertEdit(prepared);
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
      prepared: questionPromise,
    });
    unlock();
    if (passed) {
      const inserted = await applyHeldEdit(prepared);
      if (inserted) {
        await clearHeld(home, edit.filePath);
      } else {
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
      } else {
        await clearHeld(home, edit.filePath);
      }
    } else if (prepared.restore) {
      noteAccepted(edit.filePath, prepared.restore.previous);
      await clearHeld(home, edit.filePath);
    }
  } catch {
    unlock();
    void vscode.window.showWarningMessage(
      "Comprehension Guard: the check stopped early. The generated code is still held and was not written into the file.",
    );
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

async function writeBack(fsPath: string, next: string, _expected: string): Promise<boolean> {
  try {
    await fs.promises.mkdir(path.dirname(fsPath), { recursive: true });
    await fs.promises.writeFile(fsPath, next, "utf8");
  } catch {
    return false;
  }
  const open = findOpen(fsPath);
  if (open && !equivalentText(open.getText(), next)) {
    const applied = await replaceDocument(open, next);
    if (!applied) {
      return false;
    }
  }
  noteAccepted(fsPath, open?.getText() ?? next);
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
  }, 200);

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

function languageFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const names: Record<string, string> = {
    ".js": "javascript",
    ".jsx": "javascriptreact",
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".rb": "ruby",
    ".php": "php",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".cc": "cpp",
  };
  return names[ext] ?? "";
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
