import * as vscode from "vscode";
import type { GeneratedQuestion } from "./types";

export type SubmitPayload = { answer?: string; selectedIndex?: number; order?: number[] };

export type QuizAction =
  | { type: "submit"; answer?: string; selectedIndex?: number; order?: number[] }
  | { type: "bypass" }
  | { type: "explain" }
  | { type: "dispute"; answer?: string }
  | { type: "cancel" }
  | { type: "next_question" };

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
    /** Whether to show the "Next Question" button. Defaults to true. */
    allowNextQuestion?: boolean;
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
  <title>DrawBridge</title>
  <style>
    :root {
      --accent:         #4ade80;
      --accent-light:   #86efac;
      --accent-dim:     rgba(74,222,128,0.14);
      --accent-muted:   rgba(74,222,128,0.55);
      --surface:        rgba(18,18,18,0.92);
      --on-accent:      #0a0a0a;
      --r-pill:         999px;
      --r-card:         16px;
      --r-sm:           8px;
      --correct-bg:     rgba(22,50,22,0.88);
      --correct-border: rgba(74,222,128,0.45);
      --correct-text:   #86efac;
      --wrong-bg:       rgba(90,30,30,0.88);
      --wrong-border:   rgba(248,113,113,0.45);
      --wrong-text:     #fca5a5;
      --coral:          #c47a7a;
    }

    html, body { height: 100%; margin: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size:   var(--vscode-font-size);
      color: var(--accent);
      background: #0a0a0a;
      line-height: 1.5;
      box-sizing: border-box;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    /* ── Scrollable layout ─────────────────────────────────────────────── */
    .quiz-scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-width: thin;
      scrollbar-color: rgba(74,222,128,0.3) transparent;
    }
    .quiz-wrap {
      display: flex;
      flex-direction: column;
      min-height: 100%;
      padding: 14px 20px 22px;
      box-sizing: border-box;
    }

    /* ── Header ─────────────────────────────────────────────────────────── */
    .panel-header {
      text-align: center;
      margin-bottom: 10px;
    }
    .brand-title {
      margin: 0;
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: var(--accent);
      line-height: 1.2;
    }

    /* ── Q frame ─────────────────────────────────────────────────────────── */
    .q-frame {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .q-frame.transitioning { animation: q-swap 380ms ease both; }

    /* ── Question meta ───────────────────────────────────────────────────── */
    .q-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .q-label {
      font-weight: 600;
      font-size: 0.95em;
      color: var(--accent);
    }
    .progress-dots { display: flex; gap: 6px; align-items: center; }
    .dot {
      width: 10px; height: 10px;
      border-radius: 50%; flex-shrink: 0;
      transition: background-color 320ms ease;
    }
    .dot-done    { background: var(--accent); opacity: 0.7; }
    .dot-active  { background: var(--accent); animation: dot-activate 340ms cubic-bezier(0.34,1.56,0.64,1) both; }
    .dot-inactive{ background: rgba(74,222,128,0.2); }

    /* ── Goblin stage: the central focal element ─────────────────────────── */
    .goblin-stage {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      margin: 6px 0 14px;
    }

    /* Goblin button wraps the image — enables click-to-explain */
    .goblin-btn {
      position: relative;
      display: grid;
      place-items: center;
      background: transparent;
      border: none;
      padding: 6px;
      cursor: pointer;
      border-radius: 50%;
      -webkit-tap-highlight-color: transparent;
      transition: transform 220ms cubic-bezier(0.34,1.56,0.64,1), filter 220ms ease;
    }
    .goblin-btn[disabled] { cursor: default; }
    .goblin-btn:not([disabled]):hover {
      transform: translateY(-3px) scale(1.07);
      filter: drop-shadow(0 0 14px rgba(74,222,128,0.38));
    }
    .goblin-btn:not([disabled]):active { transform: translateY(1px) scale(0.96); }
    .goblin-btn:focus-visible { outline: 3px solid var(--accent); outline-offset: 8px; }
    .goblin-btn.goblin-clicked {
      animation: goblin-click-wobble 520ms cubic-bezier(0.34,1.56,0.64,1) both;
      pointer-events: none;
    }
    .goblin-arrive { animation: goblin-arrive 500ms cubic-bezier(0.22,1,0.36,1) both; }

    .goblin-img {
      display: block;
      width: 110px;
      height: 110px;
      object-fit: contain;
      image-rendering: pixelated;
      transition: opacity 160ms ease;
    }
    .goblin-img.goblin-correct-anim { animation: goblin-bounce 500ms cubic-bezier(0.34,1.56,0.64,1) both; }
    .goblin-img.goblin-wrong-anim   { animation: goblin-shake  440ms cubic-bezier(0.36,0.07,0.19,0.97) both; }

    /* "Show explanation" pill — pulsing below goblin during question state */
    .explain-pill {
      display: inline-flex;
      align-items: center;
      padding: 6px 20px;
      font-family: var(--vscode-font-family);
      font-size: 0.82em;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: var(--on-accent);
      background: var(--accent);
      border: none;
      border-radius: var(--r-pill);
      cursor: pointer;
      animation: explain-pill-pulse 2.6s ease-in-out infinite;
      transition: background-color 160ms ease, transform 160ms ease;
    }
    .explain-pill:hover { background: var(--accent-light); transform: scale(1.05); }

    /* "Checking…" label replaces the full-screen loading overlay */
    .checking-label {
      margin: 0;
      font-size: 0.85em;
      color: var(--accent-muted);
      letter-spacing: 0.06em;
      animation: label-pulse 1.5s ease-in-out infinite;
    }

    /* Speech bubble below goblin — correct (green) or wrong (pink) */
    .speech-bubble {
      --bubble-ptr: transparent;
      max-width: 290px;
      width: 92%;
      padding: 12px 16px;
      border-radius: 14px;
      font-size: 0.9em;
      line-height: 1.5;
      text-align: center;
      font-weight: 500;
      position: relative;
      animation: bubble-enter 340ms cubic-bezier(0.22,1,0.36,1) both;
    }
    .speech-bubble::before {
      content: "";
      position: absolute;
      top: -9px;
      left: 50%;
      transform: translateX(-50%);
      border-width: 0 8px 9px 8px;
      border-style: solid;
      border-color: transparent transparent var(--bubble-ptr) transparent;
    }
    .speech-bubble-correct {
      --bubble-ptr: var(--correct-border);
      background: var(--correct-bg);
      border: 1px solid var(--correct-border);
      color: var(--correct-text);
    }
    .speech-bubble-wrong {
      --bubble-ptr: var(--wrong-border);
      background: var(--wrong-bg);
      border: 1px solid var(--wrong-border);
      color: var(--wrong-text);
    }

    /* ── Question card ───────────────────────────────────────────────────── */
    .question-card {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .question-text {
      margin: 0 0 14px;
      font-weight: 600;
      font-size: 1em;
      color: var(--accent);
      line-height: 1.5;
    }
    .answer-area { margin-bottom: 12px; }

    /* ── Textarea ────────────────────────────────────────────────────────── */
    textarea {
      width: 100%;
      min-height: 105px;
      box-sizing: border-box;
      padding: 12px 16px;
      font-family: var(--vscode-font-family);
      font-size:   var(--vscode-font-size);
      color: var(--accent);
      background: var(--surface);
      border: 2px solid var(--accent);
      border-radius: 16px;
      resize: vertical;
      transition: border-color 180ms ease, box-shadow 180ms ease;
      outline: none;
    }
    textarea:focus {
      border-color: var(--accent-light);
      box-shadow: 0 0 0 3px rgba(74,222,128,0.12);
    }
    textarea::placeholder { color: rgba(74,222,128,0.25); opacity: 1; }

    /* ── Submit pill ─────────────────────────────────────────────────────── */
    .submit-pill {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      width: 170px; margin: 12px auto 0; padding: 10px 0;
      font-family: var(--vscode-font-family);
      font-size: 1em; font-weight: 600; letter-spacing: 0.04em;
      color: var(--accent);
      background: var(--surface);
      border: 2px solid var(--accent);
      border-radius: var(--r-pill);
      cursor: pointer;
      transition: background-color 180ms ease, color 180ms ease, transform 180ms ease;
      -webkit-tap-highlight-color: transparent;
    }
    .submit-pill:hover:not(:disabled) { background: var(--accent); color: var(--on-accent); }
    .submit-pill:active:not(:disabled) { transform: scale(0.97); }
    .submit-label {}
    .submit-dots { display: none; gap: 5px; align-items: center; }
    .submit-pill.loading .submit-label { display: none; }
    .submit-pill.loading .submit-dots  { display: flex; }
    .submit-dots span {
      display: block; width: 6px; height: 6px;
      border-radius: 50%; background: currentColor;
      animation: dot-pulse 1.1s ease-in-out infinite;
    }
    .submit-dots span:nth-child(2) { animation-delay: 0.18s; }
    .submit-dots span:nth-child(3) { animation-delay: 0.36s; }

    /* ── MCQ ─────────────────────────────────────────────────────────────── */
    .mcq-fieldset { margin: 0; padding: 0; border: 0; color: var(--accent); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
    .mcq-legend { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
    .mcq-options { display: grid; gap: 10px; margin-top: 4px; }
    .mcq-option {
      display: flex; align-items: center; gap: 14px;
      padding: 10px 14px;
      border: 1.5px solid rgba(74,222,128,0.26);
      border-radius: 12px;
      cursor: pointer;
      color: var(--accent);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.5;
      user-select: none;
      transition: border-color 140ms ease, background-color 140ms ease;
      animation: option-enter 340ms ease-out both;
    }
    .mcq-option:hover { border-color: rgba(74,222,128,0.62); background: rgba(74,222,128,0.05); }
    .mcq-option:nth-child(1) { animation-delay:   0ms; }
    .mcq-option:nth-child(2) { animation-delay:  55ms; }
    .mcq-option:nth-child(3) { animation-delay: 110ms; }
    .mcq-option:nth-child(4) { animation-delay: 165ms; }
    .mcq-option:nth-child(5) { animation-delay: 220ms; }
    .mcq-option input[type="radio"] { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
    .mcq-radio {
      flex: 0 0 34px; width: 34px; height: 34px;
      border: 2px solid var(--accent);
      border-radius: 50%;
      background: var(--surface);
      transition: background-color 160ms ease, transform 160ms ease;
    }
    .mcq-option:hover .mcq-radio { transform: scale(1.05); }
    .mcq-option input:checked + .mcq-radio {
      background: var(--accent);
      animation: radio-select 260ms cubic-bezier(0.34,1.56,0.64,1);
    }
    .mcq-option:has(input:checked) { border-color: var(--accent); background: rgba(74,222,128,0.08); }
    .mcq-option input:focus-visible + .mcq-radio { outline: 3px solid var(--accent-light); outline-offset: 4px; }
    .mcq-option input:disabled ~ * { cursor: default; }

    /* ── Ordering ────────────────────────────────────────────────────────── */
    .ordering-row {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; margin: 4px 0;
      background: var(--surface);
      border: 1px solid rgba(74,222,128,0.26);
      border-radius: var(--r-sm);
      color: var(--accent);
    }
    .ordering-row button {
      padding: 2px 8px; font-size: 0.8em;
      color: var(--accent); background: var(--accent-dim);
      border: 1px solid rgba(74,222,128,0.3); border-radius: 4px;
      cursor: pointer;
      transition: background-color 140ms ease, transform 120ms ease;
    }
    .ordering-row button:hover  { background: rgba(74,222,128,0.28); }
    .ordering-row button:active { transform: scale(0.94); }

    /* ── Feedback panel ──────────────────────────────────────────────────── */
    .feedback-panel { margin: 6px 0 4px; }

    /* Dark hints box — holds message + rubric lines (Frame 2 style) */
    .hints-box {
      background: rgba(15,15,15,0.96);
      border: 1px solid rgba(74,222,128,0.18);
      border-radius: var(--r-card);
      padding: 12px 16px;
      margin-bottom: 10px;
      animation: hints-enter 300ms ease-out both;
    }
    .feedback-msg {
      margin: 0 0 6px;
      font-weight: 600;
      font-size: 0.95em;
      color: var(--accent);
    }
    .missed-list {
      margin: 4px 0 0;
      padding-left: 16px;
      color: var(--accent-muted);
      font-size: 0.9em;
    }
    .missed-list li { margin-bottom: 4px; }
    .evidence {
      display: block; margin-top: 2px;
      font-size: 0.85em; color: rgba(74,222,128,0.45); font-style: italic;
    }
    .correct-option {
      margin: 6px 0 0;
      font-size: 0.9em; font-weight: 600;
      color: var(--accent);
    }
    .feedback-actions {
      display: flex; flex-wrap: wrap; gap: 8px;
      margin-top: 10px;
      justify-content: center;
    }
    /* "Drop the bridge" dispute button — coral pill */
    .dispute-btn {
      display: inline-flex; align-items: center;
      padding: 8px 20px;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
      font-weight: 600;
      color: #fff;
      background: var(--coral);
      border: none;
      border-radius: var(--r-pill);
      cursor: pointer;
      transition: background-color 180ms ease, transform 180ms ease;
    }
    .dispute-btn:hover { background: #d4918f; transform: translateY(-1px); }
    .dispute-btn:active { transform: scale(0.96); }
    /* Next Question button — green-bordered pill with fade-in */
    .next-q-btn {
      display: inline-flex; align-items: center;
      padding: 10px 26px;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
      font-weight: 600;
      color: var(--accent);
      background: var(--surface);
      border: 2px solid var(--accent);
      border-radius: var(--r-pill);
      cursor: pointer;
      animation: next-btn-enter 320ms 160ms ease-out both;
      transition: background-color 180ms ease, color 180ms ease, transform 180ms ease;
    }
    .next-q-btn:hover { background: var(--accent); color: var(--on-accent); transform: translateY(-1px); }
    .next-q-btn:active { transform: scale(0.96); }

    /* ── Explanation card ────────────────────────────────────────────────── */
    .exp-card {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .exp-heading {
      margin: 0 0 12px;
      font-size: 0.95em; font-weight: 600;
      color: var(--accent); line-height: 1.5; text-align: center;
      animation: content-enter 360ms 150ms ease-out both;
    }
    .exp-text-box {
      border: 1px solid rgba(74,222,128,0.22);
      border-radius: var(--r-card);
      background: rgba(15,15,15,0.7);
      padding: 12px 16px;
      color: var(--accent);
      font-size: 0.92em; line-height: 1.55;
      margin-bottom: 10px;
      animation: content-enter 400ms 220ms ease-out both;
    }
    .exp-answer-label {
      margin: 6px 0 4px;
      font-size: 0.88em; font-weight: 600;
      color: var(--accent);
      animation: content-enter 350ms 280ms ease-out both;
    }
    .exp-answer-block {
      border-radius: var(--r-card);
      background: rgba(15,15,15,0.5);
      padding: 10px 14px;
      color: var(--accent);
      font-size: 0.92em; line-height: 1.5;
      margin-bottom: 12px;
      animation: content-enter 400ms 320ms ease-out both;
    }

    .hidden { display: none !important; }

    /* ── Keyframes ───────────────────────────────────────────────────────── */
    @keyframes dot-pulse {
      0%, 80%, 100% { transform: scale(0.5); opacity: 0.4; }
      40%           { transform: scale(1);   opacity: 1;   }
    }
    @keyframes dot-activate {
      0%   { transform: scale(0.4); opacity: 0.3; }
      65%  { transform: scale(1.32); }
      100% { transform: scale(1);   opacity: 1;   }
    }
    @keyframes label-pulse {
      0%, 100% { opacity: 0.42; }
      50%      { opacity: 1; }
    }
    @keyframes explain-pill-pulse {
      0%, 100% { box-shadow: 0 0 0 0   rgba(74,222,128,0); }
      50%      { box-shadow: 0 0 0 7px rgba(74,222,128,0.17); }
    }
    @keyframes bubble-enter {
      from { opacity: 0; transform: translateY(10px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0)    scale(1);    }
    }
    @keyframes goblin-arrive {
      from { opacity: 0; transform: scale(0.55) translateY(14px); }
      to   { opacity: 1; transform: scale(1)    translateY(0);    }
    }
    @keyframes goblin-bounce {
      0%   { transform: scale(1); }
      28%  { transform: scale(1.13, 0.90) translateY(4px); }
      55%  { transform: scale(0.95, 1.08) translateY(-12px); }
      76%  { transform: scale(1.05, 0.97) translateY(-4px); }
      100% { transform: scale(1)          translateY(0); }
    }
    @keyframes goblin-shake {
      0%, 100% { transform: translateX(0)    rotate(0deg); }
      16%      { transform: translateX(-9px) rotate(-4deg); }
      34%      { transform: translateX(9px)  rotate(4deg); }
      52%      { transform: translateX(-5px) rotate(-2deg); }
      70%      { transform: translateX(5px)  rotate(2deg); }
      88%      { transform: translateX(-2px) rotate(-1deg); }
    }
    @keyframes goblin-click-wobble {
      0%   { transform: translateY(2px)  scale(1.06, 0.88); }
      28%  { transform: translateY(-9px) scale(0.94, 1.08); }
      55%  { transform: translateY(-3px) scale(1.03, 0.98); }
      75%  { transform: translateY(-6px) scale(0.98, 1.03); }
      100% { transform: translateY(0)    scale(1); }
    }
    @keyframes radio-select {
      0%   { transform: scale(1); }
      55%  { transform: scale(1.14); }
      100% { transform: scale(1); }
    }
    @keyframes option-enter {
      from { opacity: 0; transform: translateX(-10px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    @keyframes hints-enter {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes next-btn-enter {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes content-enter {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes q-swap {
      0%   { opacity: 1; transform: translateX(0);     }
      35%  { opacity: 0; transform: translateX(-12px); }
      65%  { opacity: 0; transform: translateX(12px);  }
      100% { opacity: 1; transform: translateX(0);     }
    }
    @keyframes screen-enter {
      from { opacity: 0; transform: scale(0.986); }
      to   { opacity: 1; transform: scale(1); }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 1ms !important;
        transition-duration: 1ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
      }
    }
  </style>
</head>
<body>
  <div class="quiz-scroll">
  <div class="quiz-wrap" style="animation: screen-enter 400ms ease both;">

    <header class="panel-header">
      <h1 class="brand-title">DrawBridge</h1>
    </header>

    <div class="q-frame" id="q-frame">

      <header class="q-meta">
        <span class="q-label" id="q-label">Question 1</span>
        <div class="progress-dots" id="progress-dots" aria-hidden="true"></div>
      </header>

      <!--
        Goblin stage — always the central focal element.
        The goblin button (explain-btn) wraps the image; clicking it also triggers explain.
        The explain pill is the primary affordance during question state.
        Speech bubble appears below goblin in correct / wrong feedback states.
      -->
      <div class="goblin-stage" id="goblin-stage">
        <button type="button" class="goblin-btn goblin-arrive" id="explain-btn"
                aria-label="Show explanation and skip this question" disabled>
          <img id="goblin-img" src="${uris.goblinSleep}" class="goblin-img" alt="" aria-hidden="true">
        </button>

        <!-- Pulsing "Show explanation" pill (Figma Frame 1) -->
        <button type="button" class="explain-pill hidden" id="explain-pill-btn"
                aria-label="Show explanation">Show explanation</button>

        <!-- Inline checking indicator — replaces full-screen loading overlay -->
        <p class="checking-label hidden" id="checking-label" role="status">Checking\u2026</p>

        <!-- Speech bubble — slides in below goblin for correct / wrong feedback -->
        <div class="speech-bubble hidden" id="speech-bubble" aria-live="polite"></div>
      </div>

      <!-- Question card: question text + answer area + submit button (Frames 1 & 5) -->
      <div class="question-card" id="question-card">
        <p id="question" class="question-text"></p>
        <div id="answer-area" class="answer-area"></div>
        <button type="button" class="submit-pill" id="submit-btn" aria-label="Submit answer">
          <span class="submit-label">Submit!</span>
          <span class="submit-dots" aria-hidden="true"><span></span><span></span><span></span></span>
        </button>
      </div>

      <!-- Feedback panel: hints box + action buttons (Frame 2 / Frame 3) -->
      <div class="feedback-panel hidden" id="feedback">
        <div class="hints-box hidden" id="hints-box">
          <p id="feedback-msg" class="feedback-msg"></p>
          <ul id="missed-list" class="missed-list hidden"></ul>
          <p id="correct-option" class="correct-option hidden"></p>
        </div>
        <div class="feedback-actions">
          <button type="button" class="dispute-btn hidden" id="dispute-btn">Drop the bridge</button>
          <button type="button" class="next-q-btn hidden" id="next-q-btn">Next Question</button>
        </div>
      </div>

      <!-- Explanation card — shown after "Show explanation" is clicked -->
      <div class="exp-card hidden" id="exp-card">
        <h2 id="exp-heading" class="exp-heading"></h2>
        <div class="exp-text-box" id="exp-text-box"></div>
        <p class="exp-answer-label hidden" id="exp-answer-label">Correct answer</p>
        <div class="exp-answer-block hidden" id="exp-answer-block"></div>
        <button type="button" class="submit-pill" id="exp-next-btn">
          <span>Next Question</span>
        </button>
      </div>

    </div><!-- /.q-frame -->

  </div><!-- /.quiz-wrap -->
  </div><!-- /.quiz-scroll -->

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    /* ── Goblin URI constants ─────────────────────────────────────────────── */
    var URI_SLEEP   = ${JSON.stringify(uris.goblinSleep)};
    var URI_IDLE    = ${JSON.stringify(uris.goblinIdle)};
    var URI_CORRECT = ${JSON.stringify(uris.goblinCorrect)};
    var URI_WRONG   = ${JSON.stringify(uris.goblinWrong)};

    /* ── Element refs ─────────────────────────────────────────────────────── */
    var qLabelEl        = document.getElementById("q-label");
    var progressEl      = document.getElementById("progress-dots");
    var questionEl      = document.getElementById("question");
    var answerAreaEl    = document.getElementById("answer-area");
    var submitBtn       = document.getElementById("submit-btn");
    var explainBtn      = document.getElementById("explain-btn");
    var explainPillBtn  = document.getElementById("explain-pill-btn");
    var goblinImg       = document.getElementById("goblin-img");
    var checkingLabel   = document.getElementById("checking-label");
    var speechBubble    = document.getElementById("speech-bubble");
    var feedbackEl      = document.getElementById("feedback");
    var hintsBox        = document.getElementById("hints-box");
    var feedbackMsgEl   = document.getElementById("feedback-msg");
    var missedListEl    = document.getElementById("missed-list");
    var correctOptEl    = document.getElementById("correct-option");
    var disputeBtn      = document.getElementById("dispute-btn");
    var nextQBtn        = document.getElementById("next-q-btn");
    var qFrameEl        = document.getElementById("q-frame");
    var questionCardEl  = document.getElementById("question-card");
    var expCardEl       = document.getElementById("exp-card");
    var expHeadingEl    = document.getElementById("exp-heading");
    var expTextBoxEl    = document.getElementById("exp-text-box");
    var expAnswerLblEl  = document.getElementById("exp-answer-label");
    var expAnswerBlkEl  = document.getElementById("exp-answer-block");
    var expNextBtn      = document.getElementById("exp-next-btn");

    /* ── State ────────────────────────────────────────────────────────────── */
    var currentKind = "free-text";
    var lastAnswer  = "";
    var questionNum = 1;
    var showQCount  = 0;
    var TOTAL_DOTS  = 5;
    var explaining  = false;

    /* ── Goblin state machine ─────────────────────────────────────────────
     *
     *  sleep   — question active or checking (always shown, possibly non-clickable)
     *  idle    — explanation card shown
     *  correct — correct answer feedback (Frame 4: bounce anim)
     *  wrong   — incorrect answer feedback (Frame 3: shake anim)
     *
     *  Transitions: 160 ms opacity crossfade, then swap src + animation class.
     *  canExplain also controls visibility of the explain pill.
     * ──────────────────────────────────────────────────────────────────── */
    function setGoblinState(uri, canExplain) {
      goblinImg.style.opacity = "0";
      setTimeout(function () {
        goblinImg.src = uri;
        goblinImg.classList.remove("goblin-correct-anim", "goblin-wrong-anim");
        if (uri === URI_CORRECT) {
          void goblinImg.offsetWidth;
          goblinImg.classList.add("goblin-correct-anim");
        } else if (uri === URI_WRONG) {
          void goblinImg.offsetWidth;
          goblinImg.classList.add("goblin-wrong-anim");
        }
        goblinImg.style.opacity = "1";
        explainBtn.disabled = !canExplain;
        if (canExplain) {
          explainPillBtn.classList.remove("hidden");
        } else {
          explainPillBtn.classList.add("hidden");
        }
      }, 160);
    }

    /* ── Progress dots ────────────────────────────────────────────────────── */
    function renderDots(current) {
      progressEl.innerHTML = "";
      for (var i = 1; i <= TOTAL_DOTS; i++) {
        var d = document.createElement("span");
        d.className = "dot " + (i < current ? "dot-done" : i === current ? "dot-active" : "dot-inactive");
        progressEl.appendChild(d);
      }
    }

    /* ── Checking indicator (replaces full-screen loading overlay) ─────────── */
    function setChecking(on) {
      if (on) {
        checkingLabel.classList.remove("hidden");
      } else {
        checkingLabel.classList.add("hidden");
      }
    }

    /* ── Speech bubble ────────────────────────────────────────────────────── */
    function showSpeechBubble(type, text) {
      speechBubble.className = "speech-bubble";
      speechBubble.classList.add(type === "correct" ? "speech-bubble-correct" : "speech-bubble-wrong");
      speechBubble.textContent = text;
      void speechBubble.offsetWidth; /* force reflow so animation re-triggers */
    }
    function hideSpeechBubble() {
      speechBubble.className = "speech-bubble hidden";
      speechBubble.textContent = "";
    }

    /* ── Card switchers ───────────────────────────────────────────────────── */
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

    /* ── Clear feedback ───────────────────────────────────────────────────── */
    function clearFeedback() {
      feedbackEl.classList.add("hidden");
      hintsBox.classList.add("hidden");
      feedbackMsgEl.textContent = "";
      missedListEl.innerHTML = "";
      missedListEl.classList.add("hidden");
      correctOptEl.textContent = "";
      correctOptEl.classList.add("hidden");
      disputeBtn.classList.add("hidden");
      nextQBtn.classList.add("hidden");
      hideSpeechBubble();
    }

    /* ── Render answer area ───────────────────────────────────────────────── */
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
          var radio = document.createElement("span"); radio.className = "mcq-radio"; radio.setAttribute("aria-hidden", "true");
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

    /* ── Render a question (host-driven) ──────────────────────────────────── */
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
      setChecking(false);
      questionCardEl.classList.remove("hidden");
      submitBtn.classList.remove("hidden");
      expCardEl.classList.add("hidden");
      explaining = false;

      /* Sleep goblin with pulsing explain pill below it (Figma Frames 1 & 5) */
      setGoblinState(URI_SLEEP, true);

      questionEl.textContent = payload.questionText || "";
      renderAnswerArea(payload.kind || "free-text", payload);
    }

    /* ── Show feedback ─────────────────────────────────────────────────────
     *
     *  explained === true → idle goblin + explanation card
     *  passed === true    → correct goblin + green speech bubble (Frame 4)
     *  passed === false   → wrong goblin + pink speech bubble (Frame 3)
     *                       hints box + action buttons shown below if applicable
     * ──────────────────────────────────────────────────────────────────── */
    function showFeedback(payload) {
      setChecking(false);

      /* Explanation state */
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
        questionCardEl.classList.add("hidden");
        hideSpeechBubble();
        /* Idle / arms-out goblin for explanation screen */
        setGoblinState(URI_IDLE, false);
        if (payload.allowNextQuestion) {
          expNextBtn.classList.remove("hidden");
        } else {
          expNextBtn.classList.add("hidden");
        }
        showExplanationCard();
        return;
      }

      /* Correct answer — Frame 4: correct goblin + green speech bubble */
      if (payload.passed === true) {
        setGoblinState(URI_CORRECT, false);
        submitBtn.classList.add("hidden");
        questionCardEl.classList.add("hidden");
        showSpeechBubble("correct", payload.message || "Good job! You\u2019re one step closer to lowering the drawbridge.");
        feedbackEl.classList.remove("hidden");
        hintsBox.classList.add("hidden");
        disputeBtn.classList.add("hidden");
        nextQBtn.classList.add("hidden");
        return;
      }

      /* Wrong answer — Frame 3: wrong goblin + pink speech bubble */
      setGoblinState(URI_WRONG, false);
      submitBtn.classList.add("hidden");
      questionCardEl.classList.add("hidden");
      showSpeechBubble("wrong", payload.message || "I\u2019m sorry, that was incorrect\u2014please try again!");

      /* Populate hints box with rubric lines (visible when hints exist) */
      feedbackMsgEl.textContent = "";
      missedListEl.innerHTML = "";
      var hasHints = false;

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
        hasHints = true;
      } else {
        missedListEl.classList.add("hidden");
      }

      if (payload.correctOption) {
        correctOptEl.textContent = "Correct answer: " + payload.correctOption;
        correctOptEl.classList.remove("hidden");
        hasHints = true;
      } else {
        correctOptEl.classList.add("hidden");
      }

      if (hasHints) {
        hintsBox.classList.remove("hidden");
      } else {
        hintsBox.classList.add("hidden");
      }

      feedbackEl.classList.remove("hidden");

      if (payload.allowDispute) {
        disputeBtn.classList.remove("hidden");
      } else {
        disputeBtn.classList.add("hidden");
      }
      if (payload.allowNextQuestion && payload.passed !== true) {
        nextQBtn.classList.remove("hidden");
      } else {
        nextQBtn.classList.add("hidden");
      }

      if (currentKind === "free-text") {
        var ta = document.getElementById("answer-input");
        if (ta) { ta.value = ""; }
      } else {
        var checked = answerAreaEl.querySelector('input[name="mcq"]:checked');
        if (checked) { checked.checked = false; }
      }
    }

    /* ── Collect and post submit ───────────────────────────────────────────── */
    function collectSubmit() {
      if (currentKind === "ordering") {
        var order = Array.from(answerAreaEl.querySelectorAll("[data-index]")).map(function (r) {
          return parseInt(r.dataset.index, 10);
        });
        setGoblinState(URI_SLEEP, false);
        setChecking(true);
        questionCardEl.classList.add("hidden");
        vscode.postMessage({ type: "submit", order: order });
        return;
      }
      if (currentKind === "multiple-choice") {
        var sel = answerAreaEl.querySelector('input[name="mcq"]:checked');
        if (!sel) {
          showSpeechBubble("wrong", "Please select an option before submitting.");
          feedbackEl.classList.remove("hidden");
          return;
        }
        lastAnswer = sel.parentElement ? sel.parentElement.textContent.trim() : "";
        setGoblinState(URI_SLEEP, false);
        setChecking(true);
        questionCardEl.classList.add("hidden");
        vscode.postMessage({ type: "submit", selectedIndex: parseInt(sel.value, 10) });
        return;
      }
      var ta = document.getElementById("answer-input");
      var answer = ta ? ta.value : "";
      lastAnswer = answer;
      setGoblinState(URI_SLEEP, false);
      setChecking(true);
      questionCardEl.classList.add("hidden");
      vscode.postMessage({ type: "submit", answer: answer });
    }

    /* ── Button listeners ─────────────────────────────────────────────────── */
    submitBtn.addEventListener("click", collectSubmit);

    /* Goblin button — secondary explain affordance (also triggers explain) */
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

    /* Explain pill — primary "Show explanation" affordance (Figma Frame 1) */
    explainPillBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "explain" });
    });

    disputeBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "dispute", answer: lastAnswer });
    });

    nextQBtn.addEventListener("click", function () {
      nextQBtn.classList.add("hidden");
      disputeBtn.classList.add("hidden");
      feedbackEl.classList.add("hidden");
      hideSpeechBubble();
      setGoblinState(URI_SLEEP, false);
      setChecking(true);
      vscode.postMessage({ type: "next_question" });
    });

    expNextBtn.addEventListener("click", function () {
      expNextBtn.classList.add("hidden");
      setChecking(true);
      vscode.postMessage({ type: "next_question" });
    });

    /* ── Startup ──────────────────────────────────────────────────────────── */
    renderDots(1);
    vscode.postMessage({ type: "ready" });

    /* ── Host message handler ─────────────────────────────────────────────── */
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
    if (msg.type === "cancel") { resolvePending({ type: "cancel" }); return; }
    if (msg.type === "next_question") { resolvePending({ type: "next_question" }); return; }
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
        allowNextQuestion: opts.allowNextQuestion !== false,
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
