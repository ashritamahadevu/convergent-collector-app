import { isCheckEvent, type CheckEvent } from "../../src/dashboard/protocol";

// node:sqlite is deliberately confined to the desktop backend (Node >=22.13).
// The extension's Node 20 typings/runtime do not need SQLite.
interface Statement { run(...args: (string | number | null)[]): unknown; all(...args: (string | number)[]): Record<string, unknown>[]; get(...args: (string | number)[]): Record<string, unknown> | undefined }
interface Database { exec(sql: string): void; prepare(sql: string): Statement; close(): void }
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (file: string) => Database };

export class DashboardDatabase {
  private db: Database;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS checks (
        event_id TEXT PRIMARY KEY, occurred_at INTEGER NOT NULL,
        received_at INTEGER NOT NULL, event_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS checks_time ON checks(occurred_at);
      PRAGMA user_version=1;`);
  }
  insert(event: CheckEvent): void {
    if (!isCheckEvent(event)) throw new Error("Invalid event");
    const old = this.db.prepare("SELECT event_json FROM checks WHERE event_id=?").get(event.eventId);
    if (old && old.event_json !== JSON.stringify(event)) throw new Error("Event ID already has different data");
    this.db.prepare("INSERT OR IGNORE INTO checks VALUES (?, ?, ?, ?)")
      .run(event.eventId, event.occurredAt, Date.now(), JSON.stringify(event));
  }
  history(limit = 50, offset = 0): CheckEvent[] {
    return this.db.prepare("SELECT event_json FROM checks ORDER BY occurred_at DESC, event_id DESC LIMIT ? OFFSET ?")
      .all(limit, offset).map(r => JSON.parse(r.event_json as string));
  }
  growth(days: 7 | 30 | null, now = Date.now()) {
    const since = days === null ? 0 : now - days * 86400000;
    const events: CheckEvent[] = this.db.prepare("SELECT event_json FROM checks WHERE occurred_at>=? AND occurred_at<=? ORDER BY occurred_at")
      .all(since, now).map(r => JSON.parse(r.event_json as string));
    const scored = events.filter(e => e.check.score !== null);
    return {
      days, totalChecks: events.length, completedChecks: scored.length,
      bypassedChecks: events.filter(e => e.check.outcome === "bypass").length,
      averageScoreOutOfFive: scored.length ? scored.reduce((s, e) => s + e.check.score! * 5, 0) / scored.length : null,
      points: scored.map(e => ({ eventId: e.eventId, timestamp: e.occurredAt, scoreOutOfFive: e.check.score! * 5 })),
    };
  }
  get lastReceivedAt(): number | null {
    return (this.db.prepare("SELECT MAX(received_at) AS at FROM checks").get()?.at as number | null) ?? null;
  }
  close(): void { this.db.close(); }
}
