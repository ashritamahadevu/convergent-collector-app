import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isRelativePath, isReviewEvent } from "../../../src/dashboard/protocol.js";
import { isProjectId, isProjectSummary } from "../../../src/dashboard/views.js";
import type { ConnectionStatus, HistoryPage, HistoryQuery, HomeSummary, ProjectsPage, Result } from "./contract.js";

export function validPagination(value: unknown): value is HistoryQuery {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { limit, offset, projectId } = value as HistoryQuery;
  return Number.isInteger(limit) && limit >= 1 && limit <= 200 &&
    Number.isSafeInteger(offset) && offset >= 0 &&
    (projectId === undefined || isProjectId(projectId));
}

const timestamp = (v: unknown) => v === null || (Number.isSafeInteger(v) && (v as number) >= 0);

/** Read-only client. The standalone backend remains the sole SQLite/token owner. */
export class DashboardClient {
  constructor(private readonly settings: { directory: string; port: number }) {}

  static fromEnvironment() {
    return new DashboardClient({
      directory: path.resolve(process.env.DRAWBRIDGE_DATA_DIR ?? path.join(os.homedir(), ".drawbridge")),
      port: Number(process.env.DRAWBRIDGE_PORT ?? 43821),
    });
  }

  private async request<T>(route: string, validate: (v: unknown) => v is T): Promise<Result<T>> {
    if (!Number.isInteger(this.settings.port) || this.settings.port < 1 || this.settings.port > 65535) {
      return { ok: false, error: "Invalid DRAWBRIDGE_PORT. Use the same port as the standalone backend, then restart the desktop app." };
    }
    let token: string;
    try { token = (await fs.readFile(path.join(this.settings.directory, "pairing-token"), "utf8")).trim(); }
    catch { return { ok: false, error: "Pairing configuration unavailable. Start the standalone backend with npm.cmd run start:dashboard. If using DRAWBRIDGE_DATA_DIR, set it to the same folder in both terminals, then restart the desktop app." }; }
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return { ok: false, error: "The existing pairing-token file is invalid. Check the backend configuration; the desktop app will not replace this file." };
    }
    try {
      const response = await fetch(`http://127.0.0.1:${this.settings.port}${route}`, {
        headers: { Authorization: `Bearer ${token}` }, redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: "Pairing was rejected. Check that both terminals use the same DRAWBRIDGE_DATA_DIR and DRAWBRIDGE_PORT. The existing token has not been changed." };
      }
      if (response.status === 404 && (route === "/v1/projects" || route === "/v1/home")) {
        return { ok: false, error: "This backend does not support " + (route === "/v1/home" ? "Home summaries" : "project summaries") + " yet. Stop it, run npm.cmd run start:dashboard from the updated repository, then Refresh." };
      }
      if (!response.ok) return { ok: false, error: `The local backend returned HTTP ${response.status}. Check its terminal, then Refresh.` };
      const value: unknown = await response.json();
      if (!validate(value)) return { ok: false, error: "The backend response is incompatible with this desktop version. Rebuild and restart the backend and desktop app from the same checkout." };
      return { ok: true, data: value };
    } catch {
      // Never return raw exceptions, response bodies or authorization headers to React.
      return { ok: false, error: "Local backend unavailable or timed out. Keep npm.cmd run start:dashboard running in another terminal, check the port settings, then Refresh." };
    }
  }

  readHistory(value: unknown): Promise<Result<HistoryPage>> {
    if (!validPagination(value)) return Promise.resolve({ ok: false, error: "Invalid history pagination." });
    const { limit, offset, projectId } = value;
    const filter = projectId === undefined ? "" : "&projectId=" + encodeURIComponent(projectId);
    return this.request(`/v1/history?limit=${limit}&offset=${offset}${filter}`, (v): v is HistoryPage => {
      const p = v as HistoryPage | null;
      return !!p && p.limit === limit && p.offset === offset && p.projectId === (projectId ?? null) && Array.isArray(p.checks) &&
        p.checks.length <= limit && p.checks.every(e => isReviewEvent(e) && (projectId === undefined || e.project.id === projectId));
    });
  }

  readProjects(): Promise<Result<ProjectsPage>> {
    return this.request("/v1/projects", (v): v is ProjectsPage => {
      const p = v as ProjectsPage | null;
      return !!p && Array.isArray(p.projects) && p.projects.every(isProjectSummary) &&
        new Set(p.projects.map(project => project.id)).size === p.projects.length;
    });
  }

  readHome(): Promise<Result<HomeSummary>> {
    return this.request("/v1/home", (v): v is HomeSummary => {
      const h = v as HomeSummary | null;
      return !!h && Array.isArray(h.recentChecks) && h.recentChecks.length <= 3 &&
        h.recentChecks.every(isReviewEvent) &&
        Array.isArray(h.weakPoints) && h.weakPoints.length <= 3 &&
        h.weakPoints.every(w => !!w && typeof w.concept === "string" && w.concept.trim().length > 0 &&
          w.concept.length <= 200 && Number.isFinite(w.averageScore) && w.averageScore >= 0 && w.averageScore <= 1 &&
          Number.isSafeInteger(w.scoredChecks) && w.scoredChecks > 0 &&
          (w.filePath === null || (typeof w.filePath === "string" && isRelativePath(w.filePath))) &&
          !!w.project && isProjectId(w.project.id) && typeof w.project.name === "string" && w.project.name.length <= 500) &&
        new Set(h.weakPoints.map(w => w.concept)).size === h.weakPoints.length &&
        new Set(h.recentChecks.map(e => e.eventId)).size === h.recentChecks.length;
    });
  }

  readStatus(): Promise<Result<ConnectionStatus>> {
    return this.request("/v1/status", (v): v is ConnectionStatus => {
      const s = v as ConnectionStatus | null;
      return !!s && s.schemaVersion === 1 && typeof s.extensionConnected === "boolean" &&
        timestamp(s.lastSeenAt) && timestamp(s.lastSyncedAt);
    });
  }
}
