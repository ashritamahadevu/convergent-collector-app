import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isCheckEvent, localEndpoint, type CheckEvent } from "./protocol";

/** One file per event: separate VS Code windows cannot overwrite each other's queues. */
export class DashboardOutbox {
  private running?: Promise<void>;
  lastSyncedAt: number | null = null;
  lastError: string | null = null;
  connected = false;
  constructor(readonly directory: string) {}

  async enqueue(event: CheckEvent): Promise<void> {
    if (!isCheckEvent(event) || !/^[a-zA-Z0-9-]+$/.test(event.eventId)) throw new Error("Invalid dashboard event");
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = path.join(this.directory, event.eventId + ".json");
    const temporary = target + ".tmp";
    await fs.writeFile(temporary, JSON.stringify(event), { mode: 0o600 });
    await fs.rename(temporary, target);
  }

  async pending(): Promise<string[]> {
    try { return (await fs.readdir(this.directory)).filter(n => n.endsWith(".json")).sort(); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
  }

  flush(connection: () => Promise<{ endpoint: string; token: string } | null>): Promise<void> {
    if (this.running) return this.running;
    this.running = this.drain(connection).finally(() => { this.running = undefined; });
    return this.running;
  }

  private async drain(connection: () => Promise<{ endpoint: string; token: string } | null>): Promise<void> {
    try {
      const initial = await connection();
      if (!initial) { this.connected = false; return; }
      const send = async (route: string, body: unknown, settings: typeof initial) => {
        const response = await fetch(localEndpoint(settings.endpoint) + route, {
          method: "POST", redirect: "error",
          headers: { Authorization: "Bearer " + settings.token, "Content-Type": "application/json" },
          body: JSON.stringify(body), signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) throw new Error("Dashboard returned HTTP " + response.status);
        return await response.json() as { eventId?: string };
      };
      await send("/v1/heartbeat", {}, initial);
      this.connected = true;
      for (const name of await this.pending()) {
        // Re-check opt-in between events so disabling stops delivery.
        const settings = await connection();
        if (!settings) { this.connected = false; return; }
        const file = path.join(this.directory, name);
        let event: unknown;
        try { event = JSON.parse(await fs.readFile(file, "utf8")); }
        catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") continue; throw e; }
        if (!isCheckEvent(event)) throw new Error("Invalid queued dashboard event; retained for inspection.");
        const ack = await send("/v1/events", event, settings);
        if (ack.eventId !== event.eventId) throw new Error("Dashboard did not acknowledge this event.");
        await fs.unlink(file).catch(e => { if (e.code !== "ENOENT") throw e; });
        this.lastSyncedAt = Date.now();
      }
      this.lastError = null;
    } catch (e) {
      this.connected = false;
      this.lastError = e instanceof Error ? e.message : "Dashboard unavailable";
    }
  }
}
