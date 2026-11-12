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
    /** true = correct answer, false = wrong answer. Drives goblin state image. */
    passed?: boolean;
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

interface MediaUris {
  goblinSleep:   string;
  goblinIdle:    string;
  goblinCorrect: string;
  goblinWrong:   string;
}

function getWebviewHtml(
  webview: vscode.Webview,
  _snippet: string,
  _language: string,
  nonce: string,
  uris: MediaUris,
): string {
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Comprehension check</title>
  <style>
    /* ── Figma design tokens ────────────────────────────────────────────────── */
    :root {
      --accent:        #74ab7b;
      --accent-light:  #c8e4cc;
      --accent-dim:    rgba(116,171,123,0.16);
      --accent-muted:  rgba(116,171,123,0.55);
      --surface:       rgba(43,43,43,0.50);
      --surface-solid: #2b2b2b;
      --on-accent:     #2b2b2b;
      --r-pill:        999px;
      --r-card:        24px;
      --r-sm:          8px;
    }

    html, body { height: 100%; margin: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size:   var(--vscode-font-size);
      color: var(--accent);
      background:
        radial-gradient(
          ellipse 140% 120% at 50% 210%,
          #74ab7b  0%,
          #647366 40%,
          #373e38 62%,
          #202421 78%,
          #0d0f0d 90%,
          #0a0a0a 100%
        );
      background-color: #0a0a0a;
      line-height: 1.5;
      box-sizing: border-box;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    /* ── Loading overlay ───────────────────────────────────────────────────── */
    .loading-overlay {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 18px;
      background: #0a0a0a;
      opacity: 0;
      pointer-events: none;
      transition: opacity 240ms ease;
    }
    .loading-overlay.active {
      opacity: 1;
      pointer-events: all;
    }
    .loading-goblin img {
      display: block;
      width: 90px;
      height: 90px;
      object-fit: contain;
      image-rendering: pixelated;
      animation: goblin-bounce 800ms ease-in-out infinite alternate;
    }
    .loading-label {
      margin: 0;
      color: var(--accent-muted);
      font-size: 0.9em;
      letter-spacing: 0.04em;
      animation: loading-label-pulse 1.6s ease-in-out infinite;
    }

    /* ── Scrollable layout ─────────────────────────────────────────────────── */
    .quiz-scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-width: thin;
      scrollbar-color: rgba(116,171,123,0.3) transparent;
    }
    .quiz-wrap {
      display: flex;
      flex-direction: column;
      min-height: 100%;
      padding: 14px 20px 16px;
      box-sizing: border-box;
    }

    /* ── Header ─────────────────────────────────────────────────────────────── */
    .panel-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin-bottom: 12px;
    }
    .brand-title {
      margin: 0 0 8px;
      /* Figma: clamp(2.25rem, 5.33cqw, 3.125rem) — using 2.25rem (Figma minimum) for panel width */
      font-size: 2.25rem;
      font-weight: 700;
      line-height: 1.5;
      letter-spacing: 0.02em;
      color: var(--accent);
      text-align: center;
    }

    /* ── Question frame ────────────────────────────────────────────────────── */
    .q-frame {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .q-frame.transitioning { animation: q-swap 380ms ease both; }

    /* ── Question meta ─────────────────────────────────────────────────────── */
    .q-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .q-label {
      font-weight: 600;
      font-size: 1em;
      letter-spacing: 0.02em;
      color: var(--accent);
    }
    .progress-dots { display: flex; gap: 7px; align-items: center; }
    .dot {
      width: 11px; height: 11px;
      border-radius: 50%; flex-shrink: 0;
      transition: background-color 300ms ease, opacity 300ms ease;
    }
    .dot-done    { background: var(--accent); opacity: 0.72; }
    .dot-active  { background: var(--accent); opacity: 1; animation: dot-activate 320ms cubic-bezier(0.34,1.56,0.64,1); }
    .dot-inactive{ background: rgba(116,171,123,0.22); opacity: 1; }

    /* ── Goblin button (Figma: .q3-troll-button) ──────────────────────────── */
    .goblin-area {
      display: flex;
      justify-content: center;
      /* reserve space for the absolutely-positioned tooltip (14px gap + ~22px height) */
      margin: 4px 0 0;
      padding-bottom: 38px;
    }
    .goblin-btn {
      position: relative;
      display: grid;
      place-items: center;
      background: transparent;
      border: none;
      border-radius: 50%;
      padding: 4px;
      cursor: pointer;
      transition:
        transform  220ms cubic-bezier(0.34,1.56,0.64,1),
        filter     220ms ease;
      -webkit-tap-highlight-color: transparent;
    }
    /* Goblin image element — src swaps between states with a short fade */
    .goblin-img {
      display: block;
      width: 90px;
      height: 90px;
      object-fit: contain;
      image-rendering: pixelated;
      transition: opacity 160ms ease;
    }
    .goblin-btn:not([disabled]):hover {
      transform: translateY(-3px) scale(1.08);
      filter: drop-shadow(0 0 14px rgba(116,171,123,0.38));
    }
    .goblin-btn:not([disabled]):active {
      transform: translateY(1px) scale(0.96);
    }
    .goblin-btn:focus-visible {
      outline: 3px solid var(--accent);
      outline-offset: 8px;
    }
    /* Non-interactive states: no pointer, no hover effect */
    .goblin-btn[disabled] { cursor: default; }
    /* Tooltip (hidden when button is disabled) */
    .goblin-tooltip {
      position: absolute;
      top: calc(100% + 14px);
      left: 50%;
      width: max-content;
      max-width: 190px;
      border-radius: 30px;
      background: var(--accent);
      padding: 7px 14px;
      color: var(--on-accent);
      font-size: 0.82em;
      letter-spacing: 0.03em;
      opacity: 0;
      pointer-events: none;
      transform: translate(-50%, -6px) scale(0.92);
      transition: opacity 180ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1);
      white-space: nowrap;
    }
    .goblin-btn:not([disabled]):hover .goblin-tooltip,
    .goblin-btn:not([disabled]):focus-visible .goblin-tooltip {
      opacity: 1;
      transform: translate(-50%, 0) scale(1);
    }
    .goblin-btn.goblin-clicked {
      animation: goblin-click-wobble 520ms cubic-bezier(0.34,1.56,0.64,1) both;
      pointer-events: none;
    }
    .goblin-arrive { animation: goblin-arrive 560ms cubic-bezier(0.22,1,0.36,1) both; }

    /* ── Question card: flat dark bg ──────────────────────────────────────── */
    .question-card {
      background: #0a0a0a;
      border-radius: var(--r-card);
      padding: 16px 0 4px;
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .question-text {
      margin: 0 0 16px;
      font-weight: 600;
      font-size: 1em;
      letter-spacing: 0.02em;
      color: var(--accent);
      line-height: 1.5;
    }
    .answer-area { margin-bottom: 14px; }

    /* ── Textarea ──────────────────────────────────────────────────────────── */
    textarea {
      width: 100%;
      min-height: 110px;
      box-sizing: border-box;
      padding: 14px 16px;
      font-family: var(--vscode-font-family);
      font-size:   var(--vscode-font-size);
      color: var(--accent);
      background: var(--surface);
      border: 3px solid var(--accent);
      border-radius: 30px;
      resize: vertical;
      transition: border-color 180ms ease, box-shadow 180ms ease;
      outline: none;
    }
    textarea:focus {
      border-color: var(--accent-light);
      box-shadow: 0 0 0 3px rgba(116,171,123,0.15);
    }
    textarea::placeholder { color: rgba(116,171,123,0.25); opacity: 1; }

    /* ── MCQ ──────────────────────────────────────────────────────────────── */
    .mcq-fieldset { margin: 0; padding: 0; border: 0; }
    .mcq-legend {
      position: absolute;
      width: 1px; height: 1px;
      overflow: hidden; opacity: 0; pointer-events: none;
    }
    .mcq-options { display: grid; gap: 18px; }
    .mcq-option {
      display: flex;
      align-items: center;
      gap: 18px;
      cursor: pointer;
      color: var(--accent);
      font-family: var(--vscode-font-family);
      font-size:   var(--vscode-font-size);
      line-height: 1.5;
      user-select: none;
      animation: q2-option-enter 360ms ease-out both;
    }
    .mcq-option:nth-child(1) { animation-delay:   0ms; }
    .mcq-option:nth-child(2) { animation-delay:  55ms; }
    .mcq-option:nth-child(3) { animation-delay: 110ms; }
    .mcq-option:nth-child(4) { animation-delay: 165ms; }
    .mcq-option:nth-child(5) { animation-delay: 220ms; }
    .mcq-option input[type="radio"] {
      position: absolute;
      width: 1px; height: 1px;
      overflow: hidden; opacity: 0; pointer-events: none;
    }
    .mcq-radio {
      flex: 0 0 28px;
      width: 28px; height: 28px;
      border: 3px solid var(--accent);
      border-radius: 50%;
      background: var(--surface);
      transition: background-color 160ms ease, transform 160ms ease;
    }
    .mcq-option:hover .mcq-radio { transform: scale(1.06); }
    .mcq-option input:checked + .mcq-radio {
      background: var(--accent);
      animation: q2-radio-select 260ms cubic-bezier(0.34,1.56,0.64,1);
    }
    .mcq-option input:focus-visible + .mcq-radio {
      outline: 3px solid var(--accent-light);
      outline-offset: 4px;
    }
    .mcq-option input:disabled ~ * { cursor: default; }

    /* ── Ordering ──────────────────────────────────────────────────────────── */
    .ordering-row {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 14px; margin: 5px 0;
      background: var(--surface);
      border: 1px solid rgba(116,171,123,0.28);
      border-radius: var(--r-sm);
      color: var(--accent);
    }
    .ordering-row button {
      padding: 3px 9px; font-size: 0.8em;
      color: var(--accent); background: var(--accent-dim);
      border: 1px solid rgba(116,171,123,0.3); border-radius: 4px;
      cursor: pointer;
      transition: background-color 150ms ease, transform 120ms ease;
    }
    .ordering-row button:hover  { background: rgba(116,171,123,0.3); }
    .ordering-row button:active { transform: scale(0.94); }

    /* ── Submit pill ──────────────────────────────────────────────────────── */
    .submit-pill {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      width: 180px; margin: 16px auto 0; padding: 11px 0;
      font-family: var(--vscode-font-family);
      font-size: 1em; font-weight: 600; letter-spacing: 0.04em;
      color: var(--accent);
      background: var(--surface);
      border: 3px solid var(--accent);
      border-radius: 100px;
      cursor: pointer;
      transition:
        background-color 180ms ease, color 180ms ease,
        transform 180ms ease, box-shadow 180ms ease;
      -webkit-tap-highlight-color: transparent;
    }
    .submit-pill:hover:not(:disabled):not(.loading) {
      background: var(--accent); color: var(--on-accent);
    }
    .submit-pill:active:not(:disabled):not(.loading) {
      transform: scale(0.98);
      border-color: var(--on-accent);
      background: var(--accent);
      box-shadow: inset 0 0 0 17px var(--surface-solid);
      color: var(--surface-solid);
    }
    .submit-pill.loading { pointer-events: none; animation: submit-loading-pulse 1.4s ease-in-out infinite; }
    .submit-label {}
    .submit-dots { display: none; gap: 5px; align-items: center; }
    .submit-pill.loading .submit-label { display: none; }
    .submit-pill.loading .submit-dots  { display: flex; }
    .submit-dots span {
      display: block; width: 7px; height: 7px;
      border-radius: 50%; background: currentColor;
      animation: dot-pulse 1.1s ease-in-out infinite;
    }
    .submit-dots span:nth-child(2) { animation-delay: 0.18s; }
    .submit-dots span:nth-child(3) { animation-delay: 0.36s; }

    /* ── Explanation card (Figma: QuestionExplanation) ────────────────────── */
    .exp-card {
      background: #0a0a0a;
      border-radius: var(--r-card);
      padding: 16px 0 4px;
      flex: 1; display: flex; flex-direction: column;
    }
    .exp-heading {
      margin: 0 0 14px;
      font-size: 1em; font-weight: 600; letter-spacing: 0.02em;
      color: var(--accent); line-height: 1.5; text-align: center;
      animation: q3-copy-enter 380ms 180ms ease-out both;
    }
    /* Figma: .q3-explanation-text */
    .exp-text-box {
      border: 1px solid rgba(116,171,123,0.24);
      border-radius: var(--r-card);
      background: rgba(43,43,43,0.32);
      padding: 12px 16px;
      color: var(--accent);
      font-size: 0.93em; font-weight: 400; line-height: 1.55; letter-spacing: 0.02em;
      margin-bottom: 12px;
      animation: q3-copy-enter 420ms 260ms ease-out both;
    }
    .exp-answer-label {
      margin: 8px 0 6px;
      font-size: 0.9em; font-weight: 600; letter-spacing: 0.02em;
      color: var(--accent);
      animation: q3-copy-enter 360ms 320ms ease-out both;
    }
    /* Figma: .q3-explanation-answer */
    .exp-answer-block {
      border-radius: var(--r-card);
      background: rgba(43,43,43,0.22);
      padding: 12px 16px;
      color: var(--accent);
      font-size: 0.93em; font-weight: 500; line-height: 1.5; letter-spacing: 0.02em;
      margin-bottom: 14px;
      animation: q3-answer-reveal 420ms 360ms cubic-bezier(0.34,1.56,0.64,1) both;
    }
    .exp-next-label { display: inline-block; animation: q3-copy-enter 260ms 180ms ease-out both; }

    /* ── Feedback panel (regular) ─────────────────────────────────────────── */
    .feedback-panel {
      margin: 14px 0 8px;
      padding: 14px 16px;
      border-radius: var(--r-card);
      border-left: 3px solid var(--accent);
      background: rgba(43,43,43,0.45);
      animation: feedback-enter 280ms ease-out both;
    }
    .feedback-panel.hidden { display: none; }
    .feedback-msg    { margin: 0 0 6px; color: var(--accent); font-weight: 600; }
    .missed-list     { margin: 8px 0 0; padding-left: 18px; color: var(--accent-muted); }
    .missed-list li  { margin-bottom: 6px; }
    .evidence {
      display: block; margin-top: 4px;
      font-size: 0.88em; color: rgba(116,171,123,0.5); font-style: italic;
    }
    .correct-option { margin-top: 8px; font-weight: 600; color: var(--accent); }
    .feedback-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .dispute-btn, .next-q-btn {
      display: inline-flex; align-items: center;
      padding: 7px 16px;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
      font-weight: 500; color: var(--accent);
      background: var(--surface);
      border: 2px solid rgba(116,171,123,0.45); border-radius: var(--r-pill);
      cursor: pointer;
      transition: background-color 180ms ease, border-color 180ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1);
    }
    .dispute-btn:hover, .next-q-btn:hover {
      background: var(--accent-dim); border-color: var(--accent); transform: translateY(-1px);
    }
    .dispute-btn:active, .next-q-btn:active { transform: scale(0.95); }
    .next-q-btn { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
    .next-q-btn:hover { background: var(--accent-light); border-color: var(--accent-light); }

    .hidden { display: none !important; }

    /* ── Keyframes ─────────────────────────────────────────────────────────── */
    @keyframes dot-pulse {
      0%, 80%, 100% { transform: scale(0.5); opacity: 0.4; }
      40%           { transform: scale(1);   opacity: 1;   }
    }
    @keyframes q2-radio-select {
      0%   { transform: scale(1);    }
      55%  { transform: scale(1.13); }
      100% { transform: scale(1);    }
    }
    @keyframes dot-activate {
      0%   { transform: scale(0.4); opacity: 0.3; }
      65%  { transform: scale(1.3); }
      100% { transform: scale(1);   opacity: 1;   }
    }
    @keyframes q2-option-enter {
      from { opacity: 0; transform: translateX(-12px); }
      to   { opacity: 1; transform: translateX(0);     }
    }
    @keyframes feedback-enter {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0);    }
    }
    @keyframes goblin-arrive {
      from { opacity: 0; transform: translateY(8px) scale(0.15); }
      to   { opacity: 1; transform: translateY(0)   scale(1);    }
    }
    @keyframes goblin-bounce {
      from { opacity: 0.6; transform: scale(0.95) translateY(3px);  }
      to   { opacity: 1;   transform: scale(1)    translateY(-5px); }
    }
    @keyframes loading-label-pulse {
      0%, 100% { opacity: 0.5; }
      50%      { opacity: 1;   }
    }
    @keyframes submit-loading-pulse {
      0%, 100% { border-color: rgba(116,171,123,0.4); }
      50%      { border-color: var(--accent);          }
    }
    @keyframes q-swap {
      0%   { opacity: 1; transform: translateX(0);     }
      35%  { opacity: 0; transform: translateX(-14px); }
      65%  { opacity: 0; transform: translateX(14px);  }
      100% { opacity: 1; transform: translateX(0);     }
    }
    @keyframes screen-enter {
      from { opacity: 0; transform: scale(0.985); filter: blur(3px); }
      to   { opacity: 1; transform: scale(1);     filter: blur(0);   }
    }
    @keyframes goblin-click-wobble {
      0%   { transform: translateY(2px)  scale(1.06, 0.88); }
      28%  { transform: translateY(-9px) scale(0.94, 1.08); }
      55%  { transform: translateY(-3px) scale(1.03, 0.98); }
      75%  { transform: translateY(-6px) scale(0.98, 1.03); }
      100% { transform: translateY(0)    scale(1); }
    }
    @keyframes q3-copy-enter {
      from { opacity: 0; transform: translateY(12px); filter: blur(2px); }
      to   { opacity: 1; transform: translateY(0);    filter: blur(0);   }
    }
    @keyframes q3-answer-reveal {
      from { opacity: 0; transform: translateX(-16px) scale(0.97); }
      to   { opacity: 1; transform: translateX(0)     scale(1);    }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 1ms !important; transition-duration: 1ms !important;
        animation-iteration-count: 1 !important; scroll-behavior: auto !important;
      }
    }
  </style>
</head>
<body>
  <!-- Loading overlay shown while grading -->
  <div class="loading-overlay" id="loading-overlay" role="status" aria-label="Checking your answer">
    <div class="loading-goblin">
      <img src="${uris.goblinSleep}" alt="" aria-hidden="true">
    </div>
    <p class="loading-label">Checking your answer\u2026</p>
  </div>

  <div class="quiz-scroll">
  <div class="quiz-wrap" style="animation: screen-enter 420ms ease both;">

    <!-- Header: DrawBridge brand title (Figma: brand-title h1) -->
    <header class="panel-header">
      <h1 class="brand-title">DrawBridge</h1>
    </header>

    <!-- Question frame -->
    <div class="q-frame" id="q-frame">

      <!-- Question meta: label + progress dots -->
      <header class="q-meta">
        <span class="q-label" id="q-label">Question 1</span>
        <div class="progress-dots" id="progress-dots" aria-hidden="true"></div>
      </header>

      <!--
        Goblin button (Figma: .q3-troll-button).
        src swaps between sleep / idle / correct / wrong based on quiz state.
        Initially sleep (disabled). Becomes idle+enabled on showQuestion.
      -->
      <div class="goblin-area">
        <button type="button" class="goblin-btn goblin-arrive" id="explain-btn"
                aria-label="Show explanation and skip this question" disabled>
          <img id="goblin-img" src="${uris.goblinSleep}" class="goblin-img" alt="" aria-hidden="true">
          <span class="goblin-tooltip">Show explanation</span>
        </button>
      </div>

      <!-- Question card: flat #0a0a0a background (Figma: question content section) -->
      <div class="question-card" id="question-card">
        <p id="question" class="question-text"></p>
        <div id="answer-area" class="answer-area"></div>
        <button type="button" class="submit-pill" id="submit-btn" aria-label="Submit answer">
          <span class="submit-label">Submit!</span>
          <span class="submit-dots" aria-hidden="true"><span></span><span></span><span></span></span>
        </button>
      </div>

      <!-- Explanation card (Figma: QuestionExplanation) — shown after clicking goblin -->
      <div class="exp-card hidden" id="exp-card">
        <h2 id="exp-heading" class="exp-heading"></h2>
        <div class="exp-text-box" id="exp-text-box"></div>
        <p class="exp-answer-label hidden" id="exp-answer-label">Correct answer</p>
        <div class="exp-answer-block hidden" id="exp-answer-block"></div>
        <button type="button" class="submit-pill" id="exp-next-btn">
          <span class="exp-next-label">Next Question</span>
        </button>
      </div>

    </div><!-- /.q-frame -->

    <!-- Feedback panel (correct / incorrect after grading) -->
    <div class="feedback-panel hidden" id="feedback" aria-live="polite">
      <p id="feedback-msg" class="feedback-msg"></p>
      <ul id="missed-list" class="missed-list hidden"></ul>
      <p id="correct-option" class="correct-option hidden"></p>
      <div class="feedback-actions">
        <button type="button" class="dispute-btn hidden" id="dispute-btn">My answer was right</button>
        <button type="button" class="next-q-btn hidden" id="next-q-btn">Next Question</button>
      </div>
    </div>

  </div><!-- /.quiz-wrap -->
  </div><!-- /.quiz-scroll -->

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    /* ── Goblin URI constants (injected from extension host) ─────────────── */
    var URI_SLEEP   = ${JSON.stringify(uris.goblinSleep)};
    var URI_IDLE    = ${JSON.stringify(uris.goblinIdle)};
    var URI_CORRECT = ${JSON.stringify(uris.goblinCorrect)};
    var URI_WRONG   = ${JSON.stringify(uris.goblinWrong)};

    /* ── Element refs ────────────────────────────────────────────────────── */
    var qLabelEl       = document.getElementById("q-label");
    var progressEl     = document.getElementById("progress-dots");
    var questionEl     = document.getElementById("question");
    var answerAreaEl   = document.getElementById("answer-area");
    var submitBtn      = document.getElementById("submit-btn");
    var explainBtn     = document.getElementById("explain-btn");
    var goblinImg      = document.getElementById("goblin-img");
    var feedbackEl     = document.getElementById("feedback");
    var feedbackMsgEl  = document.getElementById("feedback-msg");
    var missedListEl   = document.getElementById("missed-list");
    var correctOptEl   = document.getElementById("correct-option");
    var disputeBtn     = document.getElementById("dispute-btn");
    var nextQBtn       = document.getElementById("next-q-btn");
    var qFrameEl       = document.getElementById("q-frame");
    var loadingOverlay = document.getElementById("loading-overlay");
    var questionCardEl = document.getElementById("question-card");
    var expCardEl      = document.getElementById("exp-card");
    var expHeadingEl   = document.getElementById("exp-heading");
    var expTextBoxEl   = document.getElementById("exp-text-box");
    var expAnswerLblEl = document.getElementById("exp-answer-label");
    var expAnswerBlkEl = document.getElementById("exp-answer-block");
    var expNextBtn     = document.getElementById("exp-next-btn");

    /* ── State ───────────────────────────────────────────────────────────── */
    var currentKind = "free-text";
    var lastAnswer  = "";
    var questionNum = 1;
    var showQCount  = 0;
    var TOTAL_DOTS  = 5;
    var explaining  = false;

    var q2Demo = {
      kind: "multiple-choice",
      questionText: "Which statement best describes this code\u2019s behavior?",
      options: [
        "It correctly handles all expected inputs",
        "It has a logic error in the main execution path",
        "It is missing error handling for edge cases",
        "It performs unnecessary or redundant operations"
      ],
      items: []
    };

    /* ── Goblin state machine ─────────────────────────────────────────────
     *
     *  sleep   — panel waiting, no question yet  (disabled, non-clickable)
     *  idle    — question active, goblin = explain button (enabled, clickable)
     *  correct — correct answer shown              (disabled)
     *  wrong   — incorrect answer shown            (disabled)
     *
     *  Transitions have a 160ms opacity crossfade.
     * ──────────────────────────────────────────────────────────────────── */
    function setGoblinState(uri, canExplain) {
      goblinImg.style.opacity = "0";
      setTimeout(function() {
        goblinImg.src = uri;
        goblinImg.style.opacity = "1";
        explainBtn.disabled = !canExplain;
      }, 160);
    }

    /* ── Progress dots ───────────────────────────────────────────────────── */
    function renderDots(current) {
      progressEl.innerHTML = "";
      for (var i = 1; i <= TOTAL_DOTS; i++) {
        var d = document.createElement("span");
        d.className = "dot " + (i < current ? "dot-done" : i === current ? "dot-active" : "dot-inactive");
        progressEl.appendChild(d);
      }
    }

    /* ── Loading overlay ─────────────────────────────────────────────────── */
    function setLoading(on) {
      if (on) {
        loadingOverlay.classList.add("active");
      } else {
        loadingOverlay.classList.remove("active");
      }
    }

    /* ── Switch between question card and explanation card ───────────────── */
    function showExplanationCard() {
      explaining = true;
      questionCardEl.classList.add("hidden");
      feedbackEl.classList.add("hidden");
      expCardEl.classList.remove("hidden");
    }

    function showQuestionCard() {
      explaining = false;
      expCardEl.classList.add("hidden");
      questionCardEl.classList.remove("hidden");
    }

    /* ── Clear feedback ──────────────────────────────────────────────────── */
    function clearFeedback() {
      feedbackEl.classList.add("hidden");
      feedbackMsgEl.textContent = "";
      missedListEl.innerHTML = "";
      missedListEl.classList.add("hidden");
      correctOptEl.textContent = "";
      correctOptEl.classList.add("hidden");
      disputeBtn.classList.add("hidden");
      nextQBtn.classList.add("hidden");
    }

    /* ── Render answer area ──────────────────────────────────────────────── */
    function renderAnswerArea(kind, payload) {
      currentKind = kind;
      answerAreaEl.innerHTML = "";

      if (kind === "ordering" && Array.isArray(payload.items) && payload.items.length) {
        payload.items.forEach(function (item, idx) {
          var row = document.createElement("div");
          row.className = "ordering-row";
          row.dataset.index = String(idx);
          var up = document.createElement("button");
          up.type = "button"; up.textContent = "\u25B2"; up.setAttribute("aria-label", "Move up");
          var down = document.createElement("button");
          down.type = "button"; down.textContent = "\u25BC"; down.setAttribute("aria-label", "Move down");
          up.addEventListener("click", function () {
            if (row.previousElementSibling) answerAreaEl.insertBefore(row, row.previousElementSibling);
          });
          down.addEventListener("click", function () {
            if (row.nextElementSibling) answerAreaEl.insertBefore(row.nextElementSibling, row);
          });
          var lbl = document.createElement("span"); lbl.textContent = item;
          row.appendChild(up); row.appendChild(down); row.appendChild(lbl);
          answerAreaEl.appendChild(row);
        });
      } else if (kind === "multiple-choice" && Array.isArray(payload.options) && payload.options.length) {
        var fs = document.createElement("fieldset"); fs.className = "mcq-fieldset";
        var leg = document.createElement("legend"); leg.className = "mcq-legend";
        leg.textContent = payload.questionText || "Choose an answer";
        fs.appendChild(leg);
        var grid = document.createElement("div"); grid.className = "mcq-options";
        payload.options.forEach(function (opt, idx) {
          var lbl = document.createElement("label"); lbl.className = "mcq-option";
          var inp = document.createElement("input");
          inp.type = "radio"; inp.name = "mcq"; inp.value = String(idx);
          var radio = document.createElement("span"); radio.className = "mcq-radio"; radio.setAttribute("aria-hidden","true");
          var txt = document.createElement("span"); txt.textContent = opt;
          lbl.appendChild(inp); lbl.appendChild(radio); lbl.appendChild(txt);
          grid.appendChild(lbl);
        });
        fs.appendChild(grid);
        answerAreaEl.appendChild(fs);
      } else {
        var ta = document.createElement("textarea");
        ta.id = "answer-input";
        ta.placeholder = "Explain in your own words, then press Submit!";
        ta.addEventListener("keydown", function (e) {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); collectSubmit(); }
        });
        answerAreaEl.appendChild(ta);
        ta.focus();
      }
    }

    /* ── Render a question (host-driven) ─────────────────────────────────── */
    function renderQuestion(payload) {
      showQCount++;
      questionNum = showQCount;

      if (questionNum > 1) {
        qFrameEl.classList.add("transitioning");
        setTimeout(function () { qFrameEl.classList.remove("transitioning"); }, 400);
        qFrameEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      qLabelEl.textContent = "Question " + questionNum;
      renderDots(questionNum);

      if (explaining) { showQuestionCard(); }

      clearFeedback();
      setLoading(false);
      submitBtn.classList.remove("hidden");

      /* Goblin → sleep but clickable (Figma: sleeping goblin is the explain button during Q) */
      setGoblinState(URI_SLEEP, true);

      questionEl.textContent = payload.questionText || "";
      renderAnswerArea(payload.kind || "free-text", payload);
    }

    /* ── Advance to the next question (called by "Next Question" and explanation next) */
    function transitionToQ2(payload) {
      var data = payload || q2Demo;
      questionNum = questionNum + 1;

      qFrameEl.classList.add("transitioning");
      setTimeout(function () { qFrameEl.classList.remove("transitioning"); }, 400);

      qLabelEl.textContent = "Question " + questionNum;
      renderDots(questionNum);

      if (explaining) { showQuestionCard(); }

      clearFeedback();
      setLoading(false);
      submitBtn.classList.remove("hidden");

      /* Goblin → sleep but clickable (Figma: sleeping goblin is the explain button during Q) */
      setGoblinState(URI_SLEEP, true);

      questionEl.textContent = data.questionText || q2Demo.questionText;
      renderAnswerArea(
        data.kind || q2Demo.kind,
        { questionText: data.questionText || q2Demo.questionText,
          options: (data.options && data.options.length) ? data.options : q2Demo.options,
          items:   (data.items  && data.items.length)   ? data.items   : q2Demo.items  }
      );
      qFrameEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    /* ── Show feedback ──────────────────────────────────────────────────────
     *
     *  passed === true  → goblin-correct (disabled)
     *  passed === false → goblin-wrong   (disabled)
     *  explained === true → goblin-sleep  (disabled), explanation card shown
     * ──────────────────────────────────────────────────────────────────── */
    function showFeedback(payload) {
      setLoading(false);

      /* Explanation state: full Figma QuestionExplanation screen */
      if (payload.explained) {
        expHeadingEl.textContent = questionEl.textContent || "";
        var rawMsg = payload.message || "";
        expTextBoxEl.textContent = rawMsg.startsWith("Explanation: ")
          ? rawMsg.slice("Explanation: ".length)
          : rawMsg;
        if (payload.correctOption) {
          expAnswerBlkEl.textContent = payload.correctOption;
          expAnswerLblEl.classList.remove("hidden");
          expAnswerBlkEl.classList.remove("hidden");
        } else {
          expAnswerLblEl.classList.add("hidden");
          expAnswerBlkEl.classList.add("hidden");
        }
        submitBtn.classList.add("hidden");
        /* Figma QuestionExplanation uses the standing troll (idle/arms-out) */
        setGoblinState(URI_IDLE, false);
        showExplanationCard();
        return;
      }

      /* Correct answer: swap goblin, show positive feedback */
      if (payload.passed === true) {
        setGoblinState(URI_CORRECT, false);
        feedbackMsgEl.textContent = payload.message || "Correct!";
        missedListEl.classList.add("hidden");
        correctOptEl.classList.add("hidden");
        disputeBtn.classList.add("hidden");
        nextQBtn.classList.add("hidden");
        feedbackEl.classList.remove("hidden");
        submitBtn.classList.add("hidden");
        return;
      }

      /* Wrong answer: swap goblin to wrong, show feedback panel */
      if (payload.passed === false) {
        setGoblinState(URI_WRONG, false);
      }

      /* Regular feedback (wrong answer or validation message) */
      feedbackMsgEl.textContent = payload.message || "";
      missedListEl.innerHTML = "";
      if (Array.isArray(payload.missed) && payload.missed.length > 0) {
        missedListEl.classList.remove("hidden");
        payload.missed.forEach(function (item) {
          var li = document.createElement("li");
          li.textContent = item.text || "";
          if (item.evidence) {
            var ev = document.createElement("span");
            ev.className = "evidence"; ev.textContent = item.evidence;
            li.appendChild(ev);
          }
          missedListEl.appendChild(li);
        });
      } else {
        missedListEl.classList.add("hidden");
      }
      if (payload.correctOption) {
        correctOptEl.textContent = "Correct answer: " + payload.correctOption;
        correctOptEl.classList.remove("hidden");
      } else {
        correctOptEl.classList.add("hidden");
      }
      feedbackEl.classList.remove("hidden");
      if (payload.allowDispute) {
        disputeBtn.classList.remove("hidden");
      } else {
        disputeBtn.classList.add("hidden");
      }
      /* Show "Next Question" for any wrong answer so users see all follow-up rounds */
      if (!payload.explained && payload.passed !== true) {
        nextQBtn.classList.remove("hidden");
      }
      if (currentKind === "free-text") {
        var ta = document.getElementById("answer-input");
        if (ta) { ta.value = ""; ta.focus(); }
      } else {
        var checked = answerAreaEl.querySelector('input[name="mcq"]:checked');
        if (checked) { checked.checked = false; }
      }
    }

    /* ── Collect and post submit ─────────────────────────────────────────── */
    function collectSubmit() {
      if (currentKind === "ordering") {
        var order = Array.from(answerAreaEl.querySelectorAll("[data-index]")).map(function (r) {
          return parseInt(r.dataset.index, 10);
        });
        setGoblinState(URI_SLEEP, false);
        setLoading(true);
        vscode.postMessage({ type: "submit", order: order });
        return;
      }
      if (currentKind === "multiple-choice") {
        var sel = answerAreaEl.querySelector('input[name="mcq"]:checked');
        if (!sel) {
          showFeedback({ message: "Please select an option before submitting." });
          return;
        }
        lastAnswer = sel.parentElement ? sel.parentElement.textContent.trim() : "";
        setGoblinState(URI_SLEEP, false);
        setLoading(true);
        vscode.postMessage({ type: "submit", selectedIndex: parseInt(sel.value, 10) });
        return;
      }
      var ta = document.getElementById("answer-input");
      var answer = ta ? ta.value : "";
      lastAnswer = answer;
      setGoblinState(URI_SLEEP, false);
      setLoading(true);
      vscode.postMessage({ type: "submit", answer: answer });
    }

    /* ── Button listeners ────────────────────────────────────────────────── */
    submitBtn.addEventListener("click", collectSubmit);

    explainBtn.addEventListener("click", function () {
      explainBtn.classList.remove("goblin-clicked");
      void explainBtn.offsetWidth;
      explainBtn.classList.add("goblin-clicked");
      vscode.postMessage({ type: "explain" });
    });
    explainBtn.addEventListener("animationend", function (e) {
      if (e.animationName === "goblin-click-wobble") {
        explainBtn.classList.remove("goblin-clicked");
      }
    });

    disputeBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "dispute", answer: lastAnswer });
    });
    nextQBtn.addEventListener("click", function () {
      transitionToQ2(null);
    });
    expNextBtn.addEventListener("click", function () {
      transitionToQ2(null);
    });

    /* ── Startup ─────────────────────────────────────────────────────────── */
    renderDots(1);
    vscode.postMessage({ type: "ready" });

    /* ── Host message handler ────────────────────────────────────────────── */
    window.addEventListener("message", function (event) {
      var msg = event.data;
      if (!msg || !msg.type) return;
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

export function createQuizPanel(
  snippet: string,
  language: string,
  extensionUri?: vscode.Uri,
): QuizView {
  const nonce = getNonce();

  const localResourceRoots = extensionUri
    ? [vscode.Uri.joinPath(extensionUri, "media")]
    : [];

  // Panel must be created before makeUri so panel.webview is available.
  // Open Beside so the decorated text editor stays visible while the user answers.
  const panel = vscode.window.createWebviewPanel(
    "comprehensionGuard.quiz",
    "Comprehension check",
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots },
  );
  panel.reveal(vscode.ViewColumn.Beside, false);

  const makeUri = (file: string): string =>
    extensionUri
      ? panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", file)).toString()
      : "";

  const uris: MediaUris = {
    goblinSleep:   makeUri("goblin-sleep.png"),
    goblinIdle:    makeUri("goblin-idle.png"),
    goblinCorrect: makeUri("goblin-correct.png"),
    goblinWrong:   makeUri("goblin-wrong.png"),
  };

  let disposed = false;
  let ready = false;
  const queued: unknown[] = [];
  let pendingResolve: ((value: QuizAction) => void) | null = null;
  let queuedAction: QuizAction | null = null;

  const post = (message: unknown): void => {
    if (disposed) return;
    if (!ready) { queued.push(message); return; }
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
    if (disposed || !message || typeof message !== "object") return;
    const msg = message as { type?: string; answer?: string; selectedIndex?: number; order?: number[] };
    if (msg.type === "ready") {
      ready = true;
      for (const queuedMessage of queued.splice(0)) {
        void panel.webview.postMessage(queuedMessage);
      }
      return;
    }
    if (msg.type === "bypass") { resolvePending({ type: "bypass" }); return; }
    if (msg.type === "explain") { resolvePending({ type: "explain" }); return; }
    if (msg.type === "dispute") {
      resolvePending({ type: "dispute", answer: typeof msg.answer === "string" ? msg.answer : "" });
      return;
    }
    if (msg.type !== "submit") return;
    resolvePending({
      type: "submit",
      answer: typeof msg.answer === "string" ? msg.answer : undefined,
      selectedIndex:
        typeof msg.selectedIndex === "number" && Number.isFinite(msg.selectedIndex)
          ? msg.selectedIndex : undefined,
      order: Array.isArray(msg.order)
        ? msg.order.filter((item) => typeof item === "number") : undefined,
    });
  });

  panel.onDidDispose(() => {
    disposed = true;
    resolvePending({ type: "cancel" });
  });

  panel.webview.html = getWebviewHtml(panel.webview, snippet, language, nonce, uris);

  return {
    showQuestion(question: GeneratedQuestion): void {
      if (disposed) return;
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
      passed?: boolean;
    }): void {
      if (disposed) return;
      post({
        type: "showFeedback",
        message: opts.message,
        missed: opts.missed ?? [],
        correctOption: opts.correctOption ?? "",
        allowDispute: opts.allowDispute === true,
        explained: opts.explained === true,
        passed: opts.passed,
      });
    },

    waitForSubmit(): Promise<QuizAction> {
      if (queuedAction) {
        const action = queuedAction;
        queuedAction = null;
        return Promise.resolve(action);
      }
      if (disposed) return Promise.resolve({ type: "cancel" });
      return new Promise((resolve) => { pendingResolve = resolve; });
    },

    close(): void {
      if (!disposed) panel.dispose();
    },
  };
}
