import type { ConceptMastery, FileKnowledge, RecallCard } from "../types";
import { retrievability } from "./scheduler";

export type UnderstandStatus = "understood" | "in-progress" | "not-yet" | "skipped";

export type FileUnderstanding = {
  path: string;
  core: boolean;
  complexity: number;
  centrality: number;
  status: UnderstandStatus;
  score: number;
};

export function fileUnderstanding(
  files: FileKnowledge[],
  mastery: ConceptMastery[],
  cards: RecallCard[],
  now: number,
): FileUnderstanding[] {
  const byConcept = new Map(mastery.map((row) => [row.concept, row]));
  const byCard = new Map(cards.map((row) => [row.concept, row]));
  return files.map((file) => {
    const core = file.core !== false;
    if (!core) {
      return {
        path: file.path,
        core: false,
        complexity: file.complexity ?? 0,
        centrality: file.centrality ?? 0,
        status: "skipped",
        score: 0,
      };
    }
    const scores = file.concepts.map((concept) => {
      const known = byConcept.get(concept)?.mastery ?? 0;
      const card = byCard.get(concept);
      const recall = card ? retrievability(card, now) : 1;
      return known * recall;
    });
    const score = scores.length === 0 ? (file.passed ? 0.5 : 0) : scores.reduce((sum, value) => sum + value, 0) / scores.length;
    const status: UnderstandStatus = score >= 0.75 ? "understood" : score >= 0.35 ? "in-progress" : "not-yet";
    return {
      path: file.path,
      core: true,
      complexity: file.complexity ?? 0,
      centrality: file.centrality ?? 0,
      status,
      score,
    };
  });
}
