import * as vscode from "vscode";
import type { GeneratedQuestion } from "./types";

export type SubmitPayload = { answer?: string; selectedIndex?: number; order?: number[] };

export type QuizAction =
  | { type: "submit"; answer?: string; selectedIndex?: number; order?: number[] }
  | { type: "bypass" }
  | { type: "explain" }
  | { type: "dispute"; answer?: string }
  | { type: "cancel" };

export type QuizView = {
  showQuestion(question: GeneratedQuestion): void;
  showFeedback(opts: {
    message: string;
    missed?: { text: string; evidence?: string }[];
    correctOption?: string;
    allowDispute?: boolean;
    explained?: boolean;
  }): void;
  waitForSubmit(): Promise<QuizAction>;
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
    /* ── Figma design tokens ───────────────────────────────────────────────── */
    :root {
      --accent:        #74ab7b;
      --accent-light:  #c8e4cc;
      --accent-dim:    rgba(116,171,123,0.18);
      --accent-muted:  rgba(116,171,123,0.55);
      --surface:       rgba(43,43,43,0.52);
      --surface-solid: #2b2b2b;
      --on-accent:     #2b2b2b;
      --incorrect-bg:  #976263;
      --r-pill:        999px;
      --r-card:        16px;
      --r-sm:          8px;
    }

    /* ── Reset / layout ────────────────────────────────────────────────────── */
    html, body { height: 100%; margin: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size:   var(--vscode-font-size);
      color: var(--accent);
      /* Figma radial gradient — dark base, green glow rising from bottom */
      background:
        radial-gradient(
          ellipse 160% 90% at 50% 110%,
          #74ab7b 0%,
          #4d584f 22%,
          #202421 46%,
          #0d0f0d 72%,
          #0a0a0a 100%
        );
      padding: 16px 20px 12px;
      line-height: 1.5;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .scroll {
      flex: 1;
      min-height: 0;
      overflow: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(116,171,123,0.3) transparent;
    }

    /* ── Heading ───────────────────────────────────────────────────────────── */
    h1 {
      font-size: 1.1em;
      font-weight: 700;
      margin: 0 0 6px;
      letter-spacing: 0.03em;
      color: var(--accent);
    }

    .lock-note {
      margin: 0 0 14px;
      color: var(--accent-muted);
      font-size: 0.84em;
      line-height: 1.4;
    }

    /* ── Code snippet ──────────────────────────────────────────────────────── */
    .snippet-wrap {
      border: 1px solid rgba(116,171,123,0.28);
      border-radius: var(--r-card);
      margin-bottom: 18px;
      overflow: auto;
      max-height: 280px;
      background: var(--surface);
    }
    .snippet-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 12px;
      font-size: 0.8em;
      color: var(--accent-muted);
      background: rgba(43,43,43,0.6);
      border-bottom: 1px solid rgba(116,171,123,0.18);
      border-radius: var(--r-card) var(--r-card) 0 0;
    }
    pre {
      margin: 0;
      padding: 12px;
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family);
      font-size:   var(--vscode-editor-font-size);
      color: var(--accent-light);
    }
    pre, code { white-space: pre; word-break: normal; }

    /* ── Question text ─────────────────────────────────────────────────────── */
    .question {
      margin: 0 0 14px;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--accent);
    }
    .answer-area { margin-bottom: 12px; }

    /* ── Textarea ──────────────────────────────────────────────────────────── */
    textarea {
      width: 100%;
      min-height: 100px;
      box-sizing: border-box;
      padding: 12px 14px;
      font-family: var(--vscode-font-family);
      font-size:   var(--vscode-font-size);
      color: var(--accent);
      background: var(--surface);
      border: 2px solid var(--accent);
      border-radius: var(--r-card);
      resize: vertical;
      transition: border-color 180ms ease, box-shadow 180ms ease;
      outline: none;
    }
    textarea:focus {
      border-color: var(--accent-light);
      box-shadow: 0 0 0 3px rgba(116,171,123,0.18);
    }
    textarea::placeholder { color: rgba(116,171,123,0.28); opacity: 1; }

    /* ── MCQ fieldset wrapper ──────────────────────────────────────────────── */
    .mcq-fieldset {
      margin: 0;
      padding: 0;
      border: 0;
    }
    .mcq-legend {
      /* Screen-reader-only; visual question is in .question el */
      position: absolute;
      width: 1px; height: 1px;
      overflow: hidden; opacity: 0; pointer-events: none;
    }
    .mcq-options { display: grid; gap: 10px; }

    /* ── MCQ Option row ────────────────────────────────────────────────────── */
    .mcq-option {
      display: flex;
      align-items: center;
      gap: 14px;
      cursor: pointer;
      color: var(--accent);
      font-family: var(--vscode-font-family);
      font-size:   var(--vscode-font-size);
      line-height: 1.4;
      user-select: none;
      /* staggered entrance */
      animation: option-enter 320ms ease-out both;
    }
    .mcq-option:nth-child(1) { animation-delay:   0ms; }
    .mcq-option:nth-child(2) { animation-delay:  65ms; }
    .mcq-option:nth-child(3) { animation-delay: 130ms; }
    .mcq-option:nth-child(4) { animation-delay: 195ms; }
    .mcq-option:nth-child(5) { animation-delay: 260ms; }

    /* Visually hidden native radio — stays accessible for keyboard + query */
    .mcq-option input[type="radio"] {
      position: absolute;
      width: 1px; height: 1px;
      overflow: hidden; opacity: 0; pointer-events: none;
    }

    /* Custom circular radio indicator */
    .mcq-radio {
      flex: 0 0 22px;
      width: 22px; height: 22px;
      border: 2px solid var(--accent);
      border-radius: 50%;
      background: var(--surface);
      transition: background-color 160ms ease, transform 160ms ease;
    }
    .mcq-option:hover .mcq-radio { transform: scale(1.1); }

    .mcq-option input:checked + .mcq-radio {
      background: var(--accent);
      animation: radio-select 280ms cubic-bezier(0.34,1.56,0.64,1);
    }
    .mcq-option input:focus-visible + .mcq-radio {
      outline: 2px solid var(--accent-light);
      outline-offset: 3px;
    }
    .mcq-option input:disabled ~ * { cursor: default; }

    /* ── Ordering rows ─────────────────────────────────────────────────────── */
    .ordering-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      margin: 5px 0;
      background: var(--surface);
      border: 1px solid rgba(116,171,123,0.28);
      border-radius: var(--r-sm);
      color: var(--accent);
    }
    .ordering-row button {
      padding: 3px 9px;
      font-size: 0.8em;
      color: var(--accent);
      background: var(--accent-dim);
      border: 1px solid rgba(116,171,123,0.3);
      border-radius: 4px;
      cursor: pointer;
      transition: background-color 150ms ease, transform 120ms ease;
    }
    .ordering-row button:hover  { background: rgba(116,171,123,0.3); }
    .ordering-row button:active { transform: scale(0.94); }

    /* ── Feedback panel ────────────────────────────────────────────────────── */
    .feedback {
      display: none;
      margin: 14px 0;
      padding: 12px 14px;
      border-radius: var(--r-card);
      border-left: 3px solid var(--accent);
      background: rgba(43,43,43,0.45);
    }
    .feedback.visible {
      display: block;
      animation: feedback-enter 280ms ease-out both;
    }
    .feedback-msg    { margin: 0 0 6px; color: var(--accent); font-weight: 600; }
    .missed-list     { margin: 8px 0 0; padding-left: 18px; color: var(--accent-muted); }
    .missed-list li  { margin-bottom: 6px; }
    .evidence {
      display: block;
      margin-top: 4px;
      font-size: 0.88em;
      color: rgba(116,171,123,0.5);
      font-style: italic;
    }
    .correct-option { margin-top: 8px; font-weight: 600; color: var(--accent); }

    /* ── Actions bar ───────────────────────────────────────────────────────── */
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      flex-shrink: 0;
      padding-top: 12px;
    }

    /* ── Submit button (primary pill, Figma style) ─────────────────────────── */
    button.submit {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 24px;
      font-family: var(--vscode-font-family);
      font-size:   var(--vscode-font-size);
      font-weight: 600;
      letter-spacing: 0.03em;
      color: var(--on-accent);
      background: var(--accent);
      border: 2px solid var(--accent);
      border-radius: var(--r-pill);
      cursor: pointer;
      overflow: hidden;
      transition:
        background-color 180ms ease,
        border-color     180ms ease,
        transform        180ms ease,
        box-shadow       180ms ease;
      -webkit-tap-highlight-color: transparent;
    }
    button.submit:hover:not(:disabled):not(.loading) {
      background: var(--accent-light);
      border-color: var(--accent-light);
    }
    /* Press / click animation — matches Figma active state */
    button.submit:active:not(:disabled):not(.loading) {
      transform: scale(0.96);
      box-shadow: inset 0 0 0 10px var(--surface-solid);
      color: var(--surface-solid);
    }

    /* Loading state */
    button.submit.loading {
      background: var(--surface);
      color: var(--accent);
      cursor: default;
      pointer-events: none;
    }
    .submit-label  {}
    .submit-dots   { display: none; gap: 5px; align-items: center; }
    button.submit.loading .submit-label { display: none; }
    button.submit.loading .submit-dots  { display: flex; }
    .submit-dots span {
      display: block;
      width: 6px; height: 6px;
      border-radius: 50%;
      background: currentColor;
      animation: dot-pulse 1.1s ease-in-out infinite;
    }
    .submit-dots span:nth-child(2) { animation-delay: 0.18s; }
    .submit-dots span:nth-child(3) { animation-delay: 0.36s; }

    /* ── Bypass / secondary pill buttons ───────────────────────────────────── */
    button.bypass, button.dispute {
      display: inline-flex;
      align-items: center;
      padding: 7px 16px;
      font-family: var(--vscode-font-family);
      font-size:   var(--vscode-font-size);
      font-weight: 500;
      color: var(--accent);
      background: var(--surface);
      border: 2px solid rgba(116,171,123,0.45);
      border-radius: var(--r-pill);
      cursor: pointer;
      transition:
        background-color 180ms ease,
        border-color     180ms ease,
        transform        220ms cubic-bezier(0.34,1.56,0.64,1);
      -webkit-tap-highlight-color: transparent;
    }
    button.bypass:hover {
      background: var(--accent-dim);
      border-color: var(--accent);
      transform: translateY(-1px);
    }
    button.bypass:active  { transform: scale(0.95); }
    button.dispute        { margin-top: 8px; }
    button.dispute:hover  { background: var(--accent-dim); border-color: var(--accent); }
    button.dispute:active { transform: scale(0.95); }

    /* ── Utility ───────────────────────────────────────────────────────────── */
    .hidden { display: none !important; }

    /* ── Keyframes ─────────────────────────────────────────────────────────── */
    @keyframes dot-pulse {
      0%, 80%, 100% { transform: scale(0.5); opacity: 0.4; }
      40%           { transform: scale(1);   opacity: 1;   }
    }
    @keyframes radio-select {
      0%   { transform: scale(1);    }
      55%  { transform: scale(1.2);  }
      100% { transform: scale(1);    }
    }
    @keyframes option-enter {
      from { opacity: 0; transform: translateX(-10px); }
      to   { opacity: 1; transform: translateX(0);     }
    }
    @keyframes feedback-enter {
      from { opacity: 0; transform: translateY(8px);  }
      to   { opacity: 1; transform: translateY(0);    }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 1ms !important;
        transition-duration: 1ms !important;
        animation-iteration-count: 1 !important;
      }
    }
  </style>
</head>
<body>
  <div class="scroll">
  <h1>Comprehension check</h1>
  <p class="lock-note">Editing is locked until you submit, bypass, ask for an explanation, or close this tab. Bypass and "I don't know" keep the code and do not count as correct. Closing removes the code.</p>
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
    <button type="button" class="dispute hidden" id="dispute-btn">My answer was right</button>
  </div>
  <div id="answer-area" class="answer-area"></div>
  </div>
  <div class="actions">
    <button type="button" class="submit" id="submit-btn" aria-label="Submit answer">
      <span class="submit-label">Submit</span>
      <span class="submit-dots" aria-hidden="true"><span></span><span></span><span></span></span>
    </button>
    <button type="button" class="bypass" id="bypass-btn">Bypass</button>
    <button type="button" class="bypass" id="explain-btn">I don't know, explain it</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const questionEl   = document.getElementById("question");
    const feedbackEl   = document.getElementById("feedback");
    const feedbackMsgEl = document.getElementById("feedback-msg");
    const missedListEl  = document.getElementById("missed-list");
    const correctOptionEl = document.getElementById("correct-option");
    const answerAreaEl  = document.getElementById("answer-area");
    const submitBtn     = document.getElementById("submit-btn");
    const bypassBtn     = document.getElementById("bypass-btn");
    const explainBtn    = document.getElementById("explain-btn");
    const disputeBtn    = document.getElementById("dispute-btn");

    let currentKind = "free-text";
    let lastAnswer  = "";

    /* ── Loading state ───────────────────────────────────────────────────── */
    function setLoading(on) {
      if (on) {
        submitBtn.classList.add("loading");
        submitBtn.setAttribute("aria-label", "Checking your answer\u2026");
      } else {
        submitBtn.classList.remove("loading");
        submitBtn.setAttribute("aria-label", "Submit answer");
      }
    }

    /* ── Feedback helpers ────────────────────────────────────────────────── */
    function clearFeedback() {
      feedbackEl.classList.remove("visible");
      feedbackMsgEl.textContent = "";
      missedListEl.innerHTML = "";
      missedListEl.classList.add("hidden");
      correctOptionEl.textContent = "";
      correctOptionEl.classList.add("hidden");
      disputeBtn.classList.add("hidden");
    }

    function renderQuestion(payload) {
      currentKind = payload.kind || "free-text";
      questionEl.textContent = payload.questionText || "";
      clearFeedback();
      setLoading(false);
      submitBtn.classList.remove("hidden");
      bypassBtn.classList.remove("hidden");
      explainBtn.classList.remove("hidden");
      answerAreaEl.innerHTML = "";

      if (currentKind === "ordering" && Array.isArray(payload.items)) {
        payload.items.forEach(function (item, idx) {
          const row = document.createElement("div");
          row.className = "ordering-row";
          row.dataset.index = String(idx);
          const up = document.createElement("button");
          up.type = "button";
          up.textContent = "\u25B2";
          up.setAttribute("aria-label", "Move up");
          const down = document.createElement("button");
          down.type = "button";
          down.textContent = "\u25BC";
          down.setAttribute("aria-label", "Move down");
          up.addEventListener("click", function () {
            if (row.previousElementSibling) {
              answerAreaEl.insertBefore(row, row.previousElementSibling);
            }
          });
          down.addEventListener("click", function () {
            if (row.nextElementSibling) {
              answerAreaEl.insertBefore(row.nextElementSibling, row);
            }
          });
          const label = document.createElement("span");
          label.textContent = item;
          row.appendChild(up);
          row.appendChild(down);
          row.appendChild(label);
          answerAreaEl.appendChild(row);
        });
      } else if (currentKind === "multiple-choice" && Array.isArray(payload.options)) {
        const fieldset = document.createElement("fieldset");
        fieldset.className = "mcq-fieldset";
        const legend = document.createElement("legend");
        legend.className = "mcq-legend";
        legend.textContent = payload.questionText || "Choose an answer";
        fieldset.appendChild(legend);
        const optionsGrid = document.createElement("div");
        optionsGrid.className = "mcq-options";
        payload.options.forEach(function (opt, idx) {
          const lbl = document.createElement("label");
          lbl.className = "mcq-option";
          const input = document.createElement("input");
          input.type  = "radio";
          input.name  = "mcq";
          input.value = String(idx);
          /* Custom circular indicator (Figma style) */
          const radio = document.createElement("span");
          radio.className = "mcq-radio";
          radio.setAttribute("aria-hidden", "true");
          const text = document.createElement("span");
          text.textContent = opt;
          lbl.appendChild(input);
          lbl.appendChild(radio);
          lbl.appendChild(text);
          optionsGrid.appendChild(lbl);
        });
        fieldset.appendChild(optionsGrid);
        answerAreaEl.appendChild(fieldset);
      } else {
        const ta = document.createElement("textarea");
        ta.id = "answer-input";
        ta.placeholder = "Explain in your own words, then press Submit.";
        ta.addEventListener("keydown", function (event) {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            collectSubmit();
          }
        });
        answerAreaEl.appendChild(ta);
        ta.focus();
      }
    }

    function showFeedback(payload) {
      setLoading(false);
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
      if (payload.explained) {
        submitBtn.classList.add("hidden");
        bypassBtn.classList.add("hidden");
        explainBtn.classList.add("hidden");
        disputeBtn.classList.add("hidden");
      }
      if (payload.allowDispute) {
        disputeBtn.classList.remove("hidden");
      } else {
        disputeBtn.classList.add("hidden");
      }

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
      if (currentKind === "ordering") {
        const order = Array.from(answerAreaEl.querySelectorAll("[data-index]")).map(function (row) {
          return parseInt(row.dataset.index, 10);
        });
        setLoading(true);
        vscode.postMessage({ type: "submit", order: order });
        return;
      }
      if (currentKind === "multiple-choice") {
        const selected = answerAreaEl.querySelector('input[name="mcq"]:checked');
        if (!selected) {
          showFeedback({ message: "Please select an option before submitting." });
          return;
        }
        lastAnswer = selected.parentElement ? selected.parentElement.textContent.trim() : "";
        setLoading(true);
        vscode.postMessage({
          type: "submit",
          selectedIndex: parseInt(selected.value, 10),
        });
        return;
      }
      const ta = document.getElementById("answer-input");
      const answer = ta ? ta.value : "";
      lastAnswer = answer;
      setLoading(true);
      vscode.postMessage({ type: "submit", answer: answer });
    }

    submitBtn.addEventListener("click", collectSubmit);
    bypassBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "bypass" });
    });
    explainBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "explain" });
    });
    disputeBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "dispute", answer: lastAnswer });
    });

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
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.reveal(vscode.ViewColumn.Active, false);

  let disposed = false;
  let ready = false;
  const queued: unknown[] = [];
  let pendingResolve: ((value: QuizAction) => void) | null = null;
  let queuedAction: QuizAction | null = null;

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

  const resolvePending = (value: QuizAction): void => {
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve(value);
      return;
    }
    queuedAction = value;
  };

  panel.webview.onDidReceiveMessage((message: unknown) => {
    if (disposed || !message || typeof message !== "object") {
      return;
    }
    const msg = message as { type?: string; answer?: string; selectedIndex?: number; order?: number[] };
    if (msg.type === "ready") {
      ready = true;
      for (const queuedMessage of queued.splice(0)) {
        void panel.webview.postMessage(queuedMessage);
      }
      return;
    }
    if (msg.type === "bypass") {
      resolvePending({ type: "bypass" });
      return;
    }
    if (msg.type === "explain") {
      resolvePending({ type: "explain" });
      return;
    }
    if (msg.type === "dispute") {
      resolvePending({
        type: "dispute",
        answer: typeof msg.answer === "string" ? msg.answer : "",
      });
      return;
    }
    if (msg.type !== "submit") {
      return;
    }
    resolvePending({
      type: "submit",
      answer: typeof msg.answer === "string" ? msg.answer : undefined,
      selectedIndex:
        typeof msg.selectedIndex === "number" && Number.isFinite(msg.selectedIndex)
          ? msg.selectedIndex
          : undefined,
      order: Array.isArray(msg.order) ? msg.order.filter((item) => typeof item === "number") : undefined,
    });
  });

  panel.onDidDispose(() => {
    disposed = true;
    resolvePending({ type: "cancel" });
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
        items: question.items ?? [],
      });
    },

    showFeedback(opts: {
      message: string;
      missed?: { text: string; evidence?: string }[];
      correctOption?: string;
      allowDispute?: boolean;
      explained?: boolean;
    }): void {
      if (disposed) {
        return;
      }
      post({
        type: "showFeedback",
        message: opts.message,
        missed: opts.missed ?? [],
        correctOption: opts.correctOption ?? "",
        allowDispute: opts.allowDispute === true,
        explained: opts.explained === true,
      });
    },

    waitForSubmit(): Promise<QuizAction> {
      if (queuedAction) {
        const action = queuedAction;
        queuedAction = null;
        return Promise.resolve(action);
      }
      if (disposed) {
        return Promise.resolve({ type: "cancel" });
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
