import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { AGENT_BEFORE, AGENT_NEW_BODY } from "../manifest";
import {
  GOOD_ANSWER,
  QUESTION_JSON,
  Recorder,
  SNIPPET,
  agentWrite,
  backupsContain,
  closeEditorTab,
  closeQuizTab,
  docFor,
  env,
  focusDoc,
  guardHomeContains,
  guardIsIdle,
  has,
  inboxFiles,
  isLocked,
  judgeJson,
  llm,
  maybeWait,
  openEditor,
  openFile,
  openPanels,
  panels,
  quizTabs,
  readDisk,
  send,
  setClipboard,
  short,
  sleep,
  submit,
  track,
  unhandled,
  useLlm,
  waitFor,
  waitForEndpoint,
  waitForHeld,
  waitForPanel,
  wsPath,
  type PanelRec,
} from "./driver";

type Ctx = {
  rec: Recorder;
  phase: number;
  reload: () => Promise<never>;
  crash: () => Promise<never>;
};
type Step = (ctx: Ctx) => Promise<void>;

const ORIGINAL = "const keep = 1;\n";
const AGENT_MARKER = "item.price * (typeof item.qty";

// ---------------------------------------------------------------------------
// Shared flows

async function startPaste(editor: vscode.TextEditor, snippet = SNIPPET): Promise<{ panel: PanelRec; cmd: ReturnType<typeof track> }> {
  await setClipboard(snippet);
  await vscode.window.showTextDocument(editor.document, { preview: false, viewColumn: editor.viewColumn });
  const before = panels.length;
  const cmd = track(vscode.commands.executeCommand("comprehensionGuard.paste"));
  const panel = await waitForPanel(before);
  return { panel, cmd };
}

async function startInline(editor: vscode.TextEditor, snippet = SNIPPET): Promise<PanelRec> {
  await vscode.window.showTextDocument(editor.document, { preview: false, viewColumn: editor.viewColumn });
  const before = panels.length;
  const end = editor.document.lineAt(editor.document.lineCount - 1).range.end;
  // One large insertion in the focused editor, like an accepted AI completion.
  await editor.edit((b) => b.insert(end, snippet));
  return waitForPanel(before);
}

async function startAgent(rel: string, openFirst: boolean): Promise<PanelRec> {
  await waitForEndpoint();
  if (openFirst) {
    await openEditor(rel, AGENT_BEFORE);
    // Let the agent guard record the baseline for the open file.
    await sleep(300);
  } else {
    fs.mkdirSync(path.dirname(wsPath(rel)), { recursive: true });
    fs.writeFileSync(wsPath(rel), AGENT_BEFORE);
  }
  const before = panels.length;
  await agentWrite(rel, AGENT_NEW_BODY);
  return waitForPanel(before, 15_000);
}

async function settle(cmd: ReturnType<typeof track>, rec: Recorder, label: string): Promise<void> {
  await maybeWait(() => cmd.settled(), 8000);
  rec.check(cmd.settled(), label + ": guarded command finished", cmd.settled() ? "finished" : "still pending after 8s");
  if (cmd.error()) {
    rec.note(label + ": guarded command rejected with: " + cmd.error());
  }
}

async function idleAndUnlocked(rec: Recorder, doc: vscode.TextDocument | undefined): Promise<void> {
  if (doc && !doc.isClosed) {
    const locked = await isLocked(doc);
    rec.check(!locked, "file is editable again after the quiz ends", locked ? "edits are still reverted (stuck lock)" : "editable");
  }
  const idle = await guardIsIdle();
  rec.check(idle, "guard is idle: a new large insertion raises a new quiz", idle ? "new quiz opened" : "no quiz (guard stuck or bypass armed)");
}

function noteUnhandled(rec: Recorder): void {
  for (const reason of unhandled) {
    rec.note("unhandled rejection in extension host: " + reason);
  }
}

// ---------------------------------------------------------------------------
// Paste

const pasteCloseMidQuestion: Step = async ({ rec }) => {
  const editor = await openEditor("src/a.js", ORIGINAL);
  const { panel, cmd } = await startPaste(editor);
  rec.check(has(editor.document.getText(), SNIPPET), "pasted code is visible while the quiz is open", short(editor.document.getText()));
  rec.check(await isLocked(editor.document), "file is locked while the quiz is open", "probe edit reverted?");
  await closeQuizTab(panel);
  await settle(cmd, rec, "paste");
  rec.check(editor.document.getText() === ORIGINAL, "closing removes the pasted code", short(editor.document.getText()));
  await idleAndUnlocked(rec, editor.document);
};

function pasteCloseMidGrading(verdict: "pass" | "fail"): Step {
  return async ({ rec }) => {
    await useLlm();
    llm.holdJudge = true;
    const editor = await openEditor("src/a.js", ORIGINAL);
    const { panel, cmd } = await startPaste(editor);
    submit(panel, GOOD_ANSWER);
    const judgeCall = await waitForHeld("judge");
    rec.note("judge request in flight when the tab is closed");
    await closeQuizTab(panel);
    await sleep(300);
    rec.check(!cmd.settled(), "(info) gate still waiting on the grade after the tab closed", cmd.settled() ? "already finished" : "waiting");
    judgeCall.release(judgeJson(verdict));
    await settle(cmd, rec, "paste");
    const text = editor.document.getText();
    rec.check(
      text === ORIGINAL,
      `closing the quiz tab mid-grading removes the code (grade=${verdict})`,
      text === ORIGINAL ? "removed" : "code KEPT: " + short(text),
    );
    rec.check(openPanels().length === 0 && quizTabs().length === 0, "no quiz left open", openPanels().length + " open panels");
    await idleAndUnlocked(rec, editor.document);
  };
}

const pasteCloseDuringFollowup: Step = async ({ rec }) => {
  await useLlm();
  llm.judgeVerdict = "fail";
  const editor = await openEditor("src/a.js", ORIGINAL);
  const { panel, cmd } = await startPaste(editor);
  submit(panel, GOOD_ANSWER);
  await waitFor(() => panel.posted.some((m) => m.type === "showFeedback"), 10_000, "follow-up feedback");
  rec.note("follow-up shown: " + (panel.posted.find((m) => m.type === "showFeedback")?.message ?? ""));
  await closeQuizTab(panel);
  await settle(cmd, rec, "paste");
  rec.check(editor.document.getText() === ORIGINAL, "closing during a follow-up removes the code", short(editor.document.getText()));
  await idleAndUnlocked(rec, editor.document);
};

const pasteSaveThenCloseQuiz: Step = async ({ rec }) => {
  const editor = await openEditor("src/a.js", ORIGINAL);
  const { panel, cmd } = await startPaste(editor);
  const saved = await editor.document.save();
  rec.note("Ctrl+S while locked: save() returned " + saved + "; disk now " + short(readDisk("src/a.js")));
  await closeQuizTab(panel);
  await settle(cmd, rec, "paste");
  rec.check(editor.document.getText() === ORIGINAL, "closing removes the code from the editor", short(editor.document.getText()));
  const disk = readDisk("src/a.js");
  rec.check(!has(disk, SNIPPET), "the failed paste is not left on disk", has(disk, SNIPPET) ? "disk STILL has the pasted code (buffer dirty=" + editor.document.isDirty + ")" : "disk clean");
  await idleAndUnlocked(rec, editor.document);
};

function pasteCloseEditor(outcome: "fail" | "pass"): Step {
  return async ({ rec }) => {
    const editor = await openEditor("src/a.js", ORIGINAL);
    const doc = editor.document;
    const { panel, cmd } = await startPaste(editor);
    await doc.save();
    const closed = await closeEditorTab(doc.uri);
    rec.note("saved, then closed the editor tab of the locked file: " + closed);
    await sleep(300);
    if (outcome === "fail") {
      await closeQuizTab(panel);
    } else {
      submit(panel, GOOD_ANSWER);
    }
    await settle(cmd, rec, "paste");
    const disk = readDisk("src/a.js");
    if (outcome === "fail") {
      rec.check(!has(disk, SNIPPET), "closing the quiz removes the paste even though its editor tab was closed", has(disk, SNIPPET) ? "pasted code STILL on disk" : "removed");
    } else {
      rec.check(has(disk, SNIPPET), "passing keeps the paste", has(disk, SNIPPET) ? "kept" : "LOST: " + short(disk));
    }
    noteUnhandled(rec);
    const reopened = await vscode.workspace.openTextDocument(vscode.Uri.file(wsPath("src/a.js")));
    await idleAndUnlocked(rec, reopened);
  };
}

const pasteUndoWhileLocked: Step = async ({ rec }) => {
  const editor = await openEditor("src/a.js", ORIGINAL);
  const { panel, cmd } = await startPaste(editor);
  await focusDoc(editor.document);
  await vscode.commands.executeCommand("undo");
  await sleep(700);
  rec.check(has(editor.document.getText(), SNIPPET), "undo while locked is reverted by the lock", short(editor.document.getText()));
  await closeQuizTab(panel);
  await settle(cmd, rec, "paste");
  rec.check(editor.document.getText() === ORIGINAL, "closing after an undo still leaves the original text", short(editor.document.getText()));
  await idleAndUnlocked(rec, editor.document);
};

const pasteUndoRedoAfterFail: Step = async ({ rec }) => {
  const editor = await openEditor("src/a.js", ORIGINAL);
  const { panel, cmd } = await startPaste(editor);
  await closeQuizTab(panel);
  await settle(cmd, rec, "paste");
  rec.check(editor.document.getText() === ORIGINAL, "closing removes the paste", short(editor.document.getText()));
  await sleep(1200);
  await focusDoc(editor.document);
  const before = panels.length;
  await vscode.commands.executeCommand("undo");
  const requiz = await maybeWait(() => panels.length > before && panels[panels.length - 1], 3000);
  const text = editor.document.getText();
  if (has(text, SNIPPET)) {
    rec.check(!!requiz, "undo that brings the removed paste back raises a quiz", requiz ? "quiz opened" : "code back WITHOUT a quiz");
  } else {
    rec.note("undo did not bring the paste back: " + short(text));
  }
  if (requiz) {
    await closeQuizTab(requiz);
    await sleep(500);
    rec.check(!has(editor.document.getText(), SNIPPET), "closing that quiz removes it again", short(editor.document.getText()));
  }
  await idleAndUnlocked(rec, editor.document);
};

const pasteUndoRedoAfterPass: Step = async ({ rec }) => {
  const editor = await openEditor("src/a.js", ORIGINAL);
  const { panel, cmd } = await startPaste(editor);
  submit(panel, GOOD_ANSWER);
  await settle(cmd, rec, "paste");
  rec.check(has(editor.document.getText(), SNIPPET), "pass keeps the paste", short(editor.document.getText()));
  await sleep(1200);
  await focusDoc(editor.document);
  await vscode.commands.executeCommand("undo");
  await sleep(500);
  rec.note("after undo: " + short(editor.document.getText()));
  const before = panels.length;
  await vscode.commands.executeCommand("redo");
  const requiz = await maybeWait(() => panels.length > before && panels[panels.length - 1], 3000);
  rec.note("after redo: " + short(editor.document.getText()));
  rec.check(!requiz, "(cosmetic) redo of an already-passed paste does not raise a second quiz", requiz ? "a second quiz opened for code already passed" : "no quiz");
  if (requiz) {
    send(requiz, { type: "bypass" });
    await sleep(500);
  }
  await idleAndUnlocked(rec, editor.document);
};

const pasteUntitledClose: Step = async ({ rec }) => {
  const doc = await vscode.workspace.openTextDocument({ language: "javascript", content: ORIGINAL });
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  const end = doc.lineAt(doc.lineCount - 1).range.end;
  editor.selection = new vscode.Selection(end, end);
  const { panel, cmd } = await startPaste(editor);
  rec.check(await isLocked(doc), "untitled document is locked while the quiz is open", "");
  await closeQuizTab(panel);
  await settle(cmd, rec, "paste");
  rec.check(doc.getText() === ORIGINAL, "closing removes the paste from the untitled document", short(doc.getText()));
  await idleAndUnlocked(rec, doc);
};

const pasteSwitchFileInlineBypass: Step = async ({ rec }) => {
  const a = await openEditor("src/a.js", ORIGINAL);
  const { panel, cmd } = await startPaste(a);
  const b = await openEditor("src/b.js", ORIGINAL);
  rec.note("switching to another file while locked: active editor is now " + path.basename(vscode.window.activeTextEditor?.document.uri.fsPath ?? "?"));
  const before = panels.length;
  const other = SNIPPET.replace("summarize", "otherFile");
  await b.edit((e) => e.insert(b.document.lineAt(b.document.lineCount - 1).range.end, other));
  await sleep(2500);
  const quizzed = panels.length > before;
  rec.check(
    quizzed || !has(b.document.getText(), other),
    "a large insertion into another file while a quiz is open is blocked or quizzed",
    quizzed ? "quizzed" : has(b.document.getText(), other) ? "inserted with NO quiz" : "blocked",
  );
  await closeQuizTab(panel);
  await settle(cmd, rec, "paste");
  rec.check(a.document.getText() === ORIGINAL, "closing removes the first paste", short(a.document.getText()));
  rec.note("other file after both: " + (has(b.document.getText(), other) ? "still contains the unquizzed block" : "clean"));
  await idleAndUnlocked(rec, a.document);
};

const pasteFileDeletedOnDisk: Step = async ({ rec }) => {
  const editor = await openEditor("src/a.js", ORIGINAL);
  const { panel, cmd } = await startPaste(editor);
  fs.unlinkSync(wsPath("src/a.js"));
  await sleep(1500);
  rec.note("file deleted on disk; document closed=" + editor.document.isClosed + " dirty=" + editor.document.isDirty);
  await closeQuizTab(panel);
  await settle(cmd, rec, "paste");
  noteUnhandled(rec);
  rec.check(editor.document.getText() === ORIGINAL, "closing removes the paste from the buffer", short(editor.document.getText()));
  rec.check(readDisk("src/a.js") === undefined, "the guard does not recreate the deleted file", short(readDisk("src/a.js")));
  await idleAndUnlocked(rec, editor.document);
};

const pasteFileRenamed: Step = async ({ rec }) => {
  const editor = await openEditor("src/a.js", ORIGINAL);
  const { panel, cmd } = await startPaste(editor);
  const rename = new vscode.WorkspaceEdit();
  const target = vscode.Uri.file(wsPath("src/renamed.js"));
  rename.renameFile(editor.document.uri, target);
  const ok = await vscode.workspace.applyEdit(rename);
  await sleep(1000);
  const moved = docFor("src/renamed.js");
  rec.note(`renamed while locked (applyEdit=${ok}); old doc closed=${editor.document.isClosed}; new doc open=${!!moved}`);
  if (moved) {
    rec.check(await isLocked(moved), "the renamed file is still locked while the quiz is open", "");
  }
  await closeQuizTab(panel);
  await settle(cmd, rec, "paste");
  noteUnhandled(rec);
  const after = docFor("src/renamed.js");
  const text = after?.getText() ?? readDisk("src/renamed.js");
  rec.check(!has(text, SNIPPET), "closing removes the paste from the renamed file", has(text, SNIPPET) ? "pasted code STILL in renamed file: " + short(text) : "removed");
  await idleAndUnlocked(rec, after);
};

const pasteBypassCommand: Step = async ({ rec }) => {
  const editor = await openEditor("src/a.js", ORIGINAL);
  const { panel, cmd } = await startPaste(editor);
  await vscode.commands.executeCommand("comprehensionGuard.bypassNext");
  await settle(cmd, rec, "paste");
  rec.check(panel.disposed, "bypass command closes the open quiz", panel.disposed ? "closed" : "still open");
  rec.check(has(editor.document.getText(), SNIPPET), "bypass keeps the paste", short(editor.document.getText()));
  await idleAndUnlocked(rec, editor.document);
};

const pasteSlowGeneration: Step = async ({ rec }) => {
  await useLlm();
  llm.holdGenerate = true;
  const editor = await openEditor("src/a.js", ORIGINAL);
  await setClipboard(SNIPPET);
  await focusDoc(editor.document);
  const before = panels.length;
  const cmd = track(vscode.commands.executeCommand("comprehensionGuard.paste"));
  const gen = await waitForHeld("generate");
  await sleep(1000);
  const locked = await isLocked(editor.document);
  rec.check(
    !locked || quizTabs().length > 0,
    "while the question is being generated the user has something to close or cancel",
    `file locked=${locked}, quiz tabs=${quizTabs().length} (the LLM call can take up to 3 x 60s with retries)`,
  );
  await vscode.commands.executeCommand("comprehensionGuard.bypassNext");
  await sleep(300);
  llm.holdGenerate = false;
  gen.release(QUESTION_JSON);
  const panel = await maybeWait(() => panels.length > before && panels[panels.length - 1], 5000);
  rec.check(!panel || panel.disposed, "after Bypass during generation (status bar says 'quiz bypassed'), no quiz opens anyway", panel && !panel.disposed ? "a quiz opened anyway" : "no quiz");
  if (panel && !panel.disposed) {
    await closeQuizTab(panel);
  }
  await settle(cmd, rec, "paste");
  rec.note("after closing that quiz the paste was " + (has(editor.document.getText(), SNIPPET) ? "KEPT (closing normally removes it)" : "removed"));  await idleAndUnlocked(rec, editor.document);
};

const pasteReloadPhase1: Step = async (ctx) => {
  const editor = await openEditor("src/a.js", ORIGINAL);
  await startPaste(editor);
  await sleep(2500); // give hot-exit backup time to capture the dirty buffer
  ctx.rec.note("quiz open, buffer dirty=" + editor.document.isDirty + "; reloading window");
  ctx.rec.note("hot-exit backups holding the unanswered paste: " + JSON.stringify(backupsContain(SNIPPET.split("\n")[1])));
  await ctx.reload();
};

const pasteCrashPhase1: Step = async (ctx) => {
  const editor = await openEditor("src/a.js", ORIGINAL);
  await startPaste(editor);
  await sleep(2500);
  ctx.rec.note("quiz open, buffer dirty=" + editor.document.isDirty + "; killing extension host");
  ctx.rec.note("hot-exit backups holding the unanswered paste: " + JSON.stringify(backupsContain(SNIPPET.split("\n")[1])));
  await ctx.crash();
};

const pasteAfterRestart: Step = async ({ rec }) => {
  await sleep(2000);
  const restored = await maybeWait(() => docFor("src/a.js"), 5000);
  const doc = restored ?? (await vscode.workspace.openTextDocument(vscode.Uri.file(wsPath("src/a.js"))));
  rec.note(`after restart: editor restored=${!!restored}, dirty=${doc.isDirty}`);
  rec.note("hot-exit backups holding the paste after restart: " + JSON.stringify(backupsContain(SNIPPET.split("\n")[1])));
  const disk = readDisk("src/a.js");
  rec.check(!has(disk, SNIPPET), "unanswered paste was never written to disk", has(disk, SNIPPET) ? "on disk" : "not on disk");
  const text = doc.getText();
  rec.check(
    !has(text, SNIPPET) || quizTabs().length > 0 || openPanels().length > 0,
    "after restart the unanswered paste is not left in the buffer without a quiz",
    has(text, SNIPPET) ? "buffer still holds the paste (hot-exit restore), no quiz" : "buffer clean",
  );
  rec.check(quizTabs().length === 0, "(info) no orphan quiz tab restored", quizTabs().length + " quiz tabs");
  await idleAndUnlocked(rec, doc);
};

// ---------------------------------------------------------------------------
// Inline

const inlineCloseMidQuestion: Step = async ({ rec }) => {
  const editor = await openEditor("src/a.js", ORIGINAL);
  const panel = await startInline(editor);
  rec.check(has(editor.document.getText(), SNIPPET), "inserted code is visible while the quiz is open", short(editor.document.getText()));
  rec.check(await isLocked(editor.document), "file is locked while the quiz is open", "");
  await closeQuizTab(panel);
  await sleep(800);
  rec.check(editor.document.getText() === ORIGINAL, "closing removes the insertion", short(editor.document.getText()));
  await idleAndUnlocked(rec, editor.document);
};

const inlineCloseMidGradingPass: Step = async ({ rec }) => {
  await useLlm();
  llm.holdJudge = true;
  const editor = await openEditor("src/a.js", ORIGINAL);
  const panel = await startInline(editor);
  submit(panel, GOOD_ANSWER);
  const judgeCall = await waitForHeld("judge");
  await closeQuizTab(panel);
  await sleep(300);
  judgeCall.release(judgeJson("pass"));
  await sleep(1500);
  const text = editor.document.getText();
  rec.check(text === ORIGINAL, "closing the quiz tab mid-grading removes the insertion (grade=pass)", text === ORIGINAL ? "removed" : "code KEPT: " + short(text));
  await idleAndUnlocked(rec, editor.document);
};

const inlineCloseEditorThenFail: Step = async ({ rec }) => {
  const editor = await openEditor("src/a.js", ORIGINAL);
  const doc = editor.document;
  const panel = await startInline(editor);
  await doc.save();
  const closed = await closeEditorTab(doc.uri);
  rec.note("saved, then closed the editor tab: " + closed);
  await sleep(300);
  await closeQuizTab(panel);
  await sleep(1500);
  noteUnhandled(rec);
  const disk = readDisk("src/a.js");
  rec.check(!has(disk, SNIPPET), "closing the quiz removes the insertion even though its editor tab was closed", has(disk, SNIPPET) ? "inserted code STILL on disk" : "removed");
  const reopened = await vscode.workspace.openTextDocument(vscode.Uri.file(wsPath("src/a.js")));
  await idleAndUnlocked(rec, reopened);
};

const inlineUndoAfterFail: Step = async ({ rec }) => {
  const editor = await openEditor("src/a.js", ORIGINAL);
  const panel = await startInline(editor);
  await closeQuizTab(panel);
  await sleep(800);
  rec.check(editor.document.getText() === ORIGINAL, "closing removes the insertion", short(editor.document.getText()));
  await sleep(1200);
  await focusDoc(editor.document);
  const before = panels.length;
  await vscode.commands.executeCommand("undo");
  const requiz = await maybeWait(() => panels.length > before && panels[panels.length - 1], 3000);
  if (has(editor.document.getText(), SNIPPET)) {
    rec.check(!!requiz, "undo that brings the removed insertion back raises a quiz", requiz ? "quiz opened" : "code back WITHOUT a quiz");
  } else {
    rec.note("undo did not bring the insertion back: " + short(editor.document.getText()));
  }
  if (requiz) {
    await closeQuizTab(requiz);
    await sleep(800);
  }
  await idleAndUnlocked(rec, editor.document);
};

const inlineUntitledClose: Step = async ({ rec }) => {
  const doc = await vscode.workspace.openTextDocument({ language: "javascript", content: ORIGINAL });
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  const panel = await startInline(editor);
  await closeQuizTab(panel);
  await sleep(800);
  rec.check(doc.getText() === ORIGINAL, "closing removes the insertion from the untitled document", short(doc.getText()));
  await idleAndUnlocked(rec, doc);
};

// ---------------------------------------------------------------------------
// Agent

const agentCloseMidQuestion: Step = async ({ rec }) => {
  const panel = await startAgent("src/agent.js", false);
  rec.check(readDisk("src/agent.js") === AGENT_BEFORE, "agent code is held out of the file on disk while the quiz is open", short(readDisk("src/agent.js")));
  const doc = docFor("src/agent.js");
  rec.check(!!doc && doc.getText() === AGENT_BEFORE, "editor shows the file without the agent code", short(doc?.getText()));
  if (doc) {
    rec.check(await isLocked(doc), "file is locked while the quiz is open", "");
  }
  await closeQuizTab(panel);
  await sleep(1000);
  rec.check(readDisk("src/agent.js") === AGENT_BEFORE, "closing leaves the file without the agent code", short(readDisk("src/agent.js")));
  await idleAndUnlocked(rec, docFor("src/agent.js"));
};

const agentPass: Step = async ({ rec }) => {
  const panel = await startAgent("src/agent.js", false);
  submit(panel, GOOD_ANSWER);
  await waitFor(() => has(readDisk("src/agent.js"), AGENT_MARKER), 5000, "agent code written").catch(() => undefined);
  rec.check(has(readDisk("src/agent.js"), AGENT_MARKER), "pass writes the agent code into the file", short(readDisk("src/agent.js")));
  const doc = docFor("src/agent.js");
  await maybeWait(() => doc && !doc.isDirty, 3000);
  rec.check(!!doc && has(doc.getText(), AGENT_MARKER) && !doc.isDirty, "editor shows the agent code and is not dirty", `has code=${has(doc?.getText(), AGENT_MARKER)} dirty=${doc?.isDirty}`);
  await idleAndUnlocked(rec, doc);
};

const agentCloseMidGradingPass: Step = async ({ rec }) => {
  await useLlm();
  llm.holdJudge = true;
  const panel = await startAgent("src/agent.js", false);
  submit(panel, GOOD_ANSWER);
  const judgeCall = await waitForHeld("judge");
  await closeQuizTab(panel);
  await sleep(300);
  judgeCall.release(judgeJson("pass"));
  await sleep(1500);
  const disk = readDisk("src/agent.js");
  rec.check(!has(disk, AGENT_MARKER), "closing the quiz tab mid-grading leaves the file without the agent code (grade=pass)", has(disk, AGENT_MARKER) ? "agent code WRITTEN after the tab was closed" : "held out");
  await idleAndUnlocked(rec, docFor("src/agent.js"));
};

const agentCloseEditorThenPass: Step = async ({ rec }) => {
  const panel = await startAgent("src/agent.js", false);
  const closed = await closeEditorTab(vscode.Uri.file(wsPath("src/agent.js")));
  rec.note("closed the locked file's editor tab: " + closed);
  await sleep(500);
  submit(panel, GOOD_ANSWER);
  await sleep(1500);
  rec.check(has(readDisk("src/agent.js"), AGENT_MARKER), "pass still writes the agent code after the editor tab was closed", short(readDisk("src/agent.js")));
  noteUnhandled(rec);
  await idleAndUnlocked(rec, docFor("src/agent.js"));
};

const agentBypassCommand: Step = async ({ rec }) => {
  const panel = await startAgent("src/agent.js", false);
  await vscode.commands.executeCommand("comprehensionGuard.bypassNext");
  await sleep(1500);
  rec.check(panel.disposed, "'Bypass Next Insertion' bypasses the open agent quiz", panel.disposed ? "quiz closed" : "quiz STILL open (command armed a bypass for the next insertion instead)");
  if (!panel.disposed) {
    await closeQuizTab(panel);
    await sleep(1000);
  } else {
    rec.check(has(readDisk("src/agent.js"), AGENT_MARKER), "bypass keeps the agent code", short(readDisk("src/agent.js")));
  }
  await idleAndUnlocked(rec, docFor("src/agent.js"));
};

const agentPasteWhileOpen: Step = async ({ rec }) => {
  const panel = await startAgent("src/agent.js", false);
  const b = await openEditor("src/b.js", ORIGINAL);
  await setClipboard(SNIPPET);
  const before = panels.length;
  await vscode.commands.executeCommand("comprehensionGuard.paste");
  await sleep(500);
  rec.check(b.document.getText() === ORIGINAL && panels.length === before, "a guarded paste while an agent quiz is open is refused", short(b.document.getText()));
  const other = SNIPPET.replace("summarize", "inlineDuringAgent");
  await b.edit((e) => e.insert(b.document.lineAt(b.document.lineCount - 1).range.end, other));
  await sleep(2500);
  const quizzed = panels.length > before;
  rec.check(
    quizzed || !has(b.document.getText(), other),
    "a large inline insertion while an agent quiz is open is blocked or quizzed",
    quizzed ? "quizzed" : has(b.document.getText(), other) ? "inserted with NO quiz" : "blocked",
  );
  await closeQuizTab(panel);
  await sleep(1500);
  rec.check(readDisk("src/agent.js") === AGENT_BEFORE, "closing the agent quiz leaves its file without the agent code", short(readDisk("src/agent.js")));
  const later = openPanels();
  rec.note("quizzes open after closing the agent quiz: " + later.length);
  for (const p of later) {
    await closeQuizTab(p);
  }
  await idleAndUnlocked(rec, b.document);
};

const agentTwoFiles: Step = async ({ rec }) => {
  await waitForEndpoint();
  for (const rel of ["src/one.js", "src/two.js"]) {
    fs.writeFileSync(wsPath(rel), AGENT_BEFORE);
  }
  const before = panels.length;
  await agentWrite("src/one.js", AGENT_NEW_BODY);
  await agentWrite("src/two.js", AGENT_NEW_BODY.replace("total", "total2"));
  const first = await waitForPanel(before, 15_000);
  await sleep(500);
  rec.check(readDisk("src/one.js") === AGENT_BEFORE, "file 1 held out while quiz 1 is open", short(readDisk("src/one.js")));
  rec.check(
    !has(readDisk("src/two.js"), AGENT_MARKER),
    "file 2's agent code is also held out while quiz 1 is open",
    has(readDisk("src/two.js"), AGENT_MARKER) ? "file 2 ALREADY contains the unquizzed agent code on disk" : "held out",
  );
  rec.check(openPanels().length === 1, "only one quiz at a time", openPanels().length + " open");
  await closeQuizTab(first);
  const second = await maybeWait(() => panels.length > before + 1 && panels[panels.length - 1], 10_000);
  rec.check(!!second, "a second quiz opens for file 2", second ? "opened" : "no second quiz");
  if (second) {
    await sleep(500);
    rec.check(readDisk("src/two.js") === AGENT_BEFORE, "file 2 held out once its quiz is open", short(readDisk("src/two.js")));
    await closeQuizTab(second);
    await sleep(1000);
  }
  rec.check(readDisk("src/one.js") === AGENT_BEFORE && readDisk("src/two.js") === AGENT_BEFORE, "both files end without agent code after both quizzes are closed", short(readDisk("src/one.js")) + " | " + short(readDisk("src/two.js")));
  await idleAndUnlocked(rec, docFor("src/two.js"));
};

const agentTwoFilesCrash: Step = async (ctx) => {
  await waitForEndpoint();
  for (const rel of ["src/one.js", "src/two.js"]) {
    fs.writeFileSync(wsPath(rel), AGENT_BEFORE);
  }
  const before = panels.length;
  await agentWrite("src/one.js", AGENT_NEW_BODY);
  await agentWrite("src/two.js", AGENT_NEW_BODY.replace("total", "total2"));
  await waitForPanel(before, 15_000);
  await sleep(500);
  ctx.rec.note(`while quiz 1 open: one.js=${short(readDisk("src/one.js"))} two.js=${short(readDisk("src/two.js"))}`);
  await ctx.crash();
};

const agentTwoFilesAfterCrash: Step = async ({ rec }) => {
  await sleep(5000);
  const one = readDisk("src/one.js");
  const two = readDisk("src/two.js");
  const requizzed = panels.length > 0 || quizTabs().length > 0;
  rec.check(
    has(one, AGENT_MARKER) || requizzed || guardHomeContains(AGENT_MARKER).length > 0,
    "file 1's held agent edit survives the crash (re-offered or recoverable)",
    has(one, AGENT_MARKER) ? "in file" : requizzed ? "re-quizzed" : "LOST",
  );
  rec.check(
    !has(two, AGENT_MARKER) || requizzed,
    "file 2's agent code does not end up in the file without ever being quizzed",
    has(two, AGENT_MARKER) ? "file 2 KEEPS the agent code, never quizzed" : "not in file",
  );
  for (const p of openPanels()) {
    await closeQuizTab(p);
  }
};

const agentDirtyBuffer: Step = async ({ rec }) => {
  await waitForEndpoint();
  const editor = await openEditor("src/agent.js", AGENT_BEFORE);
  await editor.edit((b) => b.insert(new vscode.Position(0, 0), "// unsaved user note\n"));
  await sleep(300);
  // Focus some other file so the agent's disk write is not treated as typing in the focused editor.
  await openEditor("src/b.js", ORIGINAL);
  const before = panels.length;
  await agentWrite("src/agent.js", AGENT_NEW_BODY);
  const panel = await waitForPanel(before, 15_000);
  const doc = editor.document;
  rec.note(`during quiz: disk=${short(readDisk("src/agent.js"))} buffer=${short(doc.getText())} dirty=${doc.isDirty}`);
  submit(panel, GOOD_ANSWER);
  await sleep(1500);
  const disk = readDisk("src/agent.js");
  rec.check(has(disk, AGENT_MARKER), "pass writes the agent code to disk", short(disk));
  rec.check(doc.getText().includes("// unsaved user note"), "the user's unsaved edit is not lost", short(doc.getText()));
  // Not counted as a bug: VS Code is in the same "file on disk is newer" state
  // without the extension whenever an agent writes a file with unsaved edits.
  rec.note(
    `after pass: buffer has agent code=${has(doc.getText(), AGENT_MARKER)}, dirty=${doc.isDirty}; ` +
      "saving now hits VS Code's 'file is newer' conflict (Overwrite would drop the agent code)",
  );
};

const agentFileDeletedThenPass: Step = async ({ rec }) => {
  const panel = await startAgent("src/agent.js", false);
  fs.unlinkSync(wsPath("src/agent.js"));
  await sleep(1500);
  submit(panel, GOOD_ANSWER);
  await sleep(2000);
  noteUnhandled(rec);
  const disk = readDisk("src/agent.js");
  rec.note("file deleted during quiz, then passed; disk now: " + short(disk));
  rec.check(true, "(info) no crash", "ok");
  await idleAndUnlocked(rec, undefined);
};

const agentUndoAfterFail: Step = async ({ rec }) => {
  await waitForEndpoint();
  // File open in an editor, but another file is focused (so the agent path, not the inline path, takes the edit).
  await openEditor("src/agent.js", AGENT_BEFORE);
  await openEditor("src/b.js", ORIGINAL);
  await sleep(300);
  const first = panels.length;
  await agentWrite("src/agent.js", AGENT_NEW_BODY);
  const panel = await waitForPanel(first, 15_000);
  await closeQuizTab(panel);
  await sleep(1500);
  const doc = docFor("src/agent.js")!;
  rec.check(readDisk("src/agent.js") === AGENT_BEFORE, "closing leaves the file without the agent code", short(readDisk("src/agent.js")));
  await focusDoc(doc);
  const before = panels.length;
  await vscode.commands.executeCommand("undo");
  const requiz = await maybeWait(() => panels.length > before && panels[panels.length - 1], 3000);
  if (has(doc.getText(), AGENT_MARKER)) {
    rec.check(!!requiz, "undo that brings the agent code back raises a quiz", requiz ? "quiz opened" : "agent code back WITHOUT a quiz");
  } else {
    rec.note("undo did not bring the agent code back: " + short(doc.getText()));
  }
  if (requiz) {
    await closeQuizTab(requiz);
    await sleep(800);
  }
  await idleAndUnlocked(rec, doc);
};

const agentEditActiveEditor: Step = async ({ rec }) => {
  const panel = await startAgent("src/agent.js", true);
  rec.note("quiz source: " + (panel.html.includes(AGENT_MARKER) ? "shows agent code" : "unknown"));
  await sleep(500);
  rec.check(!has(readDisk("src/agent.js"), AGENT_MARKER), "agent code held out of the disk file while the quiz is open", short(readDisk("src/agent.js")));
  await closeQuizTab(panel);
  await sleep(1500);
  const doc = docFor("src/agent.js");
  rec.check(!has(readDisk("src/agent.js"), AGENT_MARKER), "closing leaves the file on disk without the agent code", short(readDisk("src/agent.js")));
  rec.check(!!doc && !has(doc.getText(), AGENT_MARKER), "closing leaves the editor without the agent code", short(doc?.getText()));
  await idleAndUnlocked(rec, doc);
};

async function agentPhase1(ctx: Ctx, how: "reload" | "crash"): Promise<void> {
  await startAgent("src/agent.js", false);
  await sleep(500);
  ctx.rec.check(readDisk("src/agent.js") === AGENT_BEFORE, "agent code held out while the quiz is open", short(readDisk("src/agent.js")));
  ctx.rec.note("held code saved anywhere under guard home before " + how + ": " + JSON.stringify(guardHomeContains(AGENT_MARKER)));
  if (how === "reload") {
    await ctx.reload();
  }
  await ctx.crash();
}

const agentAfterRestart: Step = async ({ rec }) => {
  await sleep(5000); // inbox poll is 800ms; give any replay time to show up
  const disk = readDisk("src/agent.js") ?? readDisk("src/inbox.js");
  rec.note("after restart, file on disk: " + short(disk));
  rec.note("inbox entries after restart: " + inboxFiles().length);
  const replayed = panels.length > 0 || quizTabs().length > 0;
  rec.note("quiz re-raised after restart: " + replayed);
  const stored = guardHomeContains(AGENT_MARKER);
  rec.check(
    has(disk, AGENT_MARKER) || replayed || stored.length > 0,
    "the held agent edit survives the restart (re-offered, or kept somewhere recoverable)",
    has(disk, AGENT_MARKER)
      ? "in file"
      : replayed
        ? "quiz re-raised"
        : "LOST: not in the file, not re-quizzed, no copy under guard home; the agent was told the write succeeded",
  );
  for (const p of openPanels()) {
    await closeQuizTab(p);
  }
  await idleAndUnlocked(rec, docFor("src/agent.js"));
};

const inboxCrashPhase1: Step = async (ctx) => {
  // The orchestrator left an event in the inbox before VS Code started.
  const tab = await maybeWait(() => quizTabs()[0], 15_000);
  ctx.rec.check(!!tab, "event left in the inbox raises a quiz at startup", tab ? "quiz opened" : "no quiz");
  await sleep(500);
  ctx.rec.check(readDisk("src/inbox.js") === AGENT_BEFORE, "agent code held out while that quiz is open", short(readDisk("src/inbox.js")));
  ctx.rec.note("inbox entries while quiz open: " + inboxFiles().length);
  await ctx.crash();
};

// ---------------------------------------------------------------------------

export const SCENARIO_IMPLS: Record<string, Step[]> = {
  "paste-close-mid-question": [pasteCloseMidQuestion],
  "paste-close-mid-grading-pass": [pasteCloseMidGrading("pass")],
  "paste-close-mid-grading-fail": [pasteCloseMidGrading("fail")],
  "paste-close-during-followup": [pasteCloseDuringFollowup],
  "paste-save-then-close-quiz": [pasteSaveThenCloseQuiz],
  "paste-close-editor-then-fail": [pasteCloseEditor("fail")],
  "paste-close-editor-then-pass": [pasteCloseEditor("pass")],
  "paste-undo-while-locked": [pasteUndoWhileLocked],
  "paste-undo-redo-after-fail": [pasteUndoRedoAfterFail],
  "paste-undo-redo-after-pass": [pasteUndoRedoAfterPass],
  "paste-untitled-close": [pasteUntitledClose],
  "paste-switch-file-inline-bypass": [pasteSwitchFileInlineBypass],
  "paste-file-deleted-on-disk": [pasteFileDeletedOnDisk],
  "paste-file-renamed": [pasteFileRenamed],
  "paste-bypass-command": [pasteBypassCommand],
  "paste-slow-generation": [pasteSlowGeneration],
  "paste-reload-window": [pasteReloadPhase1, pasteAfterRestart],
  "paste-crash": [pasteCrashPhase1, pasteAfterRestart],

  "inline-close-mid-question": [inlineCloseMidQuestion],
  "inline-close-mid-grading-pass": [inlineCloseMidGradingPass],
  "inline-close-editor-then-fail": [inlineCloseEditorThenFail],
  "inline-undo-after-fail": [inlineUndoAfterFail],
  "inline-untitled-close": [inlineUntitledClose],

  "agent-close-mid-question": [agentCloseMidQuestion],
  "agent-pass": [agentPass],
  "agent-close-mid-grading-pass": [agentCloseMidGradingPass],
  "agent-close-editor-then-pass": [agentCloseEditorThenPass],
  "agent-bypass-command": [agentBypassCommand],
  "agent-paste-while-open": [agentPasteWhileOpen],
  "agent-two-files": [agentTwoFiles],
  "agent-dirty-buffer": [agentDirtyBuffer],
  "agent-two-files-crash": [agentTwoFilesCrash, agentTwoFilesAfterCrash],
  "agent-file-deleted-then-pass": [agentFileDeletedThenPass],
  "agent-undo-after-fail": [agentUndoAfterFail],
  "agent-edit-active-editor": [agentEditActiveEditor],
  "agent-reload-window": [(ctx) => agentPhase1(ctx, "reload"), agentAfterRestart],
  "agent-crash": [(ctx) => agentPhase1(ctx, "crash"), agentAfterRestart],
  "agent-inbox-replay-crash": [inboxCrashPhase1, agentAfterRestart],
};

// Silence unused-import lint for helpers kept for future scenarios.
void env;
