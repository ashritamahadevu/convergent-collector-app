import type { ReviewEvent } from "../../../src/dashboard/protocol.js";

export type HistoryPage = { checks: ReviewEvent[]; limit: number; offset: number };
export type ConnectionStatus = {
  schemaVersion: 1; extensionConnected: boolean;
  lastSeenAt: number | null; lastSyncedAt: number | null;
};
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export type Pagination = { limit: number; offset: number };
export interface DashboardBridge {
  readHistory(pagination: Pagination): Promise<Result<HistoryPage>>;
  readStatus(): Promise<Result<ConnectionStatus>>;
}
