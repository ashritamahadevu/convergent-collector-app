import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { DashboardClient, validPagination } from "../electron/client";
import { startDashboardBackend } from "../../backend/server";
import type { ReviewEvent } from "../../../src/dashboard/protocol";

test("read-only client reads the real backend, refreshes and paginates without exposing tokens", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "drawbridge-client-"));
  const token = randomBytes(32).toString("hex");
  const backend = await startDashboardBackend({ databasePath: path.join(directory, "test.sqlite"), token, port: 0 });
  try {
    await fs.writeFile(path.join(directory, "pairing-token"), token);
    const client = new DashboardClient({ directory, port: Number(new URL(backend.endpoint).port) });
    assert.deepEqual(await client.readHistory({ limit: 20, offset: 0 }), { ok: true, data: { checks: [], limit: 20, offset: 0, projectId: null } });
    assert.deepEqual(await client.readProjects(), { ok: true, data: { projects: [] } });
    assert.deepEqual(await client.readHome(), { ok: true, data: { recentChecks: [], weakPoints: [] } });
    const event: ReviewEvent = { schemaVersion: 1, type: "review.recorded", eventId: "isolated-test",
      installationId: "test", occurredAt: Date.now(), project: { id: "test&?/#='", name: "Isolated fixture" },
      question: "<script>not executable</script>", answer: "Fixture answer", feedback: "Fixture feedback",
        misconception: "", concepts: ["testing"], outcome: "bypass", score: null, source: "test",
        mode: "test", filePath: "src/test.ts", retries: 2,
        topic: "testing", shape: "general", groupId: "isolated-group", masteryAfter: null };
    backend.database.insert(event);
    assert.deepEqual(await client.readHome(), { ok: true, data: { recentChecks: [event], weakPoints: [] } });
    assert.deepEqual(await client.readHistory({ limit: 1, offset: 0 }), { ok: true, data: { checks: [event], limit: 1, offset: 0, projectId: null } });
    assert.deepEqual(await client.readHistory({ limit: 1, offset: 1 }), { ok: true, data: { checks: [], limit: 1, offset: 1, projectId: null } });
    assert.deepEqual(await client.readHistory({ limit: 1, offset: 0, projectId: event.project.id }),
      { ok: true, data: { checks: [event], limit: 1, offset: 0, projectId: event.project.id } });
    const projects = await client.readProjects();
    assert.equal(projects.ok, true);
    if (projects.ok) assert.deepEqual(projects.data.projects, [{
      id: event.project.id, name: event.project.name, lastActivityAt: event.occurredAt,
      totalChecks: 1, scoredChecks: 0, unscoredChecks: 1, averageScoreOutOfFive: null,
    }]);
    const status = await client.readStatus();
    assert.equal(status.ok, true);
    assert.equal(JSON.stringify(status).includes(token), false);
    await fs.writeFile(path.join(directory, "pairing-token"), "b".repeat(64));
    assert.match(JSON.stringify(await client.readStatus()), /Pairing was rejected/);
    await fs.writeFile(path.join(directory, "pairing-token"), "invalid-secret");
    const invalid = await client.readStatus();
    assert.match(JSON.stringify(invalid), /invalid/);
    assert.equal(JSON.stringify(invalid).includes("invalid-secret"), false);
    assert.equal(await fs.readFile(path.join(directory, "pairing-token"), "utf8"), "invalid-secret");
    await fs.unlink(path.join(directory, "pairing-token"));
    assert.match(JSON.stringify(await client.readStatus()), /Pairing configuration unavailable/);
  } finally {
    await backend.close();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test("invalid pagination is rejected without contacting a server", async () => {
  const client = new DashboardClient({ directory: "does-not-exist", port: 1 });
  for (const value of [null, [], {}, { limit: 0, offset: 0 }, { limit: 201, offset: 0 },
    { limit: 20, offset: -1 }, { limit: 20, offset: 0.5 }, { limit: "20", offset: 0 },
    { limit: 20, offset: 0, projectId: "" }, { limit: 20, offset: 0, projectId: null },
    { limit: 20, offset: 0, projectId: "x".repeat(129) }]) {
    assert.equal(validPagination(value), false);
    assert.deepEqual(await client.readHistory(value), { ok: false, error: "Invalid history pagination." });
  }
});

test("response validation, redirects, stopped backend and invalid ports produce safe errors", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "drawbridge-invalid-"));
  let redirect = false;
  let responseStatus = 200;
  let responseBody: unknown = { checks: [{ schemaVersion: 999 }], limit: 20, offset: 0 };
  const server = createServer((_req, res) => {
    if (redirect) { res.writeHead(302, { Location: "https://example.com" }); res.end(); return; }
    res.writeHead(responseStatus, { "Content-Type": "application/json" });
    res.end(JSON.stringify(responseBody));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  let closed = false;
  const close = async () => {
    if (!closed) { closed = true; await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
  };
  try {
    await fs.writeFile(path.join(directory, "pairing-token"), randomBytes(32).toString("hex"));
    const port = (server.address() as import("node:net").AddressInfo).port;
    const client = new DashboardClient({ directory, port });
    assert.match(JSON.stringify(await client.readHistory({ limit: 20, offset: 0 })), /incompatible/);
    assert.match(JSON.stringify(await client.readStatus()), /incompatible/);
    assert.match(JSON.stringify(await client.readProjects()), /incompatible/);
    assert.match(JSON.stringify(await client.readHome()), /incompatible/);
    responseBody = { recentChecks: [], weakPoints: [{
      concept: "invalid", averageScore: 2, scoredChecks: 1, filePath: "/absolute.ts",
      project: { id: "test", name: "Test" },
    }] };
    assert.match(JSON.stringify(await client.readHome()), /incompatible/);
    responseBody = { projects: [{
      id: "invalid", name: "Bad counters", lastActivityAt: 1, totalChecks: 1,
      scoredChecks: 2, unscoredChecks: 0, averageScoreOutOfFive: 6,
    }] };
    assert.match(JSON.stringify(await client.readProjects()), /incompatible/);
    responseBody = { checks: [], limit: 20, offset: 0 }; // Old server ignores project filters.
    assert.match(JSON.stringify(await client.readHistory({ limit: 20, offset: 0, projectId: "selected" })), /incompatible/);
    responseStatus = 404;
    assert.match(JSON.stringify(await client.readProjects()), /does not support project summaries/);
    responseStatus = 200;
    redirect = true;
    assert.match(JSON.stringify(await client.readStatus()), /unavailable/);
    await close();
    assert.match(JSON.stringify(await client.readStatus()), /unavailable/);
    assert.match(JSON.stringify(await new DashboardClient({ directory, port: 99999 }).readStatus()), /Invalid DRAWBRIDGE_PORT/);
  } finally { await close(); await fs.rm(directory, { recursive: true, force: true }); }
});
