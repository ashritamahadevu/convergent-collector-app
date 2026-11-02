import * as vscode from "vscode";
import type { GeneratedQuestion } from "./types";

export type SubmitPayload = { answer?: string; selectedIndex?: number };

export type QuizView = {
  showQuestion(question: GeneratedQuestion): void;
  showFeedback(opts: {
    message: string;
    missed?: { text: string; evidence?: string }[];
    correctOption?: string;
  }): void;
  waitForSubmit(): Promise<SubmitPayload | "cancel">;
  close(): void;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

function getWebviewHtml(
  webview: vscode.Webview,
  snippet: string,
  language: string,
  nonce: string,
): string {
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  const langLabel = language.trim()
    ? `<span class="lang">${escapeHtml(language)}</span>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Comprehension check</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px 20px 24px;
      line-height: 1.5;
      box-sizing: border-box;
    }
    h1 {
      font-size: 1.15em;
      font-weight: 600;
      margin: 0 0 12px;
    }
    .snippet-wrap {
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
      border-radius: 4px;
      margin-bottom: 16px;
      overflow: auto;
      max-height: 280px;
    }
    .snippet-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
    }
    pre {
      margin: 0;
      padding: 12px;
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }
    pre, code { white-space: pre; word-break: normal; }
    .question {
      margin: 0 0 12px;
      font-weight: 500;
    }
    .answer-area { margin-bottom: 12px; }
    textarea {
      width: 100%;
      min-height: 100px;
      box-sizing: border-box;
      padding: 8px 10px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
      border-radius: 4px;
      resize: vertical;
    }
    .mcq-option {
      display: block;
      margin: 8px 0;
      cursor: pointer;
    }
    .mcq-option input { margin-right: 8px; vertical-align: middle; }
    .feedback {
      display: none;
      margin: 12px 0;
      padding: 10px 12px;
      border-radius: 4px;
      border-left: 3px solid var(--vscode-inputValidation-warningBorder);
      background: var(--vscode-inputValidation-warningBackground);
      color: var(--vscode-inputValidation-warningForeground);
    }
    .feedback.visible { display: block; }
    .feedback-msg { margin: 0 0 8px; }
    .missed-list {
      margin: 8px 0 0;
      padding-left: 18px;
    }
    .missed-list li { margin-bottom: 6px; }
    .evidence {
      display: block;
      margin-top: 4px;
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    .correct-option {
      margin-top: 8px;
      font-weight: 500;
    }
    button.submit {
      padding: 6px 16px;
      font-size: var(--vscode-font-size);
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: none;
      border-radius: 2px;
      cursor: pointer;
    }
    button.submit:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <h1>Comprehension check</h1>
  <div class="snippet-wrap">
    <div class="snippet-head">
      <span>Code</span>
      ${langLabel}
    </div>
    <pre><code>${escapeHtml(snippet)}</code></pre>
  </div>
  <p id="question" class="question"></p>
  <div id="feedback" class="feedback" aria-live="polite">
    <p id="feedback-msg" class="feedback-msg"></p>
    <ul id="missed-list" class="missed-list hidden"></ul>
    <p id="correct-option" class="correct-option hidden"></p>
  </div>
  <div id="answer-area" class="answer-area"></div>
  <button type="button" class="submit" id="submit-btn">Submit</button>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const questionEl = document.getElementById("question");
    const feedbackEl = document.getElementById("feedback");
    const feedbackMsgEl = document.getElementById("feedback-msg");
    const missedListEl = document.getElementById("missed-list");
    const correctOptionEl = document.getElementById("correct-option");
    const answerAreaEl = document.getElementById("answer-area");
    const submitBtn = document.getElementById("submit-btn");

    let currentKind = "free-text";

    function clearFeedback() {
      feedbackEl.classList.remove("visible");
      feedbackMsgEl.textContent = "";
      missedListEl.innerHTML = "";
      missedListEl.classList.add("hidden");
      correctOptionEl.textContent = "";
      correctOptionEl.classList.add("hidden");
    }

    function renderQuestion(payload) {
      currentKind = payload.kind || "free-text";
      questionEl.textContent = payload.questionText || "";
      clearFeedback();
      answerAreaEl.innerHTML = "";

      if (currentKind === "multiple-choice" && Array.isArray(payload.options)) {
        payload.options.forEach(function (opt, idx) {
          const label = document.createElement("label");
          label.className = "mcq-option";
          const input = document.createElement("input");
          input.type = "radio";
          input.name = "mcq";
          input.value = String(idx);
          label.appendChild(input);
          label.appendChild(document.createTextNode(opt));
          answerAreaEl.appendChild(label);
        });
      } else {
        const ta = document.createElement("textarea");
        ta.id = "answer-input";
        ta.placeholder = "Explain in your own words...";
        answerAreaEl.appendChild(ta);
        ta.focus();
      }
    }

    function showFeedback(payload) {
      feedbackMsgEl.textContent = payload.message || "";
      missedListEl.innerHTML = "";
      if (Array.isArray(payload.missed) && payload.missed.length > 0) {
        missedListEl.classList.remove("hidden");
        payload.missed.forEach(function (item) {
          const li = document.createElement("li");
          li.textContent = item.text || "";
          if (item.evidence) {
            const ev = document.createElement("span");
            ev.className = "evidence";
            ev.textContent = item.evidence;
            li.appendChild(ev);
          }
          missedListEl.appendChild(li);
        });
      } else {
        missedListEl.classList.add("hidden");
      }
      if (payload.correctOption) {
        correctOptionEl.textContent = "Correct answer: " + payload.correctOption;
        correctOptionEl.classList.remove("hidden");
      } else {
        correctOptionEl.classList.add("hidden");
      }
      feedbackEl.classList.add("visible");

      if (currentKind === "free-text") {
        const ta = document.getElementById("answer-input");
        if (ta) {
          ta.value = "";
          ta.focus();
        }
      } else {
        const checked = answerAreaEl.querySelector('input[name="mcq"]:checked');
        if (checked) {
          checked.checked = false;
        }
      }
    }

    function collectSubmit() {
      if (currentKind === "multiple-choice") {
        const selected = answerAreaEl.querySelector('input[name="mcq"]:checked');
        if (!selected) {
          showFeedback({ message: "Please select an option before submitting." });
          return;
        }
        vscode.postMessage({
          type: "submit",
          selectedIndex: parseInt(selected.value, 10),
        });
        return;
      }
      const ta = document.getElementById("answer-input");
      const answer = ta ? ta.value : "";
      vscode.postMessage({ type: "submit", answer: answer });
    }

    submitBtn.addEventListener("click", collectSubmit);

    vscode.postMessage({ type: "ready" });

    window.addEventListener("message", function (event) {
      const msg = event.data;
      if (!msg || !msg.type) {
        return;
      }
      if (msg.type === "showQuestion") {
        renderQuestion(msg);
      } else if (msg.type === "showFeedback") {
        showFeedback(msg);
      }
    });
  </script>
</body>
</html>`;
}

export function createQuizPanel(snippet: string, language: string): QuizView {
  const nonce = getNonce();
  const panel = vscode.window.createWebviewPanel(
    "comprehensionGuard.quiz",
    "Comprehension check",
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  let disposed = false;
  let ready = false;
  const queued: unknown[] = [];
  let pendingResolve: ((value: SubmitPayload | "cancel") => void) | null = null;

  const post = (message: unknown): void => {
    if (disposed) {
      return;
    }
    if (!ready) {
      queued.push(message);
      return;
    }
    void panel.webview.postMessage(message);
  };

  const resolvePending = (value: SubmitPayload | "cancel"): void => {
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve(value);
    }
  };

  panel.webview.onDidReceiveMessage((message: unknown) => {
    if (disposed || !message || typeof message !== "object") {
      return;
    }
    const msg = message as { type?: string; answer?: string; selectedIndex?: number };
    if (msg.type === "ready") {
      ready = true;
      for (const queuedMessage of queued.splice(0)) {
        void panel.webview.postMessage(queuedMessage);
      }
      return;
    }
    if (msg.type !== "submit") {
      return;
    }
    const payload: SubmitPayload = {};
    if (typeof msg.answer === "string") {
      payload.answer = msg.answer;
    }
    if (typeof msg.selectedIndex === "number" && Number.isFinite(msg.selectedIndex)) {
      payload.selectedIndex = msg.selectedIndex;
    }
    resolvePending(payload);
  });

  panel.onDidDispose(() => {
    disposed = true;
    resolvePending("cancel");
  });

  panel.webview.html = getWebviewHtml(panel.webview, snippet, language, nonce);

  return {
    showQuestion(question: GeneratedQuestion): void {
      if (disposed) {
        return;
      }
      post({
        type: "showQuestion",
        kind: question.kind,
        questionText: question.question,
        options: question.options ?? [],
      });
    },

    showFeedback(opts: {
      message: string;
      missed?: { text: string; evidence?: string }[];
      correctOption?: string;
    }): void {
      if (disposed) {
        return;
      }
      post({
        type: "showFeedback",
        message: opts.message,
        missed: opts.missed ?? [],
        correctOption: opts.correctOption ?? "",
      });
    },

    waitForSubmit(): Promise<SubmitPayload | "cancel"> {
      if (disposed) {
        return Promise.resolve("cancel");
      }
      return new Promise((resolve) => {
        pendingResolve = resolve;
      });
    },

    close(): void {
      if (!disposed) {
        panel.dispose();
      }
    },
  };
}
