import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createNetServer, type AddressInfo, type Socket } from "node:net";

/**
 * Test harness for network-failure tests.
 *
 * A real Ollama is running on 127.0.0.1:11434 on this machine, so we never
 * bind that port. Instead globalThis.fetch is wrapped: any request for
 * 127.0.0.1:11434 (or the hosted provider APIs) is rewritten to a mock HTTP
 * server on a random port. The request still goes over a real socket through
 * Node's real fetch (undici), so timeouts, resets and stalls behave like the
 * real thing. The wrapper refuses to let anything reach the real :11434.
 */

export type RequestKind = "generate" | "judge" | "other";

export type Behaviour =
  | { kind: "json"; status?: number; body: unknown; delayMs?: number; contentType?: string }
  | { kind: "text"; status?: number; text: string; delayMs?: number; contentType?: string }
  /** Accept the request and never answer (until release() or test end). */
  | { kind: "hang" }
  /** Send 200 + headers, then never send the body. */
  | { kind: "headersThenStall" }
  /** Send headers, then one space every intervalMs for totalMs, then the body. */
  | { kind: "drip"; intervalMs: number; totalMs: number; body: unknown }
  /** Destroy the socket without answering (connection reset). */
  | { kind: "reset" }
  /** Send headers with the full Content-Length, write a prefix, then destroy the socket. */
  | { kind: "truncate"; body: unknown; cutAt: number };

export type SeenRequest = { kind: RequestKind; url: string; at: number; body: string };

export type MockServer = {
  base: string;
  port: number;
  requests: SeenRequest[];
  handler: (req: SeenRequest, index: number) => Behaviour;
  /** Completes every hung request with this behaviour. */
  releaseHung(b: Behaviour): void;
  close(): Promise<void>;
};

function classify(body: string): RequestKind {
  if (body.includes("strict, impartial grader")) {
    return "judge";
  }
  if (body.includes("Generate ONE")) {
    return "generate";
  }
  return "other";
}

export async function startMockServer(): Promise<MockServer> {
  const hung: ServerResponse[] = [];
  const sockets = new Set<Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let count = 0;

  const apply = (res: ServerResponse, b: Behaviour): void => {
    const later = (ms: number, fn: () => void) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };
    switch (b.kind) {
      case "json":
      case "text": {
        const send = () => {
          const payload = b.kind === "json" ? JSON.stringify(b.body) : b.text;
          res.writeHead(b.status ?? 200, {
            "Content-Type": b.contentType ?? (b.kind === "json" ? "application/json" : "text/plain"),
          });
          res.end(payload);
        };
        if (b.delayMs) {
          later(b.delayMs, send);
        } else {
          send();
        }
        return;
      }
      case "hang":
        hung.push(res);
        return;
      case "headersThenStall":
        res.writeHead(200, { "Content-Type": "application/json" });
        res.flushHeaders();
        hung.push(res);
        return;
      case "drip": {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.flushHeaders();
        const started = Date.now();
        const tick = () => {
          if (res.destroyed) {
            return;
          }
          if (Date.now() - started >= b.totalMs) {
            res.end(JSON.stringify(b.body));
            return;
          }
          res.write(" ");
          later(b.intervalMs, tick);
        };
        later(b.intervalMs, tick);
        return;
      }
      case "reset":
        res.socket?.destroy();
        return;
      case "truncate": {
        const payload = JSON.stringify(b.body);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(payload)),
        });
        res.write(payload.slice(0, b.cutAt));
        later(20, () => res.socket?.destroy());
        return;
      }
    }
  };

  const mock: MockServer = {
    base: "",
    port: 0,
    requests: [],
    handler: () => ({ kind: "json", body: {} }),
    releaseHung(b: Behaviour) {
      for (const res of hung.splice(0)) {
        if (res.headersSent) {
          res.end(b.kind === "json" ? JSON.stringify(b.body) : "");
        } else {
          apply(res, b);
        }
      }
    },
    async close() {
      for (const t of timers) {
        clearTimeout(t);
      }
      for (const s of sockets) {
        s.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString("utf8")));
    req.on("end", () => {
      const seen: SeenRequest = { kind: classify(body), url: req.url ?? "", at: Date.now(), body };
      mock.requests.push(seen);
      count++;
      // Index is relative to the current test (tests clear `requests`).
      apply(res, mock.handler(seen, mock.requests.length - 1));
    });
  });
  server.on("connection", (s: Socket) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  // Keep-alive sockets would otherwise hold the process open.
  server.keepAliveTimeout = 100;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  mock.port = port;
  mock.base = "http://127.0.0.1:" + port;
  return mock;
}

/** A port that nothing listens on (bound, then closed). */
export async function closedPort(): Promise<number> {
  const s = createNetServer();
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", () => resolve()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return port;
}

export type Redirect = { from: string; to: string };

const realFetch = globalThis.fetch;
export const fetchLog: string[] = [];

/**
 * Rewrites request URLs by prefix. Every request is logged. Anything that
 * would still hit the real local Ollama port is refused.
 */
export function redirectFetch(redirects: Redirect[]): () => void {
  const wrapped = (input: string | URL | Request, init?: RequestInit) => {
    let url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    for (const r of redirects) {
      if (url.startsWith(r.from)) {
        url = r.to + url.slice(r.from.length);
        break;
      }
    }
    fetchLog.push(url);
    if (/:11434(\/|$)/.test(url)) {
      return Promise.reject(new Error("harness refused to contact the real Ollama on :11434"));
    }
    return realFetch(url, init);
  };
  globalThis.fetch = wrapped as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

export const OLLAMA = "http://127.0.0.1:11434";

/** In-memory ExtensionContext with VS Code-like globalState and secrets. */
export function fakeContext() {
  const store = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  const updates: { key: string; value: unknown }[] = [];
  return {
    store,
    secretStore: secrets,
    updates,
    globalState: {
      get<T>(key: string, fallback?: T): T {
        return (store.has(key) ? store.get(key) : fallback) as T;
      },
      async update(key: string, value: unknown): Promise<void> {
        updates.push({ key, value });
        if (value === undefined) {
          store.delete(key);
        } else {
          store.set(key, value);
        }
      },
      keys: () => [...store.keys()],
      setKeysForSync() {},
    },
    secrets: {
      async get(key: string) {
        return secrets.get(key);
      },
      async store(key: string, value: string) {
        secrets.set(key, value);
      },
      async delete(key: string) {
        secrets.delete(key);
      },
      onDidChange: () => ({ dispose() {} }),
    },
    subscriptions: [] as { dispose(): unknown }[],
  };
}

export const FREE_TEXT_QUESTION = {
  kind: "free-text",
  question: "What does total([1,2,3]) return?",
  referenceAnswer: "6, the sum of the items.",
  criteria: [
    { id: "c1", text: "States that the result is 6 (the sum).", hint: "Look at the loop.", critical: true },
    { id: "c2", text: "Says each item is added to an accumulator.", hint: "Look at acc.", critical: false },
  ],
  conceptTags: ["control-flow"],
  flagged: false,
};

export const MCQ_QUESTION = {
  kind: "multiple-choice",
  question: "What does total([1,2,3]) return?",
  referenceAnswer: "6",
  criteria: [],
  options: ["5", "6", "123"],
  correctIndex: 1,
  conceptTags: ["control-flow"],
  flagged: false,
};

export function judgeJson(verdicts: ("pass" | "fail" | "n/a")[], ids = ["c1", "c2"]) {
  return {
    criteria: verdicts.map((v, i) => ({
      id: ids[i],
      analysis: "ok",
      verdict: v,
      evidence: v === "pass" ? "it returns 6" : "NONE",
    })),
    misconception: verdicts.includes("fail") ? "Thinks it concatenates." : "",
  };
}

/** Wraps model text in the Ollama /api/chat response envelope. */
export function ollamaReply(content: unknown): Behaviour {
  return {
    kind: "json",
    body: { message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) } },
  };
}

export function openAiReply(content: unknown): Behaviour {
  return {
    kind: "json",
    body: { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] },
  };
}

export async function waitFor(pred: () => boolean, timeoutMs = 5000, what = "condition"): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for " + what);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

export const SNIPPET = [
  "function total(items) {",
  "  let acc = 0;",
  "  for (const item of items) {",
  "    acc += item;",
  "  }",
  "  return acc;",
  "}",
  "// padding so the snippet is above the default 200 character threshold.......",
  "module.exports = { total };",
].join("\n");

export const GOOD_ANSWER = "It loops over the items, adds each to acc, and returns 6 for [1,2,3].";
export const NONSENSE_ANSWER = "banana banana banana banana banana";
