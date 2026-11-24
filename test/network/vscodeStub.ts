/**
 * Minimal stand-in for the `vscode` module so src/llm.ts, src/quiz.ts,
 * src/store.ts and src/memory/sync.ts can run under plain node:test.
 *
 * Only what those modules touch is implemented. The webview panel is a fake
 * that tests drive directly (send "ready", "submit", "bypass", close, ...).
 */

type Listener<T> = (e: T) => unknown;

export class EventEmitter<T = void> {
  private listeners = new Set<Listener<T>>();
  event = (listener: Listener<T>) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(e: T): void {
    for (const l of [...this.listeners]) {
      l(e);
    }
  }
  dispose(): void {
    this.listeners.clear();
  }
}

export class Position {
  constructor(public line: number, public character: number) {}
}

export class Range {
  constructor(public start: Position, public end: Position) {}
}

export const ViewColumn = { Active: -1, One: 1 };
export const ConfigurationTarget = { Global: 1, Workspace: 2 };
export const StatusBarAlignment = { Left: 1, Right: 2 };
export class ThemeColor { constructor(public id: string) {} }
export const OverviewRulerLane = { Left: 1, Center: 2, Right: 4, Full: 7 };

/** "section.key" -> value. Tests set this directly. */
export const settings = new Map<string, unknown>();
type ConfigListener = (event: { affectsConfiguration(section: string): boolean }) => void;
const configListeners = new Set<ConfigListener>();
export const statusMessages: string[] = [];
export const infoMessages: string[] = [];
export const warnMessages: string[] = [];
export const errorMessages: string[] = [];

export const workspace = {
  getConfiguration(section: string) {
    return {
      get<T>(key: string, fallback?: T): T {
        const full = section + "." + key;
        return (settings.has(full) ? settings.get(full) : fallback) as T;
      },
      async update(key: string, value: unknown): Promise<void> {
        const full = section + "." + key;
        settings.set(full, value);
        const event = { affectsConfiguration: (part: string) => full === part || full.startsWith(part + ".") };
        for (const listener of [...configListeners]) listener(event);
      },
    };
  },
  onDidChangeTextDocument: () => ({ dispose() {} }),
  onDidOpenTextDocument: () => ({ dispose() {} }),
  onDidSaveTextDocument: () => ({ dispose() {} }),
  onDidChangeConfiguration(listener: ConfigListener) {
    configListeners.add(listener);
    return { dispose: () => { configListeners.delete(listener); } };
  },
  textDocuments: [] as unknown[],
  workspaceFolders: undefined as unknown,
};

export type WebviewMessage = Record<string, unknown> & { type: string };

export class FakePanel {
  readonly toWebview: WebviewMessage[] = [];
  disposed = false;
  private receiver: ((m: unknown) => void) | undefined;
  private disposeListeners: (() => void)[] = [];

  webview = {
    html: "",
    cspSource: "stub-csp",
    postMessage: async (m: WebviewMessage) => {
      this.toWebview.push(m);
      return true;
    },
    onDidReceiveMessage: (cb: (m: unknown) => void) => {
      this.receiver = cb;
      return { dispose() {} };
    },
  };

  reveal(): void {}

  onDidDispose(cb: () => void) {
    this.disposeListeners.push(cb);
    return { dispose() {} };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const cb of this.disposeListeners) {
      cb();
    }
  }

  /** Simulates a message posted by the webview script. */
  fromWebview(m: WebviewMessage): void {
    this.receiver?.(m);
  }

  questions(): WebviewMessage[] {
    return this.toWebview.filter((m) => m.type === "showQuestion");
  }

  feedback(): WebviewMessage[] {
    return this.toWebview.filter((m) => m.type === "showFeedback");
  }
}

export const panels: FakePanel[] = [];

export const window = {
  createWebviewPanel: () => {
    const panel = new FakePanel();
    panels.push(panel);
    return panel;
  },
  setStatusBarMessage: (m: string) => {
    statusMessages.push(m);
    return { dispose() {} };
  },
  showInformationMessage: async (m: string) => {
    infoMessages.push(m);
    return undefined;
  },
  showWarningMessage: async (m: string) => {
    warnMessages.push(m);
    return undefined;
  },
  showErrorMessage: async (m: string) => {
    errorMessages.push(m);
    return undefined;
  },
  createOutputChannel: () => ({
    appendLine() {},
    clear() {},
    show() {},
    dispose() {},
  }),
  activeTextEditor: undefined as unknown,
  visibleTextEditors: [] as unknown[],
};

export const commands = {
  registerCommand: () => ({ dispose() {} }),
  executeCommand: async () => undefined,
};

export const env = {
  clipboard: { readText: async () => "", writeText: async () => undefined },
};

export const Uri = {
  file: (p: string) => ({ fsPath: p, scheme: "file", toString: () => "file:///" + p }),
};

export function resetStub(): void {
  settings.clear();
  configListeners.clear();
  statusMessages.length = 0;
  infoMessages.length = 0;
  warnMessages.length = 0;
  errorMessages.length = 0;
  panels.length = 0;
}
