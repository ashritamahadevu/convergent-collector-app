import * as http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { isDashboardEvent } from "../../src/dashboard/protocol";
import { DashboardDatabase } from "./database";
import { isProjectId } from "../../src/dashboard/views";

export async function startDashboardBackend(options: { databasePath: string; token: string; port?: number }) {
  if (!/^[a-f0-9]{64}$/.test(options.token)) throw new Error("A 32-byte hex pairing token is required");
  const database = new DashboardDatabase(options.databasePath);
  let lastSeenAt: number | null = null;
  const server = http.createServer(async (req, res) => {
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(JSON.stringify(value));
    };
    const auth = Buffer.from(req.headers.authorization ?? "");
    const expected = Buffer.from("Bearer " + options.token);
    // Browser pages are not clients. No CORS support or remote hostnames.
    if (req.headers.origin || !/^127\.0\.0\.1:\d+$/.test(req.headers.host ?? "")) { reply(403, { error: "Local application clients only" }); return; }
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) { reply(401, { error: "Pairing required" }); return; }
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/v1/status") {
        reply(200, { schemaVersion: 1, extensionConnected: lastSeenAt !== null && Date.now() - lastSeenAt < 45000,
          lastSeenAt, lastSyncedAt: database.lastReceivedAt }); return;
      }
      if (req.method === "GET" && url.pathname === "/v1/history") {
        const limit = Number(url.searchParams.get("limit") ?? 50), offset = Number(url.searchParams.get("offset") ?? 0);
        if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0) { reply(400, { error: "Invalid pagination" }); return; }
        const projectId = url.searchParams.get("projectId");
        if (projectId !== null && !isProjectId(projectId)) { reply(400, { error: "Invalid project ID" }); return; }
        reply(200, { checks: database.history(limit, offset, projectId ?? undefined), limit, offset, projectId }); return;
      }
      if (req.method === "GET" && url.pathname === "/v1/projects") { reply(200, { projects: database.projects() }); return; }
      if (req.method === "GET" && url.pathname === "/v1/home") { reply(200, database.home()); return; }
      if (req.method === "GET" && url.pathname === "/v1/growth") {
        const days = url.searchParams.get("days") ?? "all";
        if (!["7", "30", "all"].includes(days)) { reply(400, { error: "days must be 7, 30, or all" }); return; }
        reply(200, database.growth(days === "all" ? null : Number(days) as 7 | 30)); return;
      }
      if (req.method === "GET" && url.pathname === "/v1/mastery") { reply(200, { concepts: database.mastery() }); return; }
      if (req.method === "GET" && url.pathname === "/v1/recall") {
        const due = url.searchParams.get("due");
        reply(200, { cards: database.recall(due === "now" ? Date.now() : undefined) }); return;
      }
      if (req.method === "GET" && url.pathname === "/v1/files") { reply(200, { files: database.files() }); return; }
      if (req.method === "GET" && url.pathname === "/v1/files/edges") { reply(200, { edges: database.edges() }); return; }
      if (req.method === "GET" && url.pathname === "/v1/profile") { reply(200, { profile: database.profile() }); return; }
      if (req.method === "GET" && url.pathname === "/v1/prepsets") { reply(200, { sets: database.prepSets() }); return; }
      if (req.method === "GET" && url.pathname === "/v1/checks") { reply(200, { checks: database.checks() }); return; }
      if (req.method === "GET" && url.pathname === "/v1/settings") { reply(200, { settings: database.settings() }); return; }
      if (req.method === "GET" && url.pathname === "/v1/rank") { reply(200, database.rank()); return; }
      if (req.method === "GET" && url.pathname === "/v1/map") { reply(200, database.map()); return; }
      if (req.method !== "POST" || !["/v1/events", "/v1/heartbeat"].includes(url.pathname)) { reply(404, { error: "Not found" }); return; }
      if (req.headers["content-type"]?.split(";")[0] !== "application/json") { reply(415, { error: "JSON required" }); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 128 * 1024) { reply(413, { error: "Event too large" }); req.resume(); return; }
        chunks.push(chunk);
      }
      let event: unknown;
      try { event = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { reply(400, { error: "Invalid JSON" }); return; }
      if (url.pathname === "/v1/heartbeat") { lastSeenAt = Date.now(); reply(200, { ok: true }); return; }
      if (!isDashboardEvent(event)) { reply(400, { error: "Invalid dashboard v1 event" }); return; }
      try { database.insert(event); }
      catch (e) { if ((e as Error).message.includes("Event ID")) { reply(409, { error: "Event ID conflict" }); return; } throw e; }
      lastSeenAt = Date.now();
      reply(200, { eventId: event.eventId }); // Acknowledge only after SQLite commits.
    } catch { if (!res.headersSent) reply(500, { error: "Could not store request" }); }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.setTimeout(5000, socket => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 43821, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
  } catch (e) { database.close(); throw e; }
  const port = (server.address() as import("node:net").AddressInfo).port;
  return { endpoint: "http://127.0.0.1:" + port, database,
    close: () => new Promise<void>((resolve) => {
      try { database.close(); } catch { /* Already closed. */ }
      server.close(() => resolve());
      server.closeAllConnections();
    }) };
}
