import type { ReviewEvent } from "../../../src/dashboard/protocol.js";
import type { HomeSummary, ProjectSummary } from "../../../src/dashboard/views.js";
import type { RankStage, RankStats } from "../../../src/dashboard/rank.js";
import type { SettingsEvent } from "../../../src/dashboard/protocol.js";
import type { UnderstandStatus } from "../../../src/memory/understanding.js";

export type { HomeSummary, ProjectSummary };
export type RankReport = { stage: RankStage; stats: RankStats; frozen: boolean };
export type DueCard = { concept: string; topic?: string; dueAt: number };
export type GrowthPage = {
  days: 7 | 30 | null;
  totalChecks: number;
  completedChecks: number;
  bypassedChecks: number;
  averageScoreOutOfFive: number | null;
  firstTry: { completedChecks: number; averageScoreOutOfFive: number | null };
  points: { eventId: string; timestamp: number; scoreOutOfFive: number }[];
};
export type MapFile = { path: string; status: UnderstandStatus; score: number; core: boolean };
export type MapEdge = { fromPath: string; toPath: string; kind: string };
export type MapPage = { files: MapFile[]; edges: MapEdge[] };

export type HistoryPage = { checks: ReviewEvent[]; limit: number; offset: number; projectId: string | null };
export type ProjectsPage = { projects: ProjectSummary[] };
export type ConnectionStatus = {
  schemaVersion: 1; extensionConnected: boolean;
  lastSeenAt: number | null; lastSyncedAt: number | null;
};
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export type Pagination = { limit: number; offset: number };
export type HistoryQuery = Pagination & { projectId?: string };
export type UpdatePhase = "downloading" | "ready" | "error";
export type UpdateStatus = {
  phase: UpdatePhase;
  version: string | null;
  message: string | null;
};
export interface DashboardBridge {
  readHome(): Promise<Result<HomeSummary>>;
  readHistory(query: HistoryQuery): Promise<Result<HistoryPage>>;
  readProjects(): Promise<Result<ProjectsPage>>;
  readStatus(): Promise<Result<ConnectionStatus>>;
  readRank(): Promise<Result<RankReport>>;
  readDue(): Promise<Result<{ cards: DueCard[] }>>;
  readGrowth(days: "7" | "30" | "all"): Promise<Result<GrowthPage>>;
  readMap(): Promise<Result<MapPage>>;
  readSettings(): Promise<Result<{ settings: SettingsEvent | null }>>;
  writeSettings(event: unknown): Promise<Result<{ eventId: string }>>;
  openRecall(topic: string): Promise<Result<null>>;
  readUpdateStatus(): Promise<UpdateStatus | null>;
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
  installUpdate(): Promise<Result<null>>;
}
