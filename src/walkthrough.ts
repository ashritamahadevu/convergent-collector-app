import * as vscode from "vscode";
import type { AgentEdit } from "./agentProtocol";
import { getJudgeConfigId } from "./llm";
import { localGeneratedQuestion } from "./sizing/questions";
import { annotateFile, dueConcepts, getMastery } from "./memory/remember";
import { buildProjectMap, type ProjectFile } from "./memory/projectMap";
import { queuePrepSet } from "./memory/sync";
import { searchCode } from "./memory/rag";
import { runComprehensionGate, runSession } from "./quiz";
import type { GeneratedQuestion } from "./types";

const WALK_KEY = "comprehensionGuard.walkthrough";
const MASTERY_OK = 0.75;

type SavedWalk = {
  project: string;
  files: { path: string; snippet: string; core: boolean; complexity: number; centrality: number }[];
  session: number;
  snoozeUntil?: number;
};

export async function offerWalkthrough(
  context: vscode.ExtensionContext,
  edits: AgentEdit[],
): Promise<void> {
  const files = collapse(edits);
  const mapped = buildProjectMap(files.map((file) => ({ path: file.path, text: file.snippet })));
  const saved: SavedWalk = {
    project: projectName(),
    files: files.map((file) => {
      const info = mapped.find((item) => item.path === file.path);
      return {
        path: file.path,
        snippet: file.snippet.slice(0, 4000),
        core: info?.core ?? true,
        complexity: info?.complexity ?? 0,
        centrality: info?.centrality ?? 0,
      };
    }),
    session: 0,
  };
  const choice = await vscode.window.showInformationMessage(
    `${saved.project}: ${saved.files.length} files changed. Walk through the important parts in short sessions?`,
    "Start session 1",
    "Later today",
    "Snooze",
  );
  if (choice === "Later today") {
    saved.snoozeUntil = Date.now() + 8 * 60 * 60 * 1000;
    await context.globalState.update(WALK_KEY, saved);
    return;
  }
  if (choice !== "Start session 1") {
    saved.snoozeUntil = Date.now() + 24 * 60 * 60 * 1000;
    await context.globalState.update(WALK_KEY, saved);
    return;
  }
  await context.globalState.update(WALK_KEY, saved);
  await runWalkSession(context, saved);
}

export async function resumeWalkthrough(context: vscode.ExtensionContext): Promise<void> {
  const saved = context.globalState.get<SavedWalk>(WALK_KEY);
  if (!saved || (saved.snoozeUntil && saved.snoozeUntil > Date.now())) {
    return;
  }
  const remaining = sessionsFor(saved, getMastery(context));
  if (saved.session >= remaining.length) {
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    "Comprehension Guard: walkthrough session " + (saved.session + 1) + " is ready.",
    "Start",
    "Later",
  );
  if (choice === "Start") {
    await runWalkSession(context, saved);
  }
}

async function runWalkSession(context: vscode.ExtensionContext, saved: SavedWalk): Promise<void> {
  const plan = sessionsFor(saved, getMastery(context));
  const group = plan[saved.session];
  if (!group || group.length === 0) {
    await context.globalState.update(WALK_KEY, undefined);
    return;
  }
  const snippet = group.map((file) => file.snippet).join("\n\n").slice(0, 8000);
  const built = await Promise.all(
    group.map((file) => localGeneratedQuestion(file.snippet, file.path)),
  );
  const questions: GeneratedQuestion[] = built.filter((question): question is GeneratedQuestion => question !== null);
  const passed = await runSession(context, {
    snippet,
    filePath: group[0]?.path,
    questions,
    source: "walkthrough",
  });
  if (passed) {
    for (const file of group) {
      await annotateFile(context, {
        path: file.path,
        concepts: questions[0]?.conceptTags ?? [],
        core: file.core,
        complexity: file.complexity,
        centrality: file.centrality,
      });
    }
    saved.session += 1;
    if (saved.session >= plan.length) {
      await context.globalState.update(WALK_KEY, undefined);
      void vscode.window.showInformationMessage("Comprehension Guard: walkthrough finished.");
      return;
    }
    await context.globalState.update(WALK_KEY, saved);
  }
}

function sessionsFor(
  saved: SavedWalk,
  mastery: { concept: string; mastery: number }[],
): SavedWalk["files"][] {
  const core = saved.files.filter((file) => file.core);
  const pool = core.length > 0 ? core : saved.files;
  const weakAverage = mastery.length === 0
    ? 0
    : mastery.reduce((sum, row) => sum + row.mastery, 0) / mastery.length;
  const size = weakAverage < MASTERY_OK ? 1 : 2;
  const groups: SavedWalk["files"][] = [];
  for (let i = 0; i < pool.length; i += size) {
    groups.push(pool.slice(i, i + size));
  }
  return groups.slice(0, 6);
}

function collapse(edits: AgentEdit[]): { path: string; snippet: string }[] {
  const byPath = new Map<string, string>();
  for (const edit of edits) {
    const path = edit.filePath.replace(/\\/g, "/");
    byPath.set(path, (byPath.get(path) ?? "") + "\n" + edit.snippet);
  }
  return [...byPath.entries()].map(([path, snippet]) => ({ path, snippet }));
}

function projectName(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.name;
  return folder ?? "this project";
}

export async function buildPrepSet(context: vscode.ExtensionContext, kind: "interview" | "exam"): Promise<void> {
  const weak = getMastery(context).slice().sort((a, b) => a.mastery - b.mastery).slice(0, 3);
  const hits = searchCode(context, weak.map((row) => row.concept).join(" ") || "main", 3);
  const questions = [];
  for (const hit of hits) {
    try {
      const question = await localGeneratedQuestion(hit.text, hit.path);
      if (!question) {
        continue;
      }
      questions.push({
        question: question.question,
        referenceAnswer: question.referenceAnswer,
        conceptTags: question.conceptTags,
        excerpt: hit.text.slice(0, 400),
        path: hit.path,
      });
    } catch {
      // Skip.
    }
  }
  if (questions.length === 0) {
    void vscode.window.showWarningMessage("Comprehension Guard: index the codebase before building a prep set.");
    return;
  }
  queuePrepSet(context, kind, projectName(), questions);
  void vscode.window.showInformationMessage(
    "Comprehension Guard: saved a " + kind + " prep set (" + questions.length + " questions). judge " + getJudgeConfigId(),
  );
}

export async function offerLoginRecall(context: vscode.ExtensionContext): Promise<void> {
  const due = dueConcepts(context);
  if (due.length === 0) {
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    "Review " + due[0].concept + "? It is due based on your last check.",
    "Review",
    "Later",
  );
  if (choice !== "Review") {
    return;
  }
  await runComprehensionGate(
    "Login recall with no code shown. Ask the student to explain this concept: " + due[0].concept,
    context,
    "",
    { source: "recall", recall: true },
  );
}

export function coreFiles(mapped: ProjectFile[]): ProjectFile[] {
  return mapped.filter((file) => file.core);
}
