import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isRelativePath, isReviewEvent, isSettingsEvent } from "../../../src/dashboard/protocol.js";
import { isProjectId, isProjectSummary } from "../../../src/dashboard/views.js";
import type { ConnectionStatus, DueCard, GrowthPage, HistoryPage, HistoryQuery, HomeSummary, MapPage, ProjectsPage, RankReport, Result } from "./contract.js";
import type { SettingsEvent } from "../../../src/dashboard/protocol.js";

export function validPagination(value: unknown): value is HistoryQuery {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { limit, offset, projectId } = value as HistoryQuery;
  return Number.isInteger(limit) && limit >= 1 && limit <= 200 &&
    Number.isSafeInteger(offset) && offset >= 0 &&
    (projectId === undefined || isProjectId(projectId));
}

const timestamp = (v: unknown) => v === null || (Number.isSafeInteger(v) && (v as number) >= 0);

/** Talks to the standalone backend. That process remains the sole SQLite and token owner. */
export class DashboardClient {
  constructor(private readonly settings: { directory: string; port: number }) {}

  static fromEnvironment() {
    return new DashboardClient({
      directory: path.resolve(process.env.DRAWBRIDGE_DATA_DIR ?? path.join(os.homedir(), ".drawbridge")),
      port: Number(process.env.DRAWBRIDGE_PORT ?? 43821),
    });
  }

  private async request<T>(route: string, validate: (v: unknown) => v is T, body?: unknown): Promise<Result<T>> {
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
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
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

  readRank(): Promise<Result<RankReport>> {
    const stat = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
    return this.request("/v1/rank", (v): v is RankReport => {
      const rank = v as RankReport | null;
      return !!rank && ["peasant", "squire", "knight", "wizard", "king"].includes(rank.stage) &&
        typeof rank.frozen === "boolean" && !!rank.stats &&
        stat(rank.stats.iq) && stat(rank.stats.range) && stat(rank.stats.recall) &&
        stat(rank.stats.grit) && stat(rank.stats.streak) && stat(rank.stats.total) &&
        Number.isSafeInteger(rank.stats.followups) && rank.stats.followups >= 0;
    });
  }

  readDue(): Promise<Result<{ cards: DueCard[] }>> {
    return this.request("/v1/recall?due=now", (v): v is { cards: DueCard[] } => {
      const page = v as { cards?: DueCard[] } | null;
      return !!page && Array.isArray(page.cards) && page.cards.every((card) =>
        !!card && typeof card.concept === "string" && timestamp(card.dueAt) &&
        (card.topic === undefined || typeof card.topic === "string"));
    });
  }

  readGrowth(days: "7" | "30" | "all"): Promise<Result<GrowthPage>> {
    return this.request("/v1/growth?days=" + days, (v): v is GrowthPage => {
      const page = v as GrowthPage | null;
      return !!page && (page.days === 7 || page.days === 30 || page.days === null) &&
        Number.isSafeInteger(page.totalChecks) && Number.isSafeInteger(page.completedChecks) &&
        Array.isArray(page.points);
    });
  }

  readMap(): Promise<Result<MapPage>> {
    return this.request("/v1/map", (v): v is MapPage => {
      const page = v as MapPage | null;
      return !!page && Array.isArray(page.files) && Array.isArray(page.edges) &&
        page.files.every((file) => typeof file.path === "string" && typeof file.score === "number" &&
          ["understood", "in-progress", "not-yet", "skipped"].includes(file.status)) &&
        page.edges.every((edge) => typeof edge.fromPath === "string" && typeof edge.toPath === "string");
    });
  }

  readSettings(): Promise<Result<{ settings: SettingsEvent | null }>> {
    return this.request("/v1/settings", (v): v is { settings: SettingsEvent | null } => {
      const page = v as { settings?: unknown } | null;
      return !!page && (page.settings === null || isSettingsEvent(page.settings));
    });
  }

  writeSettings(event: unknown): Promise<Result<{ eventId: string }>> {
    if (!isSettingsEvent(event)) return Promise.resolve({ ok: false, error: "Those settings are not valid." });
    return this.request("/v1/events", (v): v is { eventId: string } => {
      const ack = v as { eventId?: unknown } | null;
      return !!ack && ack.eventId === event.eventId;
    }, event);
  }
}
