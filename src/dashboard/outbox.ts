import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { isCheckEvent, localEndpoint, type CheckEvent } from "./protocol";

class RejectedEvent extends Error {}

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

  async quarantined(): Promise<{ file: string; reason: string }[]> {
    const directory = path.join(this.directory, "quarantine");
    let names: string[];
    try { names = (await fs.readdir(directory)).filter(n => n.endsWith(".json")).sort(); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
    return Promise.all(names.map(async file => ({ file, reason: await fs.readFile(path.join(directory, file + ".reason"), "utf8").catch(() => "Reason unavailable") })));
  }

  private async quarantine(name: string, reason: string): Promise<void> {
    const directory = path.join(this.directory, "quarantine");
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    // Unique destinations retain every rejected version, including reused IDs.
    const target = path.join(directory, name.slice(0, -5).slice(0, 100) + "-" + randomUUID() + ".json");
    await fs.writeFile(target + ".reason", reason, { mode: 0o600 });
    try { await fs.rename(path.join(this.directory, name), target); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; await fs.unlink(target + ".reason"); }
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
        if (!response.ok) {
          const ErrorType = route === "/v1/events" && [400, 409, 413, 415, 422].includes(response.status) ? RejectedEvent : Error;
          throw new ErrorType("Dashboard returned HTTP " + response.status);
        }
        let ack: unknown;
        try { ack = await response.json(); }
        catch (e) { if (route === "/v1/events" && e instanceof SyntaxError) throw new RejectedEvent("Invalid acknowledgement JSON"); throw e; }
        return ack;
      };
      await send("/v1/heartbeat", {}, initial);
      this.connected = true;
      for (const name of await this.pending()) {
        // Re-check opt-in between events so disabling stops delivery.
        const settings = await connection();
        if (!settings) { this.connected = false; return; }
        const file = path.join(this.directory, name);
        try {
          let event: unknown;
          try { event = JSON.parse(await fs.readFile(file, "utf8")); }
          catch (e) { if (e instanceof SyntaxError) throw new RejectedEvent("Invalid queued JSON"); throw e; }
          if (!isCheckEvent(event)) throw new RejectedEvent("Invalid queued dashboard event");
          const ack = await send("/v1/events", event, settings);
          if (!ack || typeof ack !== "object" || !("eventId" in ack) || ack.eventId !== event.eventId) throw new RejectedEvent("Dashboard did not acknowledge this event");
          await fs.unlink(file).catch(e => { if (e.code !== "ENOENT") throw e; });
          this.lastSyncedAt = Date.now();
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
          if (e instanceof RejectedEvent) { await this.quarantine(name, e.message); continue; }
          // Connectivity/auth/storage failures stay pending; retry when fixed.
          throw new Error(name + ": " + (e instanceof Error ? e.message : "Delivery failed"));
        }
      }
      this.lastError = null;
    } catch (e) {
      this.connected = false;
      this.lastError = e instanceof Error ? e.message : "Dashboard unavailable";
    }
  }
}
