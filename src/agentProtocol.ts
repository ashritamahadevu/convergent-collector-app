import * as crypto from "crypto";
import * as path from "path";

/**
 * Pure helpers for agent-edit detection. No VS Code imports, so the hook
 * payload parser, diff, and hook-config merge can be tested on their own.
 */

export const DISK_FALLBACK_MAX_FILES = 3;

/** A git checkout or pull touches many files at once; an agent edit usually does not. */
export function shouldQuizDiskBurst(fileCount: number): boolean {
  return fileCount > 0 && fileCount <= DISK_FALLBACK_MAX_FILES;
}
export const DISK_FALLBACK_DELAY_MS = 800;
export const EVENT_MAX_AGE_MS = 3 * 60 * 1000;
export const QUIZ_SNIPPET_MAX = 24_000;

const CLAUDE_MATCHER = "Edit|Write|NotebookEdit|MultiEdit";
const CODEX_MATCHER = "apply_patch|Edit|Write";
const EDIT_TOOLS = new Set([
  "Edit",
  "Write",
  "NotebookEdit",
  "MultiEdit",
  "apply_patch",
]);

export type AgentHunk = {
  oldText: string;
  newText: string;
  replaceAll?: boolean;
};

export type AgentEdit = {
  /** claude-code, codex, cursor, disk, or unknown. */
  agent: string;
  filePath: string;
  /** Generated code the student has to explain. Not the user's prompt. */
  snippet: string;
  hunks: AgentHunk[];
  /**
   * `previous` is the file with the generated code removed.
   * `next` is the file after that code is inserted.
   */
  restore?: { previous: string; next: string };
  /** The agent created this file. It stays deleted until the quiz is passed. */
  created?: boolean;
  /** Full file contents after the edit, when known. */
  next?: string;
  /** The text the user typed to the agent, when the hook included it. */
  userPrompt?: string;
};

export type ConfigInput =
  | { kind: "missing" }
  | { kind: "invalid"; reason: string }
  | { kind: "ok"; value: unknown };

export type HookInstallPlan = {
  scriptPath: string;
  writes: { path: string; contents: string }[];
  installed: string[];
  unchanged: string[];
  errors: string[];
};

export function normPath(fsPath: string): string {
  const resolved = path.resolve(fsPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function guardDirectory(homeDir: string): string {
  return path.join(homeDir, ".comprehension-guard");
}

export function resolveGuardHome(envValue: string | undefined, homedir: string): string {
  if (envValue && envValue.trim()) {
    return path.resolve(envValue.trim());
  }
  return homedir;
}

export function snapshotFileName(absPath: string): string {
  const key = path.resolve(absPath);
  return crypto.createHash("sha1").update(key).digest("hex") + ".txt";
}

export function quizSnippet(text: string): string {
  if (text.length <= QUIZ_SNIPPET_MAX) {
    return text;
  }
  return text.slice(0, QUIZ_SNIPPET_MAX);
}

export function equivalentText(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const na = a.replace(/\r\n/g, "\n");
  const nb = b.replace(/\r\n/g, "\n");
  if (na === nb) {
    return true;
  }
  return na.replace(/\n$/, "") === nb.replace(/\n$/, "");
}

export function looksBinary(text: string): boolean {
  return text.includes("\0");
}

/** Lines present in `next` that were not already in `previous`. */
export function diffAddedText(previous: string, next: string): string {
  if (previous === next) {
    return "";
  }
  const prevLines = splitLines(previous);
  const nextLines = splitLines(next);
  const count = new Map<string, number>();
  for (const line of prevLines) {
    count.set(line, (count.get(line) ?? 0) + 1);
  }
  const added: string[] = [];
  for (const line of nextLines) {
    const n = count.get(line) ?? 0;
    if (n > 0) {
      count.set(line, n - 1);
    } else {
      added.push(line);
    }
  }
  return added.join("\n");
}

export function isIgnoredCodePath(fsPath: string): boolean {
  const normed = fsPath.replace(/\\/g, "/");
  if (
    normed.includes("/node_modules/") ||
    normed.includes("/.git/") ||
    normed.includes("/dist/") ||
    normed.includes("/out/") ||
    normed.includes("/.comprehension-guard/")
  ) {
    return true;
  }
  const base = normed.slice(normed.lastIndexOf("/") + 1);
  return (
    base === "package-lock.json" ||
    base === "yarn.lock" ||
    base === "pnpm-lock.yaml"
  );
}

export function isFreshEvent(
  receivedAt: number,
  now: number,
  maxAgeMs = EVENT_MAX_AGE_MS,
): boolean {
  if (!Number.isFinite(receivedAt)) {
    return false;
  }
  if (receivedAt > now + 60_000) {
    return false;
  }
  return now - receivedAt <= maxAgeMs;
}

/**
 * Whether a document change should raise the disk fallback quiz.
 * One large insertion in the focused editor stays with the inline guard.
 */
export function shouldUseDiskFallback(input: {
  suppressed: boolean;
  processing: boolean;
  claimed: boolean;
  undoOrRedo: boolean;
  ignoredPath: boolean;
  isActive: boolean;
  isDirty: boolean;
  bigSingle: boolean;
  totalInserted: number;
  threshold: number;
  hasBaseline: boolean;
}): boolean {
  if (
    input.suppressed ||
    input.processing ||
    input.claimed ||
    input.undoOrRedo ||
    input.ignoredPath
  ) {
    return false;
  }
  if (!input.hasBaseline) {
    return false;
  }
  if (input.totalInserted < input.threshold) {
    return false;
  }
  if (input.isActive && input.bigSingle) {
    return false;
  }
  if (input.isActive && input.isDirty) {
    return false;
  }
  return true;
}

export function isOurHookCommand(command: unknown): boolean {
  if (typeof command !== "string") {
    return false;
  }
  const normalized = command.replace(/\\/g, "/");
  return (
    normalized.includes(".comprehension-guard/") &&
    normalized.includes("notify.js")
  );
}

export function hookCommand(nodePath: string, scriptPath: string): string {
  return `${quoteArg(nodePath)} ${quoteArg(scriptPath)}`;
}

export function revertHunks(text: string, hunks: AgentHunk[]): string {
  let next = text;
  for (const hunk of hunks) {
    if (!hunk.newText || hunk.newText === hunk.oldText) {
      continue;
    }
    if (hunk.replaceAll) {
      next = next.split(hunk.newText).join(hunk.oldText);
      continue;
    }
    const at = next.indexOf(hunk.newText);
    if (at >= 0) {
      next =
        next.slice(0, at) +
        hunk.oldText +
        next.slice(at + hunk.newText.length);
    }
  }
  return next;
}

export function withBaseline(edit: AgentEdit, previous: string | undefined): AgentEdit {
  if (previous === undefined || edit.restore || edit.next === undefined) {
    return edit;
  }
  if (equivalentText(previous, edit.next)) {
    return { ...edit, snippet: "", created: false };
  }
  const added = diffAddedText(previous, edit.next);
  if (added.length === 0) {
    return {
      ...edit,
      snippet: "",
      created: false,
      restore: { previous, next: edit.next },
    };
  }
  return {
    ...edit,
    snippet: added,
    created: false,
    restore: { previous, next: edit.next },
  };
}

export function editsFromHookEnvelope(
  body: unknown,
  opts?: {
    readFile?: (absPath: string) => string | undefined;
    readSnapshot?: (absPath: string) => string | undefined;
  },
): AgentEdit[] {
  const record = asRecord(body);
  if (!record) {
    return [];
  }
  const payload = asRecord(record.payload) ?? record;
  const eventName = stringField(payload, "hook_event_name") || stringField(payload, "hookEventName");
  if (eventName === "PreToolUse") {
    return [];
  }
  const snapshots = stringMap(record.snapshots);
  const readSnapshot = (absPath: string): string | undefined => {
    const fromEnvelope = lookupSnapshot(snapshots, absPath);
    if (fromEnvelope !== undefined) {
      return fromEnvelope;
    }
    return opts?.readSnapshot?.(absPath);
  };
  const edits = normalizePayload(payload, readSnapshot, opts?.readFile);
  const userPrompt = extractUserPrompt(payload);
  if (!userPrompt) {
    return edits;
  }
  return edits.map((edit) => ({ ...edit, userPrompt }));
}

/**
 * Choose the generated code to review, and remember the file with that code
 * removed (`restore.previous`) and with it applied (`restore.next`).
 *
 * Cursor's hook sometimes echoes the user's prompt in `new_string`. When that
 * happens, the snippet comes from the lines that actually landed in the file.
 */
export function prepareHeldEdit(
  edit: AgentEdit,
  fileText: string | undefined,
  baseline: string | undefined,
): AgentEdit {
  const prompt = edit.userPrompt?.trim() ?? "";
  const landed = fileText ?? edit.restore?.next ?? edit.next;
  let previous = edit.restore?.previous;
  if (
    previous === undefined &&
    baseline !== undefined &&
    landed !== undefined &&
    !equivalentText(baseline, landed)
  ) {
    previous = baseline;
  }
  if (previous === undefined && landed !== undefined && edit.hunks.length > 0) {
    const reverted = revertHunks(landed, edit.hunks);
    if (reverted !== landed) {
      previous = reverted;
    }
  }

  let snippet = stripPrompt(edit.snippet, prompt);
  const hunkCode = stripPrompt(
    edit.hunks
      .map((hunk) => hunk.newText)
      .filter((text) => text.length > 0 && !isSameText(text, prompt))
      .join("\n"),
    prompt,
  );
  if (
    previous !== undefined &&
    landed !== undefined &&
    !equivalentText(previous, landed)
  ) {
    const added = stripPrompt(diffAddedText(previous, landed), prompt);
    if (hunkCode && landed.includes(hunkCode) && !isSameText(hunkCode, prompt)) {
      snippet = hunkCode;
    } else if (added.trim()) {
      snippet = added;
    }
  }

  if (previous !== undefined && landed !== undefined) {
    return {
      ...edit,
      snippet,
      restore: { previous, next: landed },
      next: landed,
    };
  }
  return { ...edit, snippet };
}

export function planHookInstall(opts: {
  homeDir: string;
  nodePath: string;
  scriptSource: string;
  claude: ConfigInput;
  codex: ConfigInput;
  cursor: ConfigInput;
}): HookInstallPlan {
  const scriptPath = path.join(guardDirectory(opts.homeDir), "notify.js");
  const command = hookCommand(opts.nodePath, scriptPath);
  const writes: { path: string; contents: string }[] = [
    { path: scriptPath, contents: opts.scriptSource },
  ];
  const installed: string[] = [];
  const unchanged: string[] = [];
  const errors: string[] = [];

  mergeProduct(
    "Claude Code",
    path.join(opts.homeDir, ".claude", "settings.json"),
    opts.claude,
    (value) => mergeClaudeSettings(value, command),
    writes,
    installed,
    unchanged,
    errors,
  );
  mergeProduct(
    "Codex",
    path.join(opts.homeDir, ".codex", "hooks.json"),
    opts.codex,
    (value) => mergeCodexHooks(value, command),
    writes,
    installed,
    unchanged,
    errors,
  );
  mergeProduct(
    "Cursor",
    path.join(opts.homeDir, ".cursor", "hooks.json"),
    opts.cursor,
    (value) => mergeCursorHooks(value, command),
    writes,
    installed,
    unchanged,
    errors,
  );

  return { scriptPath, writes, installed, unchanged, errors };
}

export function parseConfigText(
  text: string,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "invalid JSON";
    return { ok: false, reason };
  }
}

export function parseApplyPatch(command: string): {
  filePath: string;
  kind: "add" | "update" | "delete";
  added: string;
  removed: string;
}[] {
  const start = command.indexOf("*** Begin Patch");
  if (start < 0) {
    return [];
  }
  const lines = command.slice(start).split(/\n/);
  const files: {
    filePath: string;
    kind: "add" | "update" | "delete";
    added: string[];
    removed: string[];
  }[] = [];
  let current: (typeof files)[number] | undefined;
  const flush = (): void => {
    if (!current) {
      return;
    }
    files.push(current);
    current = undefined;
  };
  for (const rawLine of lines) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const header =
      /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line);
    if (header) {
      flush();
      const kindWord = header[1];
      const kind = kindWord === "Update" ? "update" : kindWord === "Add" ? "add" : "delete";
      current = {
        filePath: header[2].trim(),
        kind,
        added: [],
        removed: [],
      };
      continue;
    }
    if (line.startsWith("***")) {
      if (line.startsWith("*** End Patch")) {
        flush();
      }
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith("+")) {
      current.added.push(line.slice(1));
    } else if (line.startsWith("-")) {
      current.removed.push(line.slice(1));
    }
  }
  flush();
  return files.map((file) => ({
    filePath: file.filePath,
    kind: file.kind,
    added: file.added.join("\n"),
    removed: file.removed.join("\n"),
  }));
}

function normalizePayload(
  payload: Record<string, unknown>,
  readSnapshot: (absPath: string) => string | undefined,
  readFile: ((absPath: string) => string | undefined) | undefined,
): AgentEdit[] {
  const toolName = stringField(payload, "tool_name") || stringField(payload, "toolName");
  const topEdits = payload.edits;
  const hasTopLevelEdits = Array.isArray(topEdits);
  if (toolName && !EDIT_TOOLS.has(toolName) && !hasTopLevelEdits) {
    return [];
  }

  const agent = detectAgent(payload, toolName);
  const cwd = stringField(payload, "cwd");
  const input = asRecord(parseMaybe(payload.tool_input ?? payload.toolInput)) ?? {};

  if (hasTopLevelEdits && (stringField(payload, "file_path") || stringField(payload, "filePath"))) {
    const filePath = resolveFilePath(
      stringField(payload, "file_path") || stringField(payload, "filePath"),
      cwd,
    );
    return editsFromHunks(agent, filePath, topEdits);
  }

  if (
    toolName === "apply_patch" ||
    (typeof input.command === "string" && input.command.includes("*** Begin Patch"))
  ) {
    return editsFromPatch(agent === "unknown" ? "codex" : agent, stringField(input, "command"), cwd, readSnapshot, readFile);
  }

  if (toolName === "MultiEdit" || Array.isArray(input.edits)) {
    const filePath = resolveFilePath(filePathFrom(input, payload), cwd);
    if (!filePath) {
      return [];
    }
    return editsFromHunks(agent, filePath, input.edits);
  }

  if (toolName === "Write" || typeof input.content === "string" || input.contentOmitted === true) {
    const filePath = resolveFilePath(filePathFrom(input, payload), cwd);
    if (!filePath) {
      return [];
    }
    return editsFromWrite(agent, filePath, input, payload, readSnapshot, readFile);
  }

  if (
    toolName === "Edit" ||
    toolName === "NotebookEdit" ||
    typeof input.new_string === "string" ||
    typeof input.new_source === "string"
  ) {
    const filePath = resolveFilePath(filePathFrom(input, payload), cwd);
    if (!filePath) {
      return [];
    }
    const newText = stringField(input, "new_string") || stringField(input, "new_source");
    const oldText = stringField(input, "old_string") || stringField(input, "old_source");
    if (!newText) {
      return [];
    }
    return [
      {
        agent,
        filePath,
        snippet: newText,
        hunks: [
          {
            oldText,
            newText,
            replaceAll: input.replace_all === true,
          },
        ],
      },
    ];
  }

  return [];
}

function editsFromWrite(
  agent: string,
  filePath: string,
  input: Record<string, unknown>,
  payload: Record<string, unknown>,
  readSnapshot: (absPath: string) => string | undefined,
  readFile: ((absPath: string) => string | undefined) | undefined,
): AgentEdit[] {
  let content = typeof input.content === "string" ? input.content : "";
  if (!content || input.contentOmitted === true) {
    content = readFile?.(filePath) ?? content;
  }
  if (!content) {
    return [];
  }
  const previous = readSnapshot(filePath);
  const response = asRecord(payload.tool_response) ?? asRecord(payload.toolResponse);
  const created = previous === undefined && stringField(response ?? {}, "type") === "create";
    if (previous !== undefined) {
    if (equivalentText(previous, content)) {
      return [];
    }
    const added = diffAddedText(previous, content);
    if (added.length === 0) {
      return [];
    }
    return [
      {
        agent,
        filePath,
        snippet: added,
        hunks: [],
        restore: { previous, next: content },
        next: content,
        created: false,
      },
    ];
  }
  return [
    {
      agent,
      filePath,
      snippet: content,
      hunks: [],
      created,
      next: content,
    },
  ];
}

function editsFromHunks(agent: string, filePath: string, rawEdits: unknown): AgentEdit[] {
  if (!Array.isArray(rawEdits)) {
    return [];
  }
  const hunks: AgentHunk[] = [];
  for (const raw of rawEdits) {
    const edit = asRecord(raw);
    if (!edit) {
      continue;
    }
    const newText = stringField(edit, "new_string") || stringField(edit, "newText") || stringField(edit, "new_source");
    const oldText = stringField(edit, "old_string") || stringField(edit, "oldText") || stringField(edit, "old_source");
    if (!newText) {
      continue;
    }
    hunks.push({
      oldText,
      newText,
      replaceAll: edit.replace_all === true,
    });
  }
  if (hunks.length === 0) {
    return [];
  }
  return [
    {
      agent,
      filePath,
      snippet: hunks.map((hunk) => hunk.newText).join("\n"),
      hunks,
    },
  ];
}

function editsFromPatch(
  agent: string,
  command: string,
  cwd: string,
  readSnapshot: (absPath: string) => string | undefined,
  readFile: ((absPath: string) => string | undefined) | undefined,
): AgentEdit[] {
  const edits: AgentEdit[] = [];
  for (const file of parseApplyPatch(command)) {
    if (file.kind === "delete" || !file.filePath) {
      continue;
    }
    const filePath = resolveFilePath(file.filePath, cwd);
    const previous = readSnapshot(filePath);
    const current = readFile?.(filePath);
    if (previous !== undefined && current !== undefined && !equivalentText(previous, current)) {
      const added = diffAddedText(previous, current);
      edits.push({
        agent,
        filePath,
        snippet: added.length > 0 ? added : file.added,
        hunks: [],
        restore: { previous, next: current },
        next: current,
      });
      continue;
    }
    const snippet = file.added || current || "";
    if (!snippet) {
      continue;
    }
    edits.push({
      agent,
      filePath,
      snippet,
      hunks: [],
      created: file.kind === "add" && previous === undefined,
      next: current ?? snippet,
    });
  }
  return edits;
}

function detectAgent(payload: Record<string, unknown>, toolName: string): string {
  if (toolName === "apply_patch") {
    return "codex";
  }
  if (Array.isArray(payload.edits) && (stringField(payload, "file_path") || stringField(payload, "filePath"))) {
    return "cursor";
  }
  const eventName = stringField(payload, "hook_event_name") || stringField(payload, "hookEventName");
  if (eventName === "afterFileEdit") {
    return "cursor";
  }
  if (!eventName && (payload.model_id || payload.conversation_id || payload.generation_id)) {
    return "cursor";
  }
  if (eventName) {
    return "claude-code";
  }
  return "unknown";
}

function filePathFrom(
  input: Record<string, unknown>,
  payload: Record<string, unknown>,
): string {
  return (
    stringField(input, "file_path") ||
    stringField(input, "filePath") ||
    stringField(input, "notebook_path") ||
    stringField(input, "target_notebook") ||
    stringField(input, "path") ||
    stringField(payload, "file_path") ||
    stringField(payload, "filePath") ||
    stringField(payload, "notebook_path")
  );
}

function resolveFilePath(filePath: string, cwd: string): string {
  if (!filePath) {
    return "";
  }
  if (path.isAbsolute(filePath)) {
    return path.normalize(filePath);
  }
  if (cwd) {
    return path.resolve(cwd, filePath);
  }
  return path.resolve(filePath);
}

function lookupSnapshot(
  snapshots: Record<string, string> | undefined,
  absPath: string,
): string | undefined {
  if (!snapshots) {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(snapshots, absPath)) {
    return snapshots[absPath];
  }
  const want = normPath(absPath);
  for (const [key, value] of Object.entries(snapshots)) {
    if (normPath(key) === want) {
      return value;
    }
  }
  return undefined;
}

function mergeProduct(
  label: string,
  filePath: string,
  input: ConfigInput,
  merge: (value: unknown) => { next: unknown; changed: boolean },
  writes: { path: string; contents: string }[],
  installed: string[],
  unchanged: string[],
  errors: string[],
): void {
  if (input.kind === "invalid") {
    errors.push(`${label} config at ${filePath} is not valid JSON (${input.reason}). It was left unchanged.`);
    return;
  }
  const current = input.kind === "ok" ? input.value : {};
  let merged: { next: unknown; changed: boolean };
  try {
    merged = merge(current);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "could not merge";
    errors.push(`${label} config at ${filePath} could not be updated (${reason}).`);
    return;
  }
  if (!merged.changed && input.kind === "ok") {
    unchanged.push(label);
    return;
  }
  writes.push({
    path: filePath,
    contents: JSON.stringify(merged.next, null, 2) + "\n",
  });
  installed.push(label);
}

function mergeClaudeSettings(
  value: unknown,
  command: string,
): { next: unknown; changed: boolean } {
  const { root, hooks, changed: createdHooks } = hooksObject(value, "Claude settings");
  let changed = createdHooks;
  changed = upsertClaudeEvent(hooks, "PreToolUse", command, false) || changed;
  changed = upsertClaudeEvent(hooks, "PostToolUse", command, true) || changed;
  return { next: root, changed };
}

function mergeCodexHooks(
  value: unknown,
  command: string,
): { next: unknown; changed: boolean } {
  const { root, hooks, changed: createdHooks } = hooksObject(value, "Codex hooks");
  let changed = createdHooks;
  changed = upsertClaudeEvent(hooks, "PreToolUse", command, false, CODEX_MATCHER) || changed;
  changed = upsertClaudeEvent(hooks, "PostToolUse", command, true, CODEX_MATCHER) || changed;
  return { next: root, changed };
}

function mergeCursorHooks(
  value: unknown,
  command: string,
): { next: unknown; changed: boolean } {
  const { root, hooks, changed: createdHooks } = hooksObject(value, "Cursor hooks");
  let changed = createdHooks;
  if (root.version === undefined) {
    root.version = 1;
    changed = true;
  }
  const list = Array.isArray(hooks.afterFileEdit) ? [...hooks.afterFileEdit] : [];
  let found = false;
  if (!Array.isArray(hooks.afterFileEdit)) {
    changed = true;
  }
  const nextList = list.map((entry) => {
    const rec = asRecord(entry);
    if (!rec || !isOurHookCommand(rec.command)) {
      return entry;
    }
    found = true;
    if (rec.command !== command) {
      changed = true;
      return { ...rec, command };
    }
    return entry;
  });
  if (!found) {
    nextList.push({ command });
    changed = true;
  }
  hooks.afterFileEdit = nextList;
  return { next: root, changed };
}

function upsertClaudeEvent(
  hooks: Record<string, unknown>,
  eventName: string,
  command: string,
  asyncHook: boolean,
  matcher = CLAUDE_MATCHER,
): boolean {
  const groups = Array.isArray(hooks[eventName]) ? [...(hooks[eventName] as unknown[])] : [];
  let found = false;
  let changed = !Array.isArray(hooks[eventName]);
  const nextGroups = groups.map((group) => {
    const rec = asRecord(group);
    if (!rec || !Array.isArray(rec.hooks)) {
      return group;
    }
    let groupChanged = false;
    const nextHooks = rec.hooks.map((hook) => {
      const item = asRecord(hook);
      if (!item || !isOurHookCommand(item.command)) {
        return hook;
      }
      found = true;
      const refreshed = refreshHook(item, command, asyncHook);
      if (JSON.stringify(refreshed) !== JSON.stringify(item)) {
        groupChanged = true;
      }
      return refreshed;
    });
    if (!groupChanged) {
      return group;
    }
    changed = true;
    return { ...rec, hooks: nextHooks };
  });
  if (!found) {
    nextGroups.push({
      matcher,
      hooks: [refreshHook({}, command, asyncHook)],
    });
    changed = true;
  }
  hooks[eventName] = nextGroups;
  return changed;
}

function refreshHook(
  hook: Record<string, unknown>,
  command: string,
  asyncHook: boolean,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...hook, type: "command", command, timeout: 10 };
  if (asyncHook) {
    next.async = true;
  } else if ("async" in next) {
    delete next.async;
  }
  return next;
}

function hooksObject(
  value: unknown,
  label: string,
): { root: Record<string, unknown>; hooks: Record<string, unknown>; changed: boolean } {
  const root = cloneRecord(value, label);
  if (root.hooks !== undefined && !asRecord(root.hooks)) {
    throw new Error(`${label} hooks must be a JSON object`);
  }
  const existing = asRecord(root.hooks);
  const hooks = existing ?? {};
  root.hooks = hooks;
  return { root, hooks, changed: !existing };
}

function cloneRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  const record = asRecord(value);
  if (!record) {
    throw new Error(`${label} must be a JSON object`);
  }
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}

function stringMap(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") {
      out[key] = item;
    }
  }
  return out;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function parseMaybe(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function extractUserPrompt(payload: Record<string, unknown>): string {
  const input = asRecord(parseMaybe(payload.tool_input ?? payload.toolInput));
  const candidates = [
    stringField(payload, "prompt"),
    stringField(payload, "user_prompt"),
    stringField(payload, "userPrompt"),
    stringField(input, "prompt"),
    stringField(input, "user_prompt"),
    stringField(input, "instruction"),
  ];
  for (const candidate of candidates) {
    if (candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

function isSameText(a: string, b: string): boolean {
  if (!b) {
    return false;
  }
  return equivalentText(a.trim(), b.trim());
}

function stripPrompt(text: string, prompt: string): string {
  if (!prompt || prompt.length < 12 || !text) {
    return text;
  }
  const stripped = text.split(prompt).join("").trim();
  return stripped;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string {
  if (!record) {
    return "";
  }
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function quoteArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}
