import type { Node } from "web-tree-sitter";
import { scoreUnit } from "./formula";
import { languageForPath, parseSource } from "./parser";
import type { FileAnalysis, RiskTag, ScoreInput, UnitFact, UnitKind } from "./types";

export type AnalyzeOptions = {
  mastery?: number;
  aiShare?: number;
};

type Draft = {
  fact: UnitFact;
  denseOps: number;
};

const SKIP_EXTENSIONS = new Set([
  ".css",
  ".scss",
  ".less",
  ".html",
  ".htm",
  ".md",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".lock",
  ".svg",
  ".map",
  ".xml",
]);

const SKIP_SEGMENTS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "vendor",
  "templates",
  "static",
  "styles",
  "generated",
]);

const LOCK_NAMES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "cargo.lock"]);

const FUNCTION_TYPES = new Set([
  "function_declaration",
  "function_definition",
  "function_definition_statement",
  "function_item",
]);
const METHOD_TYPES = new Set(["method_definition", "method_declaration", "method"]);
const CLASS_TYPES = new Set(["class_declaration", "class_definition", "class_specifier", "impl_item"]);
const DECLARATOR_TYPES = new Set(["variable_declarator", "lexical_declarator"]);
const FUNCTION_VALUES = new Set(["arrow_function", "function", "function_expression"]);

const BRANCH_TYPES = new Set([
  "if_statement",
  "if",
  "if_expression",
  "elif_clause",
  "switch_statement",
  "switch_expression",
  "conditional_expression",
  "ternary_expression",
]);

const LOOP_TYPES = new Set([
  "for_statement",
  "while_statement",
  "do_statement",
  "for_in_statement",
  "for_expression",
  "loop_expression",
  "enhanced_for_statement",
]);

const CALL_TYPES = new Set([
  "call_expression",
  "call",
  "method_invocation",
  // C# and PHP name the same construct differently.
  "invocation_expression",
  "function_call_expression",
  // Bash names a call `command`.
  "command",
]);

const STATE_TYPES = new Set([
  "assignment_expression",
  "augmented_assignment_expression",
  "assignment",
  "update_expression",
]);

const NAME_TYPES = new Set([
  "identifier",
  "property_identifier",
  "field_identifier",
  "type_identifier",
  "simple_identifier",
]);

const BARE_NAME_TYPES = new Set(["name", "word"]);

const BITWISE_OPERATORS = new Set(["|", "&", "^", "<<", ">>", ">>>"]);

const SKIP_NAME_WALK = new Set([
  "parameters",
  "parameter_list",
  "formal_parameters",
  "function_value_parameters",
  "method_parameters",
  "argument_list",
  "arguments",
  "type_parameters",
  "type_arguments",
  "block",
  "statement_block",
  "compound_statement",
  "class_body",
  "declaration_list",
  "field_declaration_list",
  "function_body",
  "body",
]);

const MEMORY_RE = /\b(malloc|calloc|realloc|free|memcpy|sizeof|unsafe|pointer)\b/i;
const ASYNC_RE = /\b(async|await|Promise|tokio)\b/i;
const AUTH_RE = /\b(bcrypt|jwt|password|session|oauth)\b/i;
const SQL_RE = /\b(SELECT|INSERT|UPDATE|DELETE)\b/;

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function fileParts(file: string): { base: string; ext: string; dirs: string[] } {
  const normalized = file.replace(/\\/g, "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  const base = segments.pop() ?? normalized;
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot).toLowerCase() : "";
  return { base, ext, dirs: segments.map((segment) => segment.toLowerCase()) };
}

function skipFlag(file: string, source: string): string | null {
  const { base, ext, dirs } = fileParts(file);
  const skipped = SKIP_EXTENSIONS.has(ext) || dirs.some((dir) => SKIP_SEGMENTS.has(dir)) || LOCK_NAMES.has(base);
  if (!skipped) return null;
  if (ext === ".html" || ext === ".htm" || dirs.includes("templates")) {
    if (source.includes("{%") || source.includes("{{") || source.includes("if ")) return "template with if-tags";
    return "markup";
  }
  if (ext === ".css" || ext === ".scss" || ext === ".less" || dirs.includes("styles")) return "styles";
  if (dirs.includes("generated") || ext === ".map" || ext === ".lock" || LOCK_NAMES.has(base)) return "generated";
  return "config";
}

function sliceSource(source: string, start: number, end: number): string {
  if (start >= end) return "";
  return Buffer.from(source, "utf8").subarray(start, end).toString("utf8");
}

function isNameToken(node: Node): boolean {
  return NAME_TYPES.has(node.type);
}

function bareName(node: Node): string | null {
  if (!BARE_NAME_TYPES.has(node.type)) return null;
  if (node.text.includes(" ") || node.text.includes("\n") || node.text.length === 0) return null;
  return node.text;
}

function extractName(node: Node): string | null {
  if (isNameToken(node)) return node.text;
  const bare = bareName(node);
  if (bare) return bare;
  const declarator = node.childForFieldName("declarator");
  if (declarator) {
    const found = extractName(declarator);
    if (found) return found;
  }
  const named = node.childForFieldName("name");
  if (named && named.id !== node.id) {
    const found = extractName(named);
    if (found) return found;
  }
  let last: string | null = null;
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child || SKIP_NAME_WALK.has(child.type)) continue;
    if (isNameToken(child)) {
      last = child.text;
      continue;
    }
    const childBare = bareName(child);
    if (childBare) {
      last = childBare;
      continue;
    }
    if (
      child.type.endsWith("declarator") ||
      child.type === "generic_type" ||
      child.type === "scoped_identifier" ||
      child.type === "qualified_identifier" ||
      child.type === "namespace_identifier"
    ) {
      const found = extractName(child);
      if (found) last = found;
    }
  }
  return last;
}

function unitName(node: Node): string | null {
  if (node.type === "impl_item") {
    const typeNode = node.childForFieldName("type");
    if (typeNode) {
      const found = extractName(typeNode);
      if (found) return found;
    }
  }
  const named = node.childForFieldName("name");
  if (named) {
    const found = extractName(named);
    if (found) return found;
  }
  const declarator = node.childForFieldName("declarator");
  if (declarator) {
    const found = extractName(declarator);
    if (found) return found;
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child || SKIP_NAME_WALK.has(child.type)) continue;
    if (isNameToken(child)) return child.text;
    const childBare = bareName(child);
    if (childBare) return childBare;
    if (child.type.endsWith("declarator")) {
      const found = extractName(child);
      if (found) return found;
    }
  }
  return null;
}

function unwrapValue(node: Node | null): Node | null {
  let current = node;
  while (current && current.type === "parenthesized_expression") {
    current = current.namedChild(0);
  }
  return current;
}

function kindOf(node: Node): UnitKind | null {
  if (FUNCTION_TYPES.has(node.type)) return "function";
  if (METHOD_TYPES.has(node.type)) return "method";
  if (CLASS_TYPES.has(node.type)) return "class";
  if (!DECLARATOR_TYPES.has(node.type)) return null;
  const value = unwrapValue(node.childForFieldName("value"));
  if (value && FUNCTION_VALUES.has(value.type)) return "function";
  return null;
}

type RawUnit = { node: Node; name: string; kind: UnitKind };

function collectUnits(root: Node): RawUnit[] {
  const units: RawUnit[] = [];
  const visit = (node: Node, ancestors: Node[]) => {
    const kind = kindOf(node);
    let next = ancestors;
    if (kind) {
      const sameSpan = ancestors.some(
        (ancestor) => ancestor.startIndex === node.startIndex && ancestor.endIndex === node.endIndex,
      );
      if (!sameSpan) {
        const name = unitName(node);
        if (name) {
          units.push({ node, name, kind });
          next = ancestors.concat(node);
        }
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) visit(child, next);
    }
  };
  visit(root, []);
  return units;
}

function fieldNameOf(node: Node): string | null {
  const parent = node.parent;
  if (!parent) return null;
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    if (child && child.id === node.id) return parent.fieldNameForChild(i);
  }
  return null;
}

function isLoopUpdate(node: Node): boolean {
  if (node.type !== "update_expression") return false;
  const parent = node.parent;
  if (!parent || parent.type !== "for_statement") return false;
  const field = fieldNameOf(node);
  return field === "update" || field === "increment";
}

function operatorText(node: Node): string | null {
  const operator = node.childForFieldName("operator");
  if (operator) return operator.text;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && !child.isNamed) return child.text;
  }
  return null;
}

function lastIdentifier(node: Node): string {
  const property =
    node.childForFieldName("property") ??
    node.childForFieldName("field") ??
    node.childForFieldName("attribute");
  if (property && (isNameToken(property) || bareName(property))) return property.text;
  if (isNameToken(node) || bareName(node)) return node.text;
  let last = "";
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;
    if (
      child.type === "arguments" ||
      child.type === "argument_list" ||
      child.type === "type_arguments" ||
      child.type === "type_parameters" ||
      child.type === "call_suffix" ||
      child.type === "value_arguments" ||
      child.type === "value_argument"
    ) {
      continue;
    }
    const name = lastIdentifier(child);
    if (name) last = name;
  }
  return last;
}

function calleeName(node: Node): string {
  const target =
    node.childForFieldName("function") ??
    node.childForFieldName("callee") ??
    node.childForFieldName("method");
  if (target) return lastIdentifier(target);
  const name = node.childForFieldName("name");
  if (name && (isNameToken(name) || bareName(name))) return name.text;
  return lastIdentifier(node);
}

function ownText(unit: RawUnit, units: RawUnit[], source: string): string {
  const nested = units
    .filter(
      (other) =>
        other !== unit &&
        other.node.startIndex >= unit.node.startIndex &&
        other.node.endIndex <= unit.node.endIndex,
    )
    .sort((a, b) => a.node.startIndex - b.node.startIndex || b.node.endIndex - a.node.endIndex);
  let text = "";
  let cursor = unit.node.startIndex;
  for (const other of nested) {
    if (other.node.startIndex < cursor) continue;
    text += sliceSource(source, cursor, other.node.startIndex);
    cursor = other.node.endIndex;
  }
  text += sliceSource(source, cursor, unit.node.endIndex);
  return text;
}

function riskTags(text: string, calls: string[], recursive: boolean): RiskTag[] {
  const tags: RiskTag[] = [];
  if (MEMORY_RE.test(text)) tags.push("memory");
  if (recursive) tags.push("recursion");
  if (ASYNC_RE.test(text)) tags.push("async");
  if (AUTH_RE.test(text)) tags.push("auth");
  if (SQL_RE.test(text) || calls.includes("query")) tags.push("sql");
  return tags;
}

function measure(unit: RawUnit, units: RawUnit[], source: string): { calls: string[]; denseOps: number; branches: number; loops: number; stateChanges: number } {
  const nested = new Set(units.map((item) => item.node.id));
  let branches = 0;
  let loops = 0;
  let stateChanges = 0;
  let denseOps = 0;
  const calls: string[] = [];
  const seen = new Set<string>();

  const visit = (node: Node, isRoot: boolean) => {
    if (!isRoot && nested.has(node.id)) return;
    // Ruby's branch is a named `if` node. Other grammars also have an anonymous `if` keyword inside `if_statement`.
    if (BRANCH_TYPES.has(node.type) && node.isNamed) branches += 1;
    if (LOOP_TYPES.has(node.type)) loops += 1;
    if (STATE_TYPES.has(node.type) && !isLoopUpdate(node)) stateChanges += 1;
    if (CALL_TYPES.has(node.type)) {
      const name = calleeName(node);
      if (name && !seen.has(name)) {
        seen.add(name);
        calls.push(name);
      }
    }
    if (node.type === "conditional_expression") denseOps += 1;
    else if (node.type === "binary_expression") {
      const operator = operatorText(node);
      if (operator && BITWISE_OPERATORS.has(operator)) denseOps += 1;
    } else if (node.type === "unary_expression" && operatorText(node) === "~") {
      denseOps += 1;
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) visit(child, false);
    }
  };
  visit(unit.node, true);
  return { calls, denseOps, branches, loops, stateChanges };
}

function buildDraft(file: string, language: string, unit: RawUnit, units: RawUnit[], source: string, options: AnalyzeOptions | undefined): Draft {
  const metrics = measure(unit, units, source);
  const code = sliceSource(source, unit.node.startIndex, unit.node.endIndex);
  const signature = (code.split(/\r?\n/, 1)[0] ?? "").trim().slice(0, 180);
  const startLine = unit.node.startPosition.row + 1;
  const endLine = unit.node.endPosition.row + 1;
  const recursive = metrics.calls.includes(unit.name);
  const fact: UnitFact = {
    unit: unit.name,
    file,
    language,
    kind: unit.kind,
    startLine,
    endLine,
    lines: endLine - startLine + 1,
    signature,
    code,
    branches: metrics.branches,
    loops: metrics.loops,
    recursive,
    stateChanges: metrics.stateChanges,
    calls: metrics.calls,
    callers: [],
    riskTags: riskTags(ownText(unit, units, source), metrics.calls, recursive),
    mastery: finiteOr(options?.mastery, 0.5),
    aiShare: finiteOr(options?.aiShare, 1),
    centrality: 0,
    logic: 0,
    risk: 1,
    formulaValue: 0,
  };
  return { fact, denseOps: metrics.denseOps };
}

function compareUnits(a: UnitFact, b: UnitFact): number {
  return a.startLine - b.startLine || (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0);
}

function linkAndScore(drafts: Draft[]): void {
  const names = new Set(drafts.map((draft) => draft.fact.unit));
  for (const draft of drafts) {
    const callers: string[] = [];
    for (const other of drafts) {
      if (other === draft) continue;
      if (other.fact.calls.includes(draft.fact.unit)) callers.push(other.fact.unit);
    }
    let callsIntoChanged = 0;
    for (const name of draft.fact.calls) {
      if (name === draft.fact.unit) continue;
      if (names.has(name)) callsIntoChanged += 1;
    }
    const input: ScoreInput = {
      lines: draft.fact.lines,
      branches: draft.fact.branches,
      loops: draft.fact.loops,
      recursive: draft.fact.recursive,
      stateChanges: draft.fact.stateChanges,
      callsIntoChanged,
      callerCount: callers.length,
      riskTags: draft.fact.riskTags,
      mastery: draft.fact.mastery,
      aiShare: draft.fact.aiShare,
      skipped: false,
      denseOps: draft.denseOps,
    };
    const score = scoreUnit(input);
    draft.fact.callers = callers;
    draft.fact.centrality = score.centrality;
    draft.fact.logic = score.logic;
    draft.fact.risk = score.risk;
    draft.fact.formulaValue = score.formulaValue;
  }
}

async function inspect(file: string, source: string, options?: AnalyzeOptions): Promise<{ analysis: FileAnalysis; drafts: Draft[] }> {
  const flag = skipFlag(file, source);
  const spec = await languageForPath(file);
  if (flag) {
    return {
      analysis: { file, language: spec?.language ?? null, skipped: { file, flag }, units: [] },
      drafts: [],
    };
  }
  const parsed = await parseSource(file, source);
  if (!parsed) {
    return {
      analysis: { file, language: spec?.language ?? null, skipped: null, units: [] },
      drafts: [],
    };
  }
  const raw = collectUnits(parsed.root);
  const drafts = raw.map((unit) => buildDraft(file, parsed.language, unit, raw, source, options));
  const units = drafts.map((draft) => draft.fact);
  try {
    parsed.dispose();
  } catch {
    // The fact sheet already holds its own copies of the source slices.
  }
  return {
    analysis: { file, language: parsed.language, skipped: null, units },
    drafts,
  };
}

const analysisCache = new Map<string, FileAnalysis>();
const ANALYSIS_CACHE_MAX = 24;

function sourceKey(file: string, source: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${file}\0${source.length}\0${hash >>> 0}`;
}

export async function analyzeFile(file: string, source: string, options?: AnalyzeOptions): Promise<FileAnalysis> {
  const key = sourceKey(file, source);
  const cached = analysisCache.get(key);
  if (cached) {
    return cached;
  }
  const inspected = await inspect(file, source, options);
  linkAndScore(inspected.drafts);
  inspected.analysis.units.sort(compareUnits);
  analysisCache.set(key, inspected.analysis);
  if (analysisCache.size > ANALYSIS_CACHE_MAX) {
    const oldest = analysisCache.keys().next().value;
    if (oldest) {
      analysisCache.delete(oldest);
    }
  }
  return inspected.analysis;
}

export async function analyzeFiles(
  files: { file: string; source: string; mastery?: number; aiShare?: number }[],
): Promise<FileAnalysis[]> {
  const inspected = [];
  for (const file of files) {
    inspected.push(await inspect(file.file, file.source, { mastery: file.mastery, aiShare: file.aiShare }));
  }
  linkAndScore(inspected.flatMap((item) => item.drafts));
  for (const item of inspected) item.analysis.units.sort(compareUnits);
  return inspected.map((item) => item.analysis);
}

/** File-to-file links from a batch. A call only counts when both files were analyzed together. */
export function fileEdges(files: FileAnalysis[]): { from: string; to: string; kind: "call" }[] {
  const owner = new Map<string, string>();
  for (const file of files) {
    for (const unit of file.units) {
      if (!owner.has(unit.unit)) owner.set(unit.unit, file.file);
    }
  }
  const edges: { from: string; to: string; kind: "call" }[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const unit of file.units) {
      for (const call of unit.calls) {
        const target = owner.get(call);
        if (!target || target === file.file) continue;
        const key = file.file + "\0" + target;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: file.file, to: target, kind: "call" });
      }
    }
  }
  return edges;
}
