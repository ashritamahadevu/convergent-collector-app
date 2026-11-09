"use strict";

/**
 * Minimal stand-in for the `vscode` module so src/walkthrough.ts (and the
 * quiz / llm / memory code it pulls in) can run under node:test.
 * Tests drive it through `module.exports.__fake`.
 */

class EventEmitter {
  constructor() {
    this.listeners = new Set();
    this.event = (listener) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
  }
  fire(value) {
    for (const l of [...this.listeners]) {
      l(value);
    }
  }
  dispose() {
    this.listeners.clear();
  }
}

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

const fake = {
  config: {},
  infoMessages: [],
  warningMessages: [],
  statusMessages: [],
  panels: [],
  /** (message, items, index) => choice | undefined | Promise */
  onInfo: () => undefined,
  /** (showQuestionMsg, panel, questionIndex) => action ({type:'submit',...} | {type:'close'} | {type:'bypass'}) */
  onQuestion: () => ({ type: "close" }),
  workspaceName: "demo-project",
  reset() {
    this.config = {};
    this.infoMessages = [];
    this.warningMessages = [];
    this.statusMessages = [];
    this.panels = [];
    this.onInfo = () => undefined;
    this.onQuestion = () => ({ type: "close" });
  },
};

function createWebviewPanel(viewType, title) {
  const receive = new EventEmitter();
  const disposeEmitter = new EventEmitter();
  const record = { viewType, title, posted: [], disposed: false, questions: 0 };
  const panel = {
    webview: {
      html: "",
      cspSource: "vscode-resource:",
      onDidReceiveMessage: receive.event,
      asWebviewUri: (u) => u,
      postMessage: async (msg) => {
        record.posted.push(msg);
        if (msg && msg.type === "showQuestion") {
          const index = record.questions++;
          const action = await fake.onQuestion(msg, record, index);
          setTimeout(() => {
            if (record.disposed) {
              return;
            }
            if (!action || action.type === "close") {
              panel.dispose();
            } else {
              receive.fire(action);
            }
          }, 1);
        }
        return true;
      },
    },
    onDidDispose: disposeEmitter.event,
    reveal() {},
    dispose() {
      if (record.disposed) {
        return;
      }
      record.disposed = true;
      disposeEmitter.fire();
    },
  };
  fake.panels.push(record);
  // The real webview script posts "ready" once it loads.
  setTimeout(() => receive.fire({ type: "ready" }), 1);
  return panel;
}

module.exports = {
  __fake: fake,
  EventEmitter,
  Position,
  Range,
  ViewColumn: { Active: -1, One: 1, Beside: -2 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  Uri: {
    file: (p) => ({ fsPath: p, scheme: "file", toString: () => "file://" + p }),
    joinPath: (u, ...parts) => ({ fsPath: [u.fsPath, ...parts].join("/"), scheme: "file" }),
  },
  window: {
    showInformationMessage: async (message, ...items) => {
      const index = fake.infoMessages.length;
      fake.infoMessages.push({ message, items });
      return fake.onInfo(message, items, index);
    },
    showWarningMessage: async (message, ...items) => {
      fake.warningMessages.push({ message, items });
      return undefined;
    },
    showErrorMessage: async () => undefined,
    setStatusBarMessage: (message) => {
      fake.statusMessages.push(message);
      return { dispose() {} };
    },
    createWebviewPanel,
    createOutputChannel: () => ({ appendLine() {}, clear() {}, show() {}, dispose() {} }),
  },
  workspace: {
    get workspaceFolders() {
      return fake.workspaceName ? [{ name: fake.workspaceName, uri: { fsPath: "/ws/" + fake.workspaceName } }] : undefined;
    },
    getConfiguration: () => ({
      get: (key, fallback) => (key in fake.config ? fake.config[key] : fallback),
      update: async (key, value) => {
        fake.config[key] = value;
      },
    }),
    findFiles: async () => [],
  },
};
