// Minimal Chrome DevTools Protocol client used from inside the extension host.
// It lets the tests press real keys in the workbench window (so keybinding
// resolution, when-clauses and other extensions' bindings are exercised) and
// type into the quiz webview, without moving the OS focus or the user's mouse.
// No dependencies: a tiny WebSocket client over http upgrade.
const crypto = require("crypto");
const http = require("http");

function getJson(port, path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path }, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

class Ws {
  constructor(socket, head) {
    this.socket = socket;
    this.buf = head && head.length ? head : Buffer.alloc(0);
    this.frags = [];
    this.onmessage = null;
    socket.on("data", (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.parse();
    });
    if (this.buf.length) setImmediate(() => this.parse());
  }
  parse() {
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      if (b1 & 0x80) off += 4;
      if (this.buf.length < off + len) return;
      const payload = this.buf.subarray(off, off + len);
      this.buf = this.buf.subarray(off + len);
      const op = b0 & 0x0f;
      if (op === 0x9) {
        this.write(0xa, Buffer.from(payload));
        continue;
      }
      if (op === 0x8) {
        this.socket.end();
        continue;
      }
      if (op === 1 || op === 0) {
        this.frags.push(Buffer.from(payload));
        if (b0 & 0x80) {
          const msg = Buffer.concat(this.frags).toString("utf8");
          this.frags = [];
          if (this.onmessage) this.onmessage(msg);
        }
      }
    }
  }
  write(op, payload) {
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | op, 0x80 | len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | op;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | op;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }
  send(text) {
    this.write(1, Buffer.from(text, "utf8"));
  }
  close() {
    this.socket.destroy();
  }
}

function connectWs(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      host: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"),
        "Sec-WebSocket-Version": "13",
      },
    });
    req.on("upgrade", (_res, socket, head) => resolve(new Ws(socket, head)));
    req.on("error", reject);
    req.end();
  });
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.contexts = new Map(); // key sessionId|contextId -> {sessionId, id, origin}
    ws.onmessage = (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      this.onEvent(msg);
    };
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(msg));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("CDP timeout " + method));
        }
      }, 10000);
    });
  }
  onEvent(msg) {
    const sid = msg.sessionId || "";
    if (msg.method === "Target.attachedToTarget") {
      const child = msg.params.sessionId;
      void this.send("Runtime.enable", {}, child).catch(() => {});
      void this.send(
        "Target.setAutoAttach",
        { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
        child,
      ).catch(() => {});
      void this.send("Runtime.runIfWaitingForDebugger", {}, child).catch(() => {});
    } else if (msg.method === "Runtime.executionContextCreated") {
      const c = msg.params.context;
      this.contexts.set(sid + "|" + c.id, { sessionId: sid, id: c.id, origin: c.origin || "" });
    } else if (msg.method === "Runtime.executionContextDestroyed") {
      this.contexts.delete(sid + "|" + msg.params.executionContextId);
    } else if (msg.method === "Runtime.executionContextsCleared") {
      for (const k of [...this.contexts.keys()]) if (k.startsWith(sid + "|")) this.contexts.delete(k);
    }
  }
  async evalMain(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true });
    return r.result && r.result.value;
  }
  /** Runs `expression` in every webview frame until one returns a truthy value. */
  async evalInWebviews(expression) {
    for (const c of [...this.contexts.values()]) {
      if (!c.origin.startsWith("vscode-webview://")) continue;
      try {
        const r = await this.send(
          "Runtime.evaluate",
          { expression, contextId: c.id, returnByValue: true },
          c.sessionId || undefined,
        );
        if (r.result && r.result.value) return r.result.value;
      } catch {
        // Context went away.
      }
    }
    return undefined;
  }
  async key(spec) {
    // spec like "ctrl+v", "escape", "enter", "tab"
    const parts = spec.toLowerCase().split("+");
    const k = parts.pop();
    let modifiers = 0;
    if (parts.includes("alt")) modifiers |= 1;
    if (parts.includes("ctrl")) modifiers |= 2;
    if (parts.includes("meta")) modifiers |= 4;
    if (parts.includes("shift")) modifiers |= 8;
    const named = {
      escape: { key: "Escape", code: "Escape", vk: 27 },
      enter: { key: "Enter", code: "Enter", vk: 13 },
      tab: { key: "Tab", code: "Tab", vk: 9 },
    };
    let info = named[k];
    if (!info) {
      const ch = k.length === 1 ? k : k[0];
      info = { key: ch, code: "Key" + ch.toUpperCase(), vk: ch.toUpperCase().charCodeAt(0) };
    }
    const base = {
      modifiers,
      key: info.key,
      code: info.code,
      windowsVirtualKeyCode: info.vk,
      nativeVirtualKeyCode: info.vk,
    };
    await this.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
    if (modifiers === 0 && info.key.length === 1) {
      await this.send("Input.dispatchKeyEvent", { type: "char", ...base, text: info.key });
    }
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
  async typeText(text) {
    await this.send("Input.insertText", { text });
  }
  close() {
    this.ws.close();
  }
}

async function connect(port) {
  const list = await getJson(port, "/json/list");
  const page = list.find((t) => t.type === "page" && /workbench/.test(t.url));
  if (!page) throw new Error("no workbench page target: " + JSON.stringify(list.map((t) => t.url)));
  const ws = await connectWs(page.webSocketDebuggerUrl);
  const cdp = new Cdp(ws);
  await cdp.send("Runtime.enable");
  await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  try {
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  } catch {
    // Older Chromium.
  }
  return cdp;
}

module.exports = { connect };
