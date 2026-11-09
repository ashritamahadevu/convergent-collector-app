import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { claudeWritePayloads, runNotify } from "../hookSim";

/**
 * Helpers that run inside the extension host next to the extension under test.
 *
 * The test file lives inside the extension folder, so `require("vscode")`
 * returns the same API object the extension uses. That lets us wrap
 * `window.createWebviewPanel` and post messages to the quiz the same way the
 * webview script would, and close the quiz tab through the tabs API like a user.
 */

export const EXT_ID = "comprehension-guard.comprehension-guard";
export const env = {
  root: process.env.CG_ROOT ?? "",
  workspace: process.env.CG_WORKSPACE ?? "",
  repo: process.env.CG_REPO ?? "",
  guardHome: process.env.COMPREHENSION_GUARD_HOME ?? "",
};

export const SNIPPET = [
  "function summarize(orders) {",
  "  const byCustomer = new Map();",
  "  for (const order of orders) {",
  "    const prev = byCustomer.get(order.customer) ?? 0;",
  "    byCustomer.set(order.customer, prev + order.amount);",
  "  }",
  "  return [...byCustomer.entries()].sort((a, b) => b[1] - a[1]);",
  "}",
  "",
].join("\n");

export const GOOD_ANSWER =
  "It totals each customer's order amounts in a map and returns the customers sorted by total, largest first.";

// ---------------------------------------------------------------------------
// Results

export type Check = { ok: boolean; expectation: string; observed: string };

export class Recorder {
  checks: Check[] = [];
  notes: string[] = [];
  error?: string;
  untested?: string;
  constructor(public scenario: string, public phase: number) {}

  check(ok: boolean, expectation: string, observed: string): boolean {
    this.checks.push({ ok, expectation, observed });
    return ok;
  }

  note(text: string): void {
    this.notes.push(text);
  }

  file(): string {
    return path.join(env.root, `result-${this.phase}.json`);
  }

  flush(): void {
    fs.writeFileSync(
      this.file(),
      JSON.stringify(
        {
          scenario: this.scenario,
          phase: this.phase,
          checks: this.checks,
          notes: this.notes,
          error: this.error,
          untested: this.untested,
        },
        null,
        2,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Timing

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor<T>(
  fn: () => T | undefined | false | Promise<T | undefined | false>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const value = await fn();
    if (value) {
      return value as T;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for " + label);
    }
    await sleep(50);
  }
}

export async function maybeWait<T>(
  fn: () => T | undefined | false | Promise<T | undefined | false>,
  timeoutMs: number,
): Promise<T | undefined> {
  try {
    return await waitFor(fn, timeoutMs, "optional");
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Quiz webview spy

export type PanelRec = {
  index: number;
  panel: vscode.WebviewPanel;
  listeners: ((message: unknown) => void)[];
  posted: { type?: string; message?: string }[];
  html: string;
  disposed: boolean;
};

export const panels: PanelRec[] = [];

export function installWebviewSpy(): void {
  const win = vscode.window as unknown as Record<string, unknown>;
  if (win.__cgSpy) {
    return;
  }
  const original = (vscode.window.createWebviewPanel as (...a: unknown[]) => vscode.WebviewPanel).bind(vscode.window);
  win.createWebviewPanel = (...args: unknown[]): vscode.WebviewPanel => {
    const panel = original(...args);
    if (args[0] !== "comprehensionGuard.quiz") {
      return panel;
    }
    const rec: PanelRec = { index: panels.length, panel, listeners: [], posted: [], html: "", disposed: false };
    panel.onDidDispose(() => {
      rec.disposed = true;
    });
    const realWebview = panel.webview;
    const webviewProxy = new Proxy(realWebview, {
      get(target, prop) {
        if (prop === "onDidReceiveMessage") {
          return (listener: (m: unknown) => void, thisArg?: unknown, disposables?: vscode.Disposable[]) => {
            rec.listeners.push(thisArg ? listener.bind(thisArg) : listener);
            return target.onDidReceiveMessage(listener, thisArg, disposables);
          };
        }
        if (prop === "postMessage") {
          return (message: { type?: string; message?: string }) => {
            rec.posted.push(message);
            return target.postMessage(message);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set(target, prop, value) {
        if (prop === "html") {
          rec.html = String(value);
        }
        return Reflect.set(target, prop, value, target);
      },
    });
    const panelProxy = new Proxy(panel, {
      get(target, prop) {
        if (prop === "webview") {
          return webviewProxy;
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set(target, prop, value) {
        return Reflect.set(target, prop, value, target);
      },
    });
    panels.push(rec);
    return panelProxy;
  };
  win.__cgSpy = true;
}

export function openPanels(): PanelRec[] {
  return panels.filter((p) => !p.disposed);
}

export async function waitForPanel(after: number, timeoutMs = 10_000): Promise<PanelRec> {
  return waitFor(() => panels.length > after && panels[panels.length - 1], timeoutMs, "quiz panel #" + (after + 1));
}

/** Sends a message to the extension as if the webview script posted it. */
export function send(rec: PanelRec, message: Record<string, unknown>): void {
  for (const listener of rec.listeners) {
    listener(message);
  }
}

export function submit(rec: PanelRec, answer: string): void {
  send(rec, { type: "submit", answer });
}

/** Closes the quiz tab the way a user clicking the tab's X would. */
export async function closeQuizTab(rec: PanelRec): Promise<void> {
  const tab = quizTabs()[0];
  if (tab) {
    await vscode.window.tabGroups.close(tab);
  } else {
    rec.panel.dispose();
  }
  await waitFor(() => rec.disposed, 5000, "quiz panel disposed");
}

export function quizTabs(): vscode.Tab[] {
  const out: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes("comprehensionGuard.quiz")) {
        out.push(tab);
      }
    }
  }
  return out;
}

export async function closeEditorTab(uri: vscode.Uri): Promise<boolean> {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()) {
        return vscode.window.tabGroups.close(tab);
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Clipboard (never touches the real system clipboard)

let fakeClipboard = "";
let clipboardMocked = false;
let realClipboardSaved: string | undefined;

/**
 * The clipboard object is frozen, so replace the `env.clipboard` getter with
 * a fake. If that is not possible either, fall back to the real clipboard and
 * restore its previous text when the scenario ends.
 */
export function installClipboardMock(): string {
  const fake = {
    readText: async () => fakeClipboard,
    writeText: async (value: string) => {
      fakeClipboard = value;
    },
  };
  try {
    Object.defineProperty(vscode.env, "clipboard", { get: () => fake, configurable: true });
    clipboardMocked = vscode.env.clipboard === (fake as unknown);
  } catch {
    clipboardMocked = false;
  }
  return clipboardMocked ? "mocked env.clipboard" : "using the real clipboard (restored afterwards)";
}

export async function setClipboard(text: string): Promise<void> {
  fakeClipboard = text;
  if (!clipboardMocked) {
    if (realClipboardSaved === undefined) {
      realClipboardSaved = await vscode.env.clipboard.readText();
    }
    await vscode.env.clipboard.writeText(text);
  }
}

export async function restoreClipboard(): Promise<void> {
  if (!clipboardMocked && realClipboardSaved !== undefined) {
    await vscode.env.clipboard.writeText(realClipboardSaved);
  }
}

// ---------------------------------------------------------------------------
// LLM mock (provider=ollama, fetch patched in-process; nothing listens on 11434)

type HeldCall = { kind: "generate" | "judge"; release: (content: string) => void; settled: boolean };

export const llm = {
  calls: [] as { kind: "generate" | "judge"; at: number }[],
  holdGenerate: false,
  holdJudge: false,
  judgeVerdict: "pass" as "pass" | "fail",
  held: [] as HeldCall[],
};

export const QUESTION_JSON = JSON.stringify({
  kind: "free-text",
  question: "What does summarize return for a list of orders?",
  referenceAnswer: "Customers with their summed order amounts, sorted from the largest total to the smallest.",
  criteria: [
    { id: "c1", text: "Says amounts are summed per customer", critical: true },
    { id: "c2", text: "Says the result is sorted by total in descending order", critical: false },
  ],
  conceptTags: ["data-structures"],
});

export function judgeJson(verdict: "pass" | "fail"): string {
  return JSON.stringify({
    criteria: [
      { id: "c1", analysis: "checked", verdict, evidence: verdict === "pass" ? "totals each customer" : "NONE" },
      { id: "c2", analysis: "checked", verdict, evidence: verdict === "pass" ? "largest first" : "NONE" },
    ],
    misconception: verdict === "pass" ? "" : "Thinks it filters orders.",
  });
}

export function installFetchMock(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g.__cgFetch) {
    return;
  }
  const realFetch = globalThis.fetch;
  g.fetch = async (input: unknown, init?: { body?: string; signal?: AbortSignal }) => {
    const url = typeof input === "string" ? input : String((input as { url?: string }).url ?? input);
    if (!url.startsWith("http://127.0.0.1:11434/")) {
      return realFetch(input as string, init as RequestInit);
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: { content?: string }[] };
    const prompt = body.messages?.[0]?.content ?? "";
    const kind: "generate" | "judge" = prompt.includes("<criteria>") ? "judge" : "generate";
    llm.calls.push({ kind, at: Date.now() });
    const respond = (content: string): Response =>
      new Response(JSON.stringify({ message: { content } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const immediate = kind === "generate" ? QUESTION_JSON : judgeJson(llm.judgeVerdict);
    const hold = kind === "generate" ? llm.holdGenerate : llm.holdJudge;
    if (!hold) {
      return respond(immediate);
    }
    return new Promise<Response>((resolve, reject) => {
      const call: HeldCall = {
        kind,
        settled: false,
        release: (content: string) => {
          if (!call.settled) {
            call.settled = true;
            resolve(respond(content));
          }
        },
      };
      init?.signal?.addEventListener("abort", () => {
        if (!call.settled) {
          call.settled = true;
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        }
      });
      llm.held.push(call);
    });
  };
  g.__cgFetch = true;
}

export async function useLlm(): Promise<void> {
  await vscode.workspace
    .getConfiguration("comprehensionGuard")
    .update("provider", "ollama", vscode.ConfigurationTarget.Global);
}

export async function waitForHeld(kind: "generate" | "judge"): Promise<HeldCall> {
  return waitFor(() => llm.held.find((c) => c.kind === kind && !c.settled), 10_000, "held " + kind + " call");
}

// ---------------------------------------------------------------------------
// Files and editors

export function wsPath(rel: string): string {
  return path.join(env.workspace, rel);
}

export function readDisk(rel: string): string | undefined {
  try {
    return fs.readFileSync(wsPath(rel), "utf8");
  } catch {
    return undefined;
  }
}

export async function openFile(rel: string, content: string, show = true): Promise<vscode.TextEditor | vscode.TextDocument> {
  const p = wsPath(rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p));
  if (!show) {
    return doc;
  }
  return vscode.window.showTextDocument(doc, { preview: false });
}

export async function openEditor(rel: string, content: string): Promise<vscode.TextEditor> {
  const editor = (await openFile(rel, content, true)) as vscode.TextEditor;
  const end = editor.document.lineAt(editor.document.lineCount - 1).range.end;
  editor.selection = new vscode.Selection(end, end);
  return editor;
}

export function docFor(rel: string): vscode.TextDocument | undefined {
  const want = path.resolve(wsPath(rel)).toLowerCase();
  return vscode.workspace.textDocuments.find(
    (d) => d.uri.scheme === "file" && path.resolve(d.uri.fsPath).toLowerCase() === want,
  );
}

export async function focusDoc(doc: vscode.TextDocument): Promise<vscode.TextEditor> {
  return vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
}

export function short(text: string | undefined): string {
  if (text === undefined) {
    return "<missing>";
  }
  const flat = text.replace(/\r?\n/g, "\\n");
  return flat.length > 90 ? flat.slice(0, 60) + "..." + `(${text.length} chars)` : flat;
}

export function has(text: string | undefined, needle: string): boolean {
  return text !== undefined && text.replace(/\r\n/g, "\n").includes(needle.replace(/\r\n/g, "\n").trim());
}

/**
 * True if an edit to the document is reverted by the guard's lock.
 * Leaves the document text as it found it.
 */
export async function isLocked(doc: vscode.TextDocument): Promise<boolean> {
  const before = doc.getText();
  const edit = new vscode.WorkspaceEdit();
  edit.insert(doc.uri, new vscode.Position(0, 0), "/*p*/");
  await vscode.workspace.applyEdit(edit);
  await sleep(700);
  const locked = doc.getText() === before;
  if (!locked && doc.getText().startsWith("/*p*/")) {
    const undo = new vscode.WorkspaceEdit();
    undo.delete(doc.uri, new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 5)));
    await vscode.workspace.applyEdit(undo);
  }
  return locked;
}

/**
 * True if a fresh large insertion in a scratch untitled document raises a
 * quiz, i.e. the guard is idle and not stuck. Closes that quiz again.
 */
export async function guardIsIdle(): Promise<boolean> {
  const doc = await vscode.workspace.openTextDocument({ language: "javascript", content: "" });
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  const before = panels.length;
  await editor.edit((b) => b.insert(new vscode.Position(0, 0), SNIPPET.replace("summarize", "probeIdle")));
  const panel = await maybeWait(() => panels.length > before && panels[panels.length - 1], 3000);
  if (panel) {
    await closeQuizTab(panel);
    await sleep(300);
  }
  return !!panel;
}

// ---------------------------------------------------------------------------
// Agent hook

export async function waitForEndpoint(): Promise<void> {
  await waitFor(
    () => fs.existsSync(path.join(env.guardHome, ".comprehension-guard", "endpoint.json")),
    10_000,
    "agent endpoint.json",
  );
}

/** Simulates Claude Code's PreToolUse -> Write -> PostToolUse through the real notifier. */
export async function agentWrite(rel: string, content: string): Promise<void> {
  const file = wsPath(rel);
  const payloads = claudeWritePayloads(file, content, env.workspace);
  await runNotify(env.repo, env.guardHome, payloads.pre);
  fs.writeFileSync(file, content);
  await runNotify(env.repo, env.guardHome, payloads.post);
}

export function inboxFiles(): string[] {
  try {
    return fs.readdirSync(path.join(env.guardHome, ".comprehension-guard", "inbox"));
  } catch {
    return [];
  }
}

/** Files in VS Code's hot-exit backup folder (throwaway profile) that contain `needle`. */
export function backupsContain(needle: string): string[] {
  return filesContaining(path.join(env.root, "user-data", "Backups"), needle);
}

/** Every file under the throwaway guard home, for "is the held code saved anywhere?" checks. */
export function guardHomeContains(needle: string): string[] {
  return filesContaining(env.guardHome, needle);
}

function filesContaining(rootDir: string, needle: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        try {
          if (fs.readFileSync(full, "utf8").replace(/\r\n/g, "\n").includes(needle)) {
            hits.push(path.relative(rootDir, full));
          }
        } catch {
          // ignore
        }
      }
    }
  };
  walk(rootDir);
  return hits;
}

/** Catches the guarded command's promise so a rejection is reported, not lost. */
export function track<T>(work: Thenable<T>): { settled: () => boolean; error: () => string | undefined; done: Promise<void> } {
  let isSettled = false;
  let err: string | undefined;
  const done = Promise.resolve(work).then(
    () => {
      isSettled = true;
    },
    (e: unknown) => {
      isSettled = true;
      err = e instanceof Error ? e.message : String(e);
    },
  );
  return { settled: () => isSettled, error: () => err, done };
}

/** Collects unhandled rejections raised in the extension host (e.g. from the inline guard's listener). */
export const unhandled: string[] = [];
export function installRejectionSpy(): void {
  process.on("unhandledRejection", (reason) => {
    unhandled.push(reason instanceof Error ? reason.message : String(reason));
  });
}
