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

  /* Inline SVG goblin character — Figma troll aesthetic in the design palette */
  const goblinSvg = `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" width="72" height="72" aria-hidden="true" focusable="false">
  <ellipse cx="40" cy="76" rx="20" ry="4" fill="rgba(0,0,0,0.25)"/>
  <polygon points="40,2 54,26 26,26" fill="#3d6645"/>
  <rect x="24" y="22" width="32" height="7" rx="3.5" fill="#2f5236"/>
  <rect x="26" y="26" width="28" height="4" rx="2" fill="rgba(200,228,204,0.18)"/>
  <ellipse cx="40" cy="51" rx="22" ry="21" fill="#74ab7b"/>
  <polygon points="20,44 10,28 23,47" fill="#74ab7b"/>
  <polygon points="60,44 70,28 57,47" fill="#74ab7b"/>
  <polygon points="20,44 13,31 22,45" fill="#5a9060" opacity="0.55"/>
  <polygon points="60,44 67,31 58,45" fill="#5a9060" opacity="0.55"/>
  <ellipse cx="31" cy="47" rx="7" ry="7.5" fill="#1a2b1c"/>
  <ellipse cx="49" cy="47" rx="7" ry="7.5" fill="#1a2b1c"/>
  <circle cx="33.5" cy="44.5" r="2.5" fill="white" opacity="0.9"/>
  <circle cx="51.5" cy="44.5" r="2.5" fill="white" opacity="0.9"/>
  <circle cx="31" cy="47" r="4.5" fill="#0d1a0f"/>
  <circle cx="49" cy="47" r="4.5" fill="#0d1a0f"/>
  <circle cx="33" cy="45" r="1.6" fill="white"/>
  <circle cx="51" cy="45" r="1.6" fill="white"/>
  <ellipse cx="40" cy="56" rx="4.5" ry="3" fill="#5a9060"/>
  <circle cx="38" cy="56" r="1.3" fill="#4a7a50"/>
  <circle cx="42" cy="56" r="1.3" fill="#4a7a50"/>
  <path d="M30 63 Q40 71 50 63" fill="#2b4a2e"/>
  <path d="M32 63 Q40 69 48 63" fill="#c8e4cc"/>
  <rect x="37" y="62" width="4.5" height="6" rx="1" fill="white"/>
  <rect x="43.5" y="62" width="4" height="5" rx="1" fill="white"/>
  <ellipse cx="22" cy="58" rx="5" ry="3.5" fill="#90c896" opacity="0.35"/>
  <ellipse cx="58" cy="58" rx="5" ry="3.5" fill="#90c896" opacity="0.35"/>
</svg>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Comprehension check</title>
  <style>
    /* ── Figma design tokens (Animate Chat Loading Transition) ─────────────── */
    :root {
      --accent:        #74ab7b;
      --accent-light:  #c8e4cc;
      --accent-dim:    rgba(116,171,123,0.16);
      --accent-muted:  rgba(116,171,123,0.55);
      --surface:       rgba(43,43,43,0.52);
      --surface-solid: #2b2b2b;
      --on-accent:     #2b2b2b;
      --r-pill:        999px;
      --r-card:        24px;
      --r-sm:          8px;
    }

    /* ── Reset / body ──────────────────────────────────────────────────────── */
    html, body { height: 100%; margin: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size:   var(--vscode-font-size);
      color: var(--accent);
      /* Figma app-shell radial gradient */
      background:
        radial-gradient(
          ellipse 160% 90% at 50% 110%,
          #74ab7b 0%,
          #4d584f 22%,
          #202421 46%,
          #0d0f0d 72%,
          #0a0a0a 100%
        );
      line-height: 1.5;
      box-sizing: border-box;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    /* ── Loading overlay (fullscreen, shown while grading) ─────────────────── */
    .loading-overlay {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 18px;
      background:
        radial-gradient(
          ellipse 160% 90% at 50% 110%,
          #74ab7b 0%, #4d584f 22%, #202421 46%, #0d0f0d 72%, #0a0a0a 100%
        );
      opacity: 0;
      pointer-events: none;
      transition: opacity 240ms ease;
    }
    .loading-overlay.active {
      opacity: 1;
      pointer-events: all;
    }
    .loading-goblin {
      animation: goblin-bounce 800ms ease-in-out infinite alternate;
    }
    .loading-label {
      margin: 0;
      color: var(--accent-muted);
      font-size: 0.9em;
      letter-spacing: 0.04em;
      animation: loading-label-pulse 1.6s ease-in-out infinite;
    }

    /* ── Main scrollable quiz layout ───────────────────────────────────────── */
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
      padding: 18px 20px 16px;
      box-sizing: border-box;
    }

    /* ── Brand title (Figma: .brand-title) ─────────────────────────────────── */
    .brand-title {
      font-size: 1.25em;
      font-weight: 700;
      letter-spacing: 0.03em;
      color: var(--accent);
      text-align: center;
      margin: 0 0 16px;
    }

    /* ── Code snippet ──────────────────────────────────────────────────────── */
    .snippet-wrap {
      border: 1px solid rgba(116,171,123,0.28);
      border-radius: var(--r-card);
      margin-bottom: 16px;
      overflow: auto;
      max-height: 240px;
      background: var(--surface);
    }
    .snippet-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 14px;
      font-size: 0.8em;
      color: var(--accent-muted);
      background: rgba(43,43,43,0.6);
      border-bottom: 1px solid rgba(116,171,123,0.15);
      border-radius: var(--r-card) var(--r-card) 0 0;
    }
    pre {
      margin: 0;
      padding: 12px 14px;
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family);
      font-size:   var(--vscode-editor-font-size);
      color: var(--accent-light);
    }
    pre, code { white-space: pre; word-break: normal; }

    /* ── Question frame (Q1 / Q2 share this area) ──────────────────────────── */
    .q-frame {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .q-frame.transitioning {
      animation: q-swap 380ms ease both;
    }

    /* ── Question meta row (Figma: .question-meta) ─────────────────────────── */
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
    /* Progress dots (Figma: ProgressDots) */
    .progress-dots {
      display: flex;
      gap: 7px;
      align-items: center;
    }
    .dot {
      width: 11px; height: 11px;
      border-radius: 50%;
      flex-shrink: 0;
      transition: background-color 300ms ease, opacity 300ms ease;
    }
    .dot-done    { background: var(--accent);           opacity: 0.72; }
    .dot-active  { background: var(--accent);           opacity: 1; animation: dot-activate 320ms cubic-bezier(0.34,1.56,0.64,1); }
    .dot-inactive{ background: rgba(116,171,123,0.22); opacity: 1; }

    /* ── Goblin button area (Figma: .question-two-goblin / .q3-troll-button) ── */
    .goblin-area {
      display: flex;
      justify-content: center;
      margin: 8px 0 14px;
    }
    .goblin-btn {
      position: relative;
      display: grid;
      place-items: center;
      background: transparent;
      border: none;
      border-radius: 50%;
      padding: 6px;
      cursor: pointer;
      transition:
        transform  220ms cubic-bezier(0.34,1.56,0.64,1),
        filter     220ms ease;
      -webkit-tap-highlight-color: transparent;
    }
    .goblin-btn:hover {
      transform: translateY(-4px) scale(1.09);
      filter: drop-shadow(0 0 14px rgba(116,171,123,0.4));
    }
    .goblin-btn:active {
      transform: translateY(1px) scale(0.95);
    }
    .goblin-btn:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 6px;
    }
    .goblin-btn:disabled {
      cursor: default;
      opacity: 0.5;
    }
    /* Tooltip (Figma: .q3-troll-tooltip) */
    .goblin-tooltip {
      position: absolute;
      top: calc(100% + 12px);
      left: 50%;
      width: max-content;
      max-width: 180px;
      border-radius: var(--r-pill);
      background: var(--accent);
      padding: 6px 14px;
      color: var(--on-accent);
      font-size: 0.82em;
      letter-spacing: 0.03em;
      opacity: 0;
      pointer-events: none;
      transform: translate(-50%, -6px) scale(0.92);
      transition: opacity 180ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1);
      white-space: nowrap;
    }
    .goblin-btn:hover .goblin-tooltip,
    .goblin-btn:focus-visible .goblin-tooltip {
      opacity: 1;
      transform: translate(-50%, 0) scale(1);
    }
    .goblin-arrive { animation: goblin-arrive 560ms cubic-bezier(0.22,1,0.36,1) both; }

    /* ── Question text ─────────────────────────────────────────────────────── */
    .question-text {
      margin: 0 0 16px;
      font-weight: 600;
      font-size: 1em;
      letter-spacing: 0.02em;
      color: var(--accent);
      line-height: 1.5;
    }
    .answer-area { margin-bottom: 14px; }

    /* ── Textarea (Figma: .answer-field textarea) ───────────────────────────── */
    textarea {
      width: 100%;
      min-height: 110px;
      box-sizing: border-box;
      padding: 14px 16px;
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
      box-shadow: 0 0 0 3px rgba(116,171,123,0.15);
    }
    textarea::placeholder { color: rgba(116,171,123,0.3); opacity: 1; }

    /* ── MCQ fieldset (Figma: .mcq-card / .mcq-options) ────────────────────── */
    .mcq-fieldset { margin: 0; padding: 0; border: 0; }
    .mcq-legend {
      position: absolute;
      width: 1px; height: 1px;
      overflow: hidden; opacity: 0; pointer-events: none;
    }
    .mcq-options { display: grid; gap: 14px; }

    /* ── MCQ Option (Figma: .mcq-option with custom .mcq-radio) ─────────────── */
    .mcq-option {
      display: flex;
      align-items: center;
      gap: 16px;
      cursor: pointer;
      color: var(--accent);
      font-family: var(--vscode-font-family);
      font-size:   var(--vscode-font-size);
      line-height: 1.4;
      user-select: none;
      animation: option-enter 320ms ease-out both;
    }
    .mcq-option:nth-child(1) { animation-delay:   0ms; }
    .mcq-option:nth-child(2) { animation-delay:  65ms; }
    .mcq-option:nth-child(3) { animation-delay: 130ms; }
    .mcq-option:nth-child(4) { animation-delay: 195ms; }
    .mcq-option:nth-child(5) { animation-delay: 260ms; }

    .mcq-option input[type="radio"] {
      position: absolute;
      width: 1px; height: 1px;
      overflow: hidden; opacity: 0; pointer-events: none;
    }
    .mcq-radio {
      flex: 0 0 24px;
      width: 24px; height: 24px;
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
      padding: 9px 14px;
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

    /* ── Submit pill (Figma: .submit-button large pill, centered) ───────────── */
    .submit-pill {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 180px;
      margin: 16px auto 0;
      padding: 11px 0;
      font-family: var(--vscode-font-family);
      font-size:   1em;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: var(--accent);
      background: var(--surface);
      border: 2px solid var(--accent);
      border-radius: var(--r-pill);
      cursor: pointer;
      transition:
        background-color 180ms ease,
        color            180ms ease,
        transform        180ms ease,
        box-shadow       180ms ease;
      -webkit-tap-highlight-color: transparent;
    }
    .submit-pill:hover:not(:disabled):not(.loading) {
      background: var(--accent);
      color: var(--on-accent);
    }
    /* Figma .submit-button:active — press + inset ring */
    .submit-pill:active:not(:disabled):not(.loading) {
      transform: scale(0.97);
      box-shadow: inset 0 0 0 10px var(--surface-solid);
      color: var(--surface-solid);
      background: var(--accent);
    }
    /* Loading state: swap label for animated dots */
    .submit-pill.loading {
      pointer-events: none;
      animation: submit-loading-pulse 1.4s ease-in-out infinite;
    }
    .submit-label {}
    .submit-dots  { display: none; gap: 5px; align-items: center; }
    .submit-pill.loading .submit-label { display: none; }
    .submit-pill.loading .submit-dots  { display: flex; }
    .submit-dots span {
      display: block;
      width: 7px; height: 7px;
      border-radius: 50%;
      background: currentColor;
      animation: dot-pulse 1.1s ease-in-out infinite;
    }
    .submit-dots span:nth-child(2) { animation-delay: 0.18s; }
    .submit-dots span:nth-child(3) { animation-delay: 0.36s; }

    /* ── Goblin click-wobble (Figma explanation-troll-wobble pattern) ──────────
       Fires after the goblin is clicked: squish on press, spring back up.        */
    .goblin-btn.goblin-clicked {
      animation: goblin-click-wobble 520ms cubic-bezier(0.34,1.56,0.64,1) both;
      pointer-events: none; /* prevent double-click mid-animation */
    }
    /* Re-enable pointer events after animation */
    .goblin-btn.goblin-post-click { pointer-events: auto; }

    /* ── Feedback panel ────────────────────────────────────────────────────── */
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
      display: block;
      margin-top: 4px;
      font-size: 0.88em;
      color: rgba(116,171,123,0.5);
      font-style: italic;
    }
    .correct-option { margin-top: 8px; font-weight: 600; color: var(--accent); }
    .feedback-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }

    /* ── Dispute / Next-Q buttons in feedback ───────────────────────────────── */
    .dispute-btn, .next-q-btn {
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
      transition: background-color 180ms ease, border-color 180ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1);
    }
    .dispute-btn:hover, .next-q-btn:hover {
      background: var(--accent-dim);
      border-color: var(--accent);
      transform: translateY(-1px);
    }
    .dispute-btn:active, .next-q-btn:active { transform: scale(0.95); }
    /* Next Q button uses accent fill */
    .next-q-btn {
      background: var(--accent);
      color: var(--on-accent);
      border-color: var(--accent);
    }
    .next-q-btn:hover {
      background: var(--accent-light);
      border-color: var(--accent-light);
    }

    /* ── Utility ───────────────────────────────────────────────────────────── */
    .hidden { display: none !important; }

    /* ── Keyframes ─────────────────────────────────────────────────────────── */
    @keyframes dot-pulse {
      0%, 80%, 100% { transform: scale(0.5); opacity: 0.4; }
      40%           { transform: scale(1);   opacity: 1;   }
    }
    @keyframes radio-select {
      0%   { transform: scale(1);   }
      55%  { transform: scale(1.2); }
      100% { transform: scale(1);   }
    }
    @keyframes dot-activate {
      0%   { transform: scale(0.4); opacity: 0.3; }
      65%  { transform: scale(1.3); }
      100% { transform: scale(1);   opacity: 1;   }
    }
    @keyframes option-enter {
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
      0%  { opacity: 1; transform: translateX(0);  }
      35% { opacity: 0; transform: translateX(-14px); }
      65% { opacity: 0; transform: translateX(14px);  }
      100%{ opacity: 1; transform: translateX(0);  }
    }
    @keyframes screen-enter {
      from { opacity: 0; transform: scale(0.98); }
      to   { opacity: 1; transform: scale(1);    }
    }
    /* Goblin click: squish down then spring bounce up (Figma wobble pattern) */
    @keyframes goblin-click-wobble {
      0%   { transform: translateY(2px)  scale(1.06, 0.88); }
      28%  { transform: translateY(-9px) scale(0.94, 1.08); }
      55%  { transform: translateY(-3px) scale(1.03, 0.98); }
      75%  { transform: translateY(-6px) scale(0.98, 1.03); }
      100% { transform: translateY(0)    scale(1); }
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
  <!-- Fullscreen loading overlay (shown while grading, matches Figma QuestionLoading) -->
  <div class="loading-overlay" id="loading-overlay" role="status" aria-label="Checking your answer">
    <div class="loading-goblin">${goblinSvg}</div>
    <p class="loading-label">Checking your answer\u2026</p>
  </div>

  <div class="quiz-scroll">
  <div class="quiz-wrap" style="animation: screen-enter 420ms ease both;">

    <!-- Brand title (Figma: .brand-title) -->
    <h1 class="brand-title">Comprehension check</h1>

    <!-- Lock note -->
    <p style="margin:0 0 14px; color:var(--accent-muted); font-size:0.82em; text-align:center; line-height:1.4;">
      Editing locked \u2014 submit, bypass, explain, or close to unlock.
    </p>

    <!-- Code snippet -->
    <div class="snippet-wrap">
      <div class="snippet-head">
        <span>Code</span>
        ${langLabel}
      </div>
      <pre><code>${escapeHtml(snippet)}</code></pre>
    </div>

    <!-- Question frame (Q1 and Q2 share this — content swaps on transition) -->
    <div class="q-frame" id="q-frame">

      <!-- Question meta: label + progress dots (Figma: .question-meta) -->
      <header class="q-meta">
        <span class="q-label" id="q-label">Question 1</span>
        <div class="progress-dots" id="progress-dots" aria-hidden="true"></div>
      </header>

      <!-- Goblin button (Figma: .q3-troll-button) — clicking = "explain" -->
      <div class="goblin-area">
        <button type="button" class="goblin-btn goblin-arrive" id="explain-btn"
                aria-label="Show explanation and skip this question">
          ${goblinSvg}
          <span class="goblin-tooltip">Show explanation</span>
        </button>
      </div>

      <!-- Question text -->
      <p id="question" class="question-text"></p>

      <!-- Answer area (textarea / MCQ / ordering) -->
      <div id="answer-area" class="answer-area"></div>

      <!-- Large centred Submit pill (Figma: .submit-button) -->
      <button type="button" class="submit-pill" id="submit-btn" aria-label="Submit answer">
        <span class="submit-label">Submit!</span>
        <span class="submit-dots" aria-hidden="true"><span></span><span></span><span></span></span>
      </button>

    </div><!-- /.q-frame -->

    <!-- Feedback panel (shown after grading) -->
    <div class="feedback-panel hidden" id="feedback" aria-live="polite">
      <p id="feedback-msg" class="feedback-msg"></p>
      <ul id="missed-list" class="missed-list hidden"></ul>
      <p id="correct-option" class="correct-option hidden"></p>
      <div class="feedback-actions">
        <button type="button" class="dispute-btn hidden" id="dispute-btn">My answer was right</button>
        <button type="button" class="next-q-btn hidden" id="next-q-btn">Next Question \u2192</button>
      </div>
    </div>

  </div><!-- /.quiz-wrap -->
  </div><!-- /.quiz-scroll -->

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    /* ── Element refs ────────────────────────────────────────────────────── */
    const qLabelEl      = document.getElementById("q-label");
    const progressEl    = document.getElementById("progress-dots");
    const questionEl    = document.getElementById("question");
    const answerAreaEl  = document.getElementById("answer-area");
    const submitBtn     = document.getElementById("submit-btn");
    const explainBtn    = document.getElementById("explain-btn");
    const feedbackEl    = document.getElementById("feedback");
    const feedbackMsgEl = document.getElementById("feedback-msg");
    const missedListEl  = document.getElementById("missed-list");
    const correctOptEl  = document.getElementById("correct-option");
    const disputeBtn    = document.getElementById("dispute-btn");
    const nextQBtn      = document.getElementById("next-q-btn");
    const qFrameEl      = document.getElementById("q-frame");
    const loadingOverlay= document.getElementById("loading-overlay");

    /* ── State ───────────────────────────────────────────────────────────── */
    let currentKind    = "free-text";
    let lastAnswer     = "";
    let questionNum    = 1;      // 1 or 2
    let showQCount     = 0;      // how many showQuestion messages received
    const TOTAL_DOTS   = 5;

    /* Hardcoded Q2 fallback data (shown until host sends its own Q2) */
    const q2Demo = {
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
        submitBtn.setAttribute("aria-label", "Checking your answer\u2026");
      } else {
        loadingOverlay.classList.remove("active");
        submitBtn.setAttribute("aria-label", "Submit answer");
      }
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

      /* Animate frame swap and scroll for Q2+ */
      if (questionNum > 1) {
        qFrameEl.classList.add("transitioning");
        setTimeout(function () { qFrameEl.classList.remove("transitioning"); }, 400);
        qFrameEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      /* Update question label and progress dots */
      qLabelEl.textContent = "Question " + questionNum;
      renderDots(questionNum);

      clearFeedback();
      setLoading(false);
      submitBtn.classList.remove("hidden");
      explainBtn.disabled = false;
      questionEl.textContent = payload.questionText || "";
      renderAnswerArea(payload.kind || "free-text", payload);
    }

    /* ── Transition to Q2 ────────────────────────────────────────────────── */
    function transitionToQ2(payload) {
      var data = payload || q2Demo;
      questionNum = 2;

      /* Animate the frame swap */
      qFrameEl.classList.add("transitioning");
      setTimeout(function () { qFrameEl.classList.remove("transitioning"); }, 400);

      qLabelEl.textContent = "Question 2";
      renderDots(2);
      clearFeedback();
      setLoading(false);
      submitBtn.classList.remove("hidden");
      explainBtn.disabled = false;
      questionEl.textContent = data.questionText || q2Demo.questionText;
      renderAnswerArea(
        data.kind || q2Demo.kind,
        { questionText: data.questionText || q2Demo.questionText,
          options: (data.options && data.options.length) ? data.options : q2Demo.options,
          items:   (data.items  && data.items.length)   ? data.items   : q2Demo.items  }
      );

      /* Scroll back to top of question frame */
      qFrameEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    /* ── Show feedback ───────────────────────────────────────────────────── */
    function showFeedback(payload) {
      setLoading(false);
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

      if (payload.explained) {
        submitBtn.classList.add("hidden");
        explainBtn.disabled = true;
        disputeBtn.classList.add("hidden");
        nextQBtn.classList.add("hidden");
      }
      if (payload.allowDispute) {
        disputeBtn.classList.remove("hidden");
      } else {
        disputeBtn.classList.add("hidden");
      }
      /* Show "Next Question" button after Q1 feedback (not on explained or Q2) */
      if (questionNum === 1 && !payload.explained) {
        nextQBtn.classList.remove("hidden");
      }

      /* Reset answer input */
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
        setLoading(true);
        vscode.postMessage({ type: "submit", selectedIndex: parseInt(sel.value, 10) });
        return;
      }
      var ta = document.getElementById("answer-input");
      var answer = ta ? ta.value : "";
      lastAnswer = answer;
      setLoading(true);
      vscode.postMessage({ type: "submit", answer: answer });
    }

    /* ── Button listeners ────────────────────────────────────────────────── */
    submitBtn.addEventListener("click", collectSubmit);

    /* Goblin click: spring-wobble animation, then post explain */
    explainBtn.addEventListener("click", function () {
      /* Trigger the squish-bounce keyframe (Figma wobble pattern) */
      explainBtn.classList.remove("goblin-clicked");
      void explainBtn.offsetWidth; /* force reflow to restart */
      explainBtn.classList.add("goblin-clicked");
      vscode.postMessage({ type: "explain" });
    });
    explainBtn.addEventListener("animationend", function () {
      explainBtn.classList.remove("goblin-clicked");
    });
    disputeBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "dispute", answer: lastAnswer });
    });
    nextQBtn.addEventListener("click", function () {
      /* Advance to Q2 using demo data (host data overrides if available) */
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
