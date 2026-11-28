import {
  isDashboardEvent,
  isFileEdgesEvent,
  isFileEvent,
  isMasteryEvent,
  isPrepSetEvent,
  isProfileEvent,
  isRecallEvent,
  isReviewEvent,
  isSettingsEvent,
  type DashboardEvent,
  type ReviewEvent,
} from "../../src/dashboard/protocol";
import type { HomeSummary, ProjectSummary, WeakPoint } from "../../src/dashboard/views";
import { fileUnderstanding } from "../../src/memory/understanding";
import { settleRank, weekKey, rankStats, type RankSnapshot, type RankStage } from "../../src/dashboard/rank";
import type { ConceptMastery, FileKnowledge, RecallCard } from "../../src/types";

// node:sqlite is deliberately confined to the desktop backend (Node >=22.13).
interface Statement { run(...args: (string | number | null)[]): unknown; all(...args: (string | number)[]): Record<string, unknown>[]; get(...args: (string | number)[]): Record<string, unknown> | undefined }
interface Database { exec(sql: string): void; prepare(sql: string): Statement; close(): void }
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (file: string) => Database };

export class DashboardDatabase {
  private db: Database;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS review_events (
        event_id TEXT PRIMARY KEY, occurred_at INTEGER NOT NULL,
        received_at INTEGER NOT NULL, event_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS review_time ON review_events(occurred_at);
      CREATE TABLE IF NOT EXISTS concept_mastery (
        installation_id TEXT NOT NULL, concept TEXT NOT NULL,
        last_seen INTEGER NOT NULL, event_json TEXT NOT NULL,
        PRIMARY KEY (installation_id, concept));
      CREATE TABLE IF NOT EXISTS recall_cards (
        installation_id TEXT NOT NULL, concept TEXT NOT NULL,
        due_at INTEGER NOT NULL, last_review INTEGER NOT NULL, event_json TEXT NOT NULL,
        PRIMARY KEY (installation_id, concept));
      CREATE TABLE IF NOT EXISTS file_knowledge (
        installation_id TEXT NOT NULL, path TEXT NOT NULL,
        updated_at INTEGER NOT NULL, event_json TEXT NOT NULL,
        PRIMARY KEY (installation_id, path));
      CREATE TABLE IF NOT EXISTS file_edges (
        installation_id TEXT NOT NULL, from_path TEXT NOT NULL,
        to_path TEXT NOT NULL, kind TEXT NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (installation_id, from_path, to_path, kind));
      CREATE TABLE IF NOT EXISTS profiles (
        installation_id TEXT PRIMARY KEY, updated_at INTEGER NOT NULL, event_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS prep_sets (
        event_id TEXT PRIMARY KEY, occurred_at INTEGER NOT NULL, event_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (
        installation_id TEXT PRIMARY KEY, updated_at INTEGER NOT NULL, event_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rank_state (
        id TEXT PRIMARY KEY, stage TEXT NOT NULL, week TEXT NOT NULL,
        missed_json TEXT NOT NULL, stats_json TEXT NOT NULL);
      PRAGMA user_version=4;`);
  }

  insert(event: DashboardEvent): void {
    if (!isDashboardEvent(event)) throw new Error("Invalid event");
    if (isReviewEvent(event)) this.insertReview(event);
    else if (isMasteryEvent(event)) this.upsertLatest("concept_mastery", "last_seen", event.lastSeen, event.installationId, event.concept, event);
    else if (isRecallEvent(event)) this.upsertRecall(event);
    else if (isFileEvent(event)) this.upsertLatest("file_knowledge", "updated_at", event.updatedAt, event.installationId, event.path, event);
    else if (isFileEdgesEvent(event)) this.replaceEdges(event);
    else if (isProfileEvent(event)) this.upsertProfile(event);
    else if (isPrepSetEvent(event)) this.insertPrep(event);
    else if (isSettingsEvent(event)) this.upsertSettings(event);
    else throw new Error("Invalid event");
  }

  private insertReview(event: ReviewEvent): void {
    const old = this.db.prepare("SELECT event_json FROM review_events WHERE event_id=?").get(event.eventId);
    if (old && old.event_json !== JSON.stringify(event)) throw new Error("Event ID already has different data");
    this.db.prepare("INSERT OR IGNORE INTO review_events VALUES (?, ?, ?, ?)")
      .run(event.eventId, event.occurredAt, Date.now(), JSON.stringify(event));
  }

  private upsertLatest(table: string, stamp: string, incoming: number, installation: string, key: string, event: DashboardEvent): void {
    const column = table === "file_knowledge" ? "path" : "concept";
    const old = this.db.prepare(`SELECT ${stamp} AS stamp FROM ${table} WHERE installation_id=? AND ${column}=?`).get(installation, key);
    if (old && Number(old.stamp) > incoming) return;
    this.db.prepare(`INSERT INTO ${table} (installation_id, ${column}, ${stamp}, event_json) VALUES (?, ?, ?, ?)
      ON CONFLICT(installation_id, ${column}) DO UPDATE SET ${stamp}=excluded.${stamp}, event_json=excluded.event_json`)
      .run(installation, key, incoming, JSON.stringify(event));
  }

  private upsertRecall(event: Extract<DashboardEvent, { type: "recall.updated" }>): void {
    const old = this.db.prepare("SELECT last_review AS stamp FROM recall_cards WHERE installation_id=? AND concept=?").get(event.installationId, event.concept);
    if (old && Number(old.stamp) > event.lastReview) return;
    this.db.prepare(`INSERT INTO recall_cards (installation_id, concept, due_at, last_review, event_json) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(installation_id, concept) DO UPDATE SET due_at=excluded.due_at, last_review=excluded.last_review, event_json=excluded.event_json`)
      .run(event.installationId, event.concept, event.dueAt, event.lastReview, JSON.stringify(event));
  }

  private replaceEdges(event: Extract<DashboardEvent, { type: "file.edges" }>): void {
    this.db.prepare("DELETE FROM file_edges WHERE installation_id=? AND from_path=?").run(event.installationId, event.fromPath);
    const insert = this.db.prepare("INSERT INTO file_edges VALUES (?, ?, ?, ?, ?)");
    for (const edge of event.edges) {
      insert.run(event.installationId, event.fromPath, edge.toPath, edge.kind, event.occurredAt);
    }
  }

  private upsertProfile(event: Extract<DashboardEvent, { type: "profile.updated" }>): void {
    const old = this.db.prepare("SELECT updated_at AS stamp FROM profiles WHERE installation_id=?").get(event.installationId);
    if (old && Number(old.stamp) > event.occurredAt) return;
    this.db.prepare(`INSERT INTO profiles (installation_id, updated_at, event_json) VALUES (?, ?, ?)
      ON CONFLICT(installation_id) DO UPDATE SET updated_at=excluded.updated_at, event_json=excluded.event_json`)
      .run(event.installationId, event.occurredAt, JSON.stringify(event));
  }

  private upsertSettings(event: Extract<DashboardEvent, { type: "settings.updated" }>): void {
    const old = this.db.prepare("SELECT updated_at AS stamp FROM settings WHERE installation_id=?").get(event.installationId);
    if (old && Number(old.stamp) > event.updatedAt) return;
    this.db.prepare(`INSERT INTO settings (installation_id, updated_at, event_json) VALUES (?, ?, ?)
      ON CONFLICT(installation_id) DO UPDATE SET updated_at=excluded.updated_at, event_json=excluded.event_json`)
      .run(event.installationId, event.updatedAt, JSON.stringify(event));
  }

  private insertPrep(event: Extract<DashboardEvent, { type: "prepset.created" }>): void {
    const old = this.db.prepare("SELECT event_json FROM prep_sets WHERE event_id=?").get(event.eventId);
    if (old && old.event_json !== JSON.stringify(event)) throw new Error("Event ID already has different data");
    this.db.prepare("INSERT OR IGNORE INTO prep_sets VALUES (?, ?, ?)").run(event.eventId, event.occurredAt, JSON.stringify(event));
  }

  history(limit = 50, offset = 0, projectId?: string): ReviewEvent[] {
    if (projectId !== undefined) {
      return this.db.prepare("SELECT event_json FROM review_events WHERE json_extract(event_json, '$.project.id')=? ORDER BY occurred_at DESC, event_id DESC LIMIT ? OFFSET ?")
        .all(projectId, limit, offset).map(r => JSON.parse(r.event_json as string));
    }
    return this.db.prepare("SELECT event_json FROM review_events ORDER BY occurred_at DESC, event_id DESC LIMIT ? OFFSET ?")
      .all(limit, offset).map(r => JSON.parse(r.event_json as string));
  }

  /** Aggregate every saved review, independently of History pagination. */
  projects(): ProjectSummary[] {
    const rows = this.db.prepare(`WITH reviews AS (
      SELECT event_id, occurred_at,
        json_extract(event_json, '$.project.id') AS project_id,
        json_extract(event_json, '$.project.name') AS project_name,
        json_extract(event_json, '$.score') AS score
      FROM review_events
    ), latest AS (
      SELECT project_id, project_name,
        ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY occurred_at DESC, event_id DESC) AS position
      FROM reviews
    )
    SELECT r.project_id, l.project_name, MAX(r.occurred_at) AS last_activity,
      COUNT(*) AS total, COUNT(r.score) AS scored, AVG(r.score) * 5 AS average
    FROM reviews r JOIN latest l ON r.project_id=l.project_id AND l.position=1
    GROUP BY r.project_id, l.project_name
    ORDER BY last_activity DESC, r.project_id ASC`).all();
    return rows.map(row => ({
      id: String(row.project_id), name: String(row.project_name),
      lastActivityAt: Number(row.last_activity), totalChecks: Number(row.total),
      scoredChecks: Number(row.scored), unscoredChecks: Number(row.total) - Number(row.scored),
      averageScoreOutOfFive: row.average === null ? null : Number(row.average),
    }));
  }

  growth(days: 7 | 30 | null, now = Date.now()) {
    const since = days === null ? 0 : now - days * 86400000;
    const events: ReviewEvent[] = this.db.prepare("SELECT event_json FROM review_events WHERE occurred_at>=? AND occurred_at<=? ORDER BY occurred_at")
      .all(since, now).map(r => JSON.parse(r.event_json as string));
    const summarize = (rows: ReviewEvent[]) => {
      const scored = rows.filter(e => e.score !== null);
      return {
        totalChecks: rows.length,
        completedChecks: scored.length,
        bypassedChecks: rows.filter(e => e.outcome === "bypass").length,
        averageScoreOutOfFive: scored.length ? scored.reduce((s, e) => s + e.score! * 5, 0) / scored.length : null,
        points: scored.map(e => ({ eventId: e.eventId, timestamp: e.occurredAt, scoreOutOfFive: e.score! * 5 })),
      };
    };
    const all = summarize(events);
    const first = summarize(events.filter(e => e.retries === 0));
    return { days, ...all, firstTry: { completedChecks: first.completedChecks, averageScoreOutOfFive: first.averageScoreOutOfFive } };
  }

  home(): HomeSummary {
    // DISTINCT prevents duplicate tags on a question from counting twice.
    const rows = this.db.prepare(`WITH evidence AS (
      SELECT DISTINCT r.event_id, r.occurred_at, tag.value AS concept,
        json_extract(r.event_json, '$.score') AS score,
        json_extract(r.event_json, '$.filePath') AS file_path,
        json_extract(r.event_json, '$.project.id') AS project_id,
        json_extract(r.event_json, '$.project.name') AS project_name
      FROM review_events r, json_each(r.event_json, '$.concepts') tag
      WHERE json_extract(r.event_json, '$.score') IS NOT NULL
        AND tag.type='text' AND trim(tag.value)<>''
    ), representative AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY concept
        ORDER BY (file_path IS NULL) ASC, occurred_at DESC, event_id DESC) AS position
      FROM evidence
    ), averages AS (
      SELECT concept, AVG(score) AS average, COUNT(*) AS samples FROM evidence GROUP BY concept
    )
    SELECT a.concept, a.average, a.samples, r.file_path, r.project_id, r.project_name
    FROM averages a JOIN representative r ON r.concept=a.concept AND r.position=1
    ORDER BY a.average ASC, a.samples DESC, a.concept ASC LIMIT 3`).all();
    const weakPoints: WeakPoint[] = rows.map(row => ({
      concept: String(row.concept), averageScore: Number(row.average), scoredChecks: Number(row.samples),
      filePath: row.file_path === null ? null : String(row.file_path),
      project: { id: String(row.project_id), name: String(row.project_name) },
    }));
    return { recentChecks: this.history(3), weakPoints };
  }

  mastery(): unknown[] { return this.rows("concept_mastery"); }
  recall(dueNow?: number): unknown[] {
    const rows = this.rows("recall_cards") as { dueAt: number }[];
    return dueNow === undefined ? rows : rows.filter(row => row.dueAt <= dueNow);
  }
  files(): unknown[] { return this.rows("file_knowledge"); }
  edges(): { fromPath: string; toPath: string; kind: string }[] {
    return this.db.prepare("SELECT from_path, to_path, kind FROM file_edges ORDER BY from_path, to_path").all()
      .map(row => ({ fromPath: String(row.from_path), toPath: String(row.to_path), kind: String(row.kind) }));
  }
  profile(): unknown | null {
    const row = this.db.prepare("SELECT event_json FROM profiles LIMIT 1").get();
    return row ? JSON.parse(row.event_json as string) : null;
  }
  prepSets(): unknown[] { return this.rows("prep_sets"); }
  settings(): unknown | null {
    const row = this.db.prepare("SELECT event_json FROM settings LIMIT 1").get();
    return row ? JSON.parse(row.event_json as string) : null;
  }

  rank(now = Date.now()) {
    const reviews = this.history(10000, 0);
    const mastery = (this.mastery() as { mastery?: number }[]).map((row) => Number(row.mastery)).filter((value) => Number.isFinite(value));
    const recall = (this.recall() as { lastReview?: number; stability?: number; topic?: string }[]).map((row) => ({
      lastReview: Number(row.lastReview) || 0,
      stability: Number(row.stability) || 0.1,
      topic: row.topic,
    }));
    const stats = rankStats({
      mastery,
      recall,
      reviews: reviews.map((review) => ({
        groupId: review.groupId, occurredAt: review.occurredAt, outcome: review.outcome, source: review.source,
      })),
      now,
    });
    const week = weekKey(now);
    const active = reviews.some((review) => weekKey(review.occurredAt) === week);
    const stored = this.rankSnapshot();
    const settled = settleRank(stored, stats, week, active);
    const shown = !active && stored ? stored.stats : stats;
    if (settled.snapshot) {
      this.db.prepare(`INSERT INTO rank_state (id, stage, week, missed_json, stats_json) VALUES ('local', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET stage=excluded.stage, week=excluded.week, missed_json=excluded.missed_json, stats_json=excluded.stats_json`)
        .run(settled.snapshot.stage, settled.snapshot.week, JSON.stringify(settled.snapshot.missed), JSON.stringify(settled.snapshot.stats));
    }
    return { stage: settled.stage, stats: shown, frozen: !active && !!stored };
  }

  map(now = Date.now()) {
    const files = this.files() as FileKnowledge[];
    const mastery = this.mastery() as ConceptMastery[];
    const cards = (this.recall() as RecallCard[]);
    return { files: fileUnderstanding(files, mastery, cards, now), edges: this.edges() };
  }

  private rankSnapshot(): RankSnapshot | null {
    const row = this.db.prepare("SELECT stage, week, missed_json, stats_json FROM rank_state WHERE id='local'").get();
    if (!row) return null;
    return {
      stage: String(row.stage) as RankStage,
      week: String(row.week),
      missed: JSON.parse(String(row.missed_json)),
      stats: JSON.parse(String(row.stats_json)),
    };
  }

  /** Questions from one edit, with how many graded answers passed. */
  checks(): { groupId: string; asked: number; passed: number; filePath: string | null }[] {
    const events = this.history(1000, 0);
    const groups = new Map<string, { asked: number; passed: number; filePath: string | null }>();
    for (const event of events) {
      const graded = event.score !== null;
      const current = groups.get(event.groupId) ?? { asked: 0, passed: 0, filePath: event.filePath };
      if (graded) {
        current.asked += 1;
        if (event.outcome === "pass" || event.outcome === "disputed") current.passed += 1;
      }
      if (!current.filePath) current.filePath = event.filePath;
      groups.set(event.groupId, current);
    }
    return [...groups.entries()].map(([groupId, group]) => ({ groupId, ...group }));
  }

  private rows(table: string): unknown[] {
    return this.db.prepare(`SELECT event_json FROM ${table}`).all().map(row => JSON.parse(row.event_json as string));
  }

  get lastReceivedAt(): number | null {
    return (this.db.prepare("SELECT MAX(received_at) AS at FROM review_events").get()?.at as number | null) ?? null;
  }
  close(): void {
    try { this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* Already closing. */ }
    this.db.close();
  }
}
