import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isReviewEvent } from "../../../src/dashboard/protocol.js";
import type { ConnectionStatus, HistoryPage, Pagination, Result } from "./contract.js";

export function validPagination(value: unknown): value is Pagination {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { limit, offset } = value as Pagination;
  return Number.isInteger(limit) && limit >= 1 && limit <= 200 &&
    Number.isSafeInteger(offset) && offset >= 0;
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
      if (!response.ok) return { ok: false, error: `The local backend returned HTTP ${response.status}. Check its terminal, then Refresh.` };
      const value: unknown = await response.json();
      if (!validate(value)) return { ok: false, error: "The backend response is incompatible with this desktop version. Rebuild the backend and desktop app from the same checkout." };
      return { ok: true, data: value };
    } catch {
      // Never return raw exceptions, response bodies or authorization headers to React.
      return { ok: false, error: "Local backend unavailable or timed out. Keep npm.cmd run start:dashboard running in another terminal, check the port settings, then Refresh." };
    }
  }

  readHistory(value: unknown): Promise<Result<HistoryPage>> {
    if (!validPagination(value)) return Promise.resolve({ ok: false, error: "Invalid history pagination." });
    const { limit, offset } = value;
    return this.request(`/v1/history?limit=${limit}&offset=${offset}`, (v): v is HistoryPage => {
      const p = v as HistoryPage | null;
      return !!p && p.limit === limit && p.offset === offset && Array.isArray(p.checks) &&
        p.checks.length <= limit && p.checks.every(isReviewEvent);
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
