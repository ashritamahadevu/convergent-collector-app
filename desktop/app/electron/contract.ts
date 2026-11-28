import type { ReviewEvent } from "../../../src/dashboard/protocol.js";
import type { ProjectSummary } from "../../../src/dashboard/views.js";
import type { HomeSummary } from "../../../src/dashboard/views.js";
export type { HomeSummary };
export type { ProjectSummary };

export type HistoryPage = { checks: ReviewEvent[]; limit: number; offset: number; projectId: string | null };
export type ProjectsPage = { projects: ProjectSummary[] };
export type ConnectionStatus = {
  schemaVersion: 1; extensionConnected: boolean;
  lastSeenAt: number | null; lastSyncedAt: number | null;
};
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export type Pagination = { limit: number; offset: number };
export type HistoryQuery = Pagination & { projectId?: string };
export interface DashboardBridge {
  readHome(): Promise<Result<HomeSummary>>;
  readHistory(query: HistoryQuery): Promise<Result<HistoryPage>>;
  readProjects(): Promise<Result<ProjectsPage>>;
  readStatus(): Promise<Result<ConnectionStatus>>;
}
