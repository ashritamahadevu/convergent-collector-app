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
  /** Bypass or close that arrived while grading was in flight. Leaves submits queued. */
  pollInterrupt(): "bypass" | "cancel" | undefined;
  onInterrupt(listener: (kind: "bypass" | "cancel") => void): () => void;
  beginGrade(): void;
  endGrade(): void;
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
  arrowDown:     string;
  arrowDownRed:  string;
  arrowUp:       string;
  dotFull:       string;
  dotHalf:       string;
  dotFull2:      string;
  dotFull3:      string;
  logo:          string;
  goblinWalk:    string;
  dot1:          string;
  dot2a:         string;
  dot2b:         string;
  dot3:          string;
  dotEmpty:      string;
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
    /* ── Reset & base ─────────────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: #74ab7b;
      background: #0a0a0a;
    }

    /* ── App shell ────────────────────────────────────────────────────────── */
    .app-shell {
      height: 100%;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-width: thin;
      scrollbar-color: rgba(116,171,123,0.3) transparent;
      background: radial-gradient(
        ellipse 110% 115% at 50% 215%,
        #74ab7b 0%, #90a793 25%, #7a8d7c 37.5%,
        #647366 50%, #4d584f 62.5%, #373e38 75%,
        #202421 87.5%, #151715 93.75%, #0a0a0a 100%
      );
      background-color: #0a0a0a;
    }

    /* ── Screens ──────────────────────────────────────────────────────────── */
    .screen {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100%;
      padding: 20px 24px 28px;
    }
    .screen.hidden { display: none !important; }

    /* ── Screen: Question ─────────────────────────────────────────────────── */
    #screen-question { align-items: stretch; }

    .q-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      animation: q2-meta-enter 320ms ease-out both;
    }
    .q-label {
      font-weight: 600;
      font-size: 1em;
      letter-spacing: 0.02em;
      color: #74ab7b;
    }
    .progress-dots { display: flex; gap: 10px; align-items: center; }

    /* Goblin / explain button */
    .goblin-area {
      display: flex;
      justify-content: center;
      margin: 8px 0 4px;
      padding-bottom: 44px;
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
      transition: transform 220ms cubic-bezier(0.34,1.56,0.64,1), filter 220ms ease;
      -webkit-tap-highlight-color: transparent;
    }
    .goblin-btn-img {
      display: block;
      width: 90px; height: 90px;
      object-fit: contain;
      image-rendering: pixelated;
      transition: opacity 160ms ease;
      animation: troll-arrive 560ms cubic-bezier(0.22,1,0.36,1) both;
    }
    .goblin-btn:not([disabled]):hover {
      transform: translateY(-3px) scale(1.08);
      filter: drop-shadow(0 0 14px rgba(116,171,123,0.38));
    }
    .goblin-btn:not([disabled]):active { transform: translateY(1px) scale(0.96); }
    .goblin-btn:focus-visible { outline: 3px solid #74ab7b; outline-offset: 8px; }
    .goblin-btn[disabled] { cursor: default; }
    .goblin-tooltip {
      position: absolute;
      top: calc(100% + 14px);
      left: 50%;
      width: max-content;
      max-width: 190px;
      border-radius: 30px;
      background: #74ab7b;
      padding: 7px 14px;
      color: #2b2b2b;
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

    /* Question card */
    .question-card {
      background: #0a0a0a;
      border-radius: 24px;
      padding: 16px 0 4px;
      flex: 1;
      display: flex;
      flex-direction: column;
      animation: q2-card-enter 380ms ease-out both;
    }
    .question-text {
      margin: 0 0 16px;
      font-weight: 600;
      font-size: 1em;
      letter-spacing: 0.02em;
      color: #74ab7b;
      line-height: 1.5;
    }
    .answer-area { margin-bottom: 14px; }

    /* Textarea */
    textarea {
      width: 100%;
      min-height: 110px;
      padding: 14px 16px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: #74ab7b;
      background: rgba(43,43,43,0.50);
      border: 3px solid #74ab7b;
      border-radius: 30px;
      resize: vertical;
      transition: border-color 180ms ease, box-shadow 180ms ease;
      outline: none;
    }
    textarea:focus {
      border-color: #c8e4cc;
      box-shadow: 0 0 0 3px rgba(116,171,123,0.15);
    }
    textarea::placeholder { color: rgba(116,171,123,0.25); opacity: 1; }

    /* MCQ */
    .mcq-fieldset { margin: 0; padding: 0; border: 0; color: #74ab7b; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); letter-spacing: 0.02em; }
    .mcq-legend { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
    .mcq-options { display: grid; gap: 26px; margin-top: 24px; }
    .mcq-option {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 18px;
      padding: 10px 14px;
      border: 1.5px solid rgba(116,171,123,0.28);
      border-radius: 12px;
      cursor: pointer;
      color: #74ab7b;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.5;
      user-select: none;
      transition: border-color 140ms ease, background-color 140ms ease;
      animation: q2-option-enter 360ms ease-out both;
    }
    .mcq-option:hover { border-color: rgba(116,171,123,0.62); background: rgba(116,171,123,0.05); }
    .mcq-option:nth-child(1) { animation-delay:   0ms; }
    .mcq-option:nth-child(2) { animation-delay:  55ms; }
    .mcq-option:nth-child(3) { animation-delay: 110ms; }
    .mcq-option:nth-child(4) { animation-delay: 165ms; }
    .mcq-option:nth-child(5) { animation-delay: 220ms; }
    .mcq-option input[type="radio"] { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
    .mcq-radio {
      flex: 0 0 40px;
      width: 40px; height: 40px;
      border: 3px solid #74ab7b;
      border-radius: 50%;
      background: rgba(43,43,43,0.50);
      transition: background-color 160ms ease, transform 160ms ease;
    }
    .mcq-option:hover .mcq-radio { transform: scale(1.04); }
    .mcq-option input:checked + .mcq-radio {
      background: #74ab7b;
      animation: q2-radio-select 260ms cubic-bezier(0.34,1.56,0.64,1);
    }
    .mcq-option:has(input:checked) { border-color: #74ab7b; background: rgba(116,171,123,0.10); }
    .mcq-option input:focus-visible + .mcq-radio { outline: 3px solid #c8e4cc; outline-offset: 4px; }
    .mcq-option input:disabled ~ * { cursor: default; }

    /* Ordering */
    .ordering-row {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 14px; margin: 5px 0;
      background: rgba(43,43,43,0.50);
      border: 1px solid rgba(116,171,123,0.28);
      border-radius: 8px;
      color: #74ab7b;
    }
    .ordering-row button {
      padding: 3px 9px; font-size: 0.8em;
      color: #74ab7b; background: rgba(116,171,123,0.16);
      border: 1px solid rgba(116,171,123,0.3); border-radius: 4px;
      cursor: pointer;
      transition: background-color 150ms ease, transform 120ms ease;
    }
    .ordering-row button:hover  { background: rgba(116,171,123,0.3); }
    .ordering-row button:active { transform: scale(0.94); }

    /* Submit pill */
    .submit-pill {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      width: 180px; margin: 16px auto 0; padding: 11px 0;
      font-family: var(--vscode-font-family);
      font-size: 1em; font-weight: 600; letter-spacing: 0.04em;
      color: #74ab7b;
      background: rgba(43,43,43,0.50);
      border: 3px solid #74ab7b;
      border-radius: 100px;
      cursor: pointer;
      transition: background-color 180ms ease, color 180ms ease, transform 180ms ease, box-shadow 180ms ease;
      -webkit-tap-highlight-color: transparent;
      animation: q2-submit-ready 400ms 320ms ease-out both;
    }
    .submit-pill:hover:not(:disabled) { background: #74ab7b; color: #2b2b2b; }
    .submit-pill:active:not(:disabled) {
      transform: scale(0.98);
      border-color: #2b2b2b;
      background: #74ab7b;
      box-shadow: inset 0 0 0 17px rgba(43,43,43,0.50);
      color: rgba(43,43,43,0.50);
    }

    /* Inline validation message */
    .validation-msg {
      text-align: center;
      font-size: 0.88em;
      color: rgba(116,171,123,0.65);
      margin-top: 8px;
      min-height: 1.2em;
      letter-spacing: 0.02em;
    }

    /* ── Screen: Loading ──────────────────────────────────────────────────── */
    #screen-loading {
      display: grid;
      min-height: 100%;
      place-items: center;
      background: #0a0c0b;
    }
    #screen-loading img {
      width: 340px;
      height: auto;
      image-rendering: pixelated;
    }
    .loading-caption {
      margin: 16px 0 0;
      color: var(--vscode-descriptionForeground);
    }

    /* ── Screens: Result (shared) ─────────────────────────────────────────── */
    #screen-result-correct,
    #screen-result-incorrect {
      justify-content: center;
      align-items: center;
    }

    /* Result stack layout */
    .result-stack {
      display: flex;
      width: 200px;
      flex-direction: column;
      align-items: center;
      margin-inline: auto;
    }
    .result-upper-arrow, .result-lower-arrow {
      display: grid;
      width: 72px;
      height: 27px;
      place-items: center;
      background: transparent;
      border: none;
      cursor: pointer;
    }
    .result-bypass-control {
      display: flex;
      flex-direction: column;
      align-items: center;
      background: transparent;
      border: none;
      cursor: pointer;
    }
    .result-bypass-control:disabled { cursor: default; opacity: 1; }
    .result-upper-arrow img {
      transform: rotate(180deg);
      transition: transform 220ms cubic-bezier(0.34,1.56,0.64,1);
    }
    .result-hint {
      display: grid;
      width: 200px;
      height: 30px;
      margin-top: 16px;
      place-items: center;
      border-radius: 30px;
      background: #74ab7b;
      color: #2b2b2b;
      font-size: 12px;
      letter-spacing: 0.02em;
      transition: color 180ms ease, background-color 180ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1);
    }
    .result-bypass-control:not(:disabled):hover .result-upper-arrow img {
      transform: translateY(-4px) rotate(180deg);
    }
    .result-bypass-control:not(:disabled):hover .result-hint {
      background: #cbe6cf;
      transform: translateY(-2px);
    }
    .drawgoblin-troll.result-troll {
      display: block;
      margin-top: 16px;
      margin-inline: auto;
      object-fit: contain;
      image-rendering: pixelated;
      transform-origin: center bottom;
    }
    .result-message {
      display: grid;
      width: 200px;
      min-height: 75px;
      margin-top: 16px;
      place-content: center;
      border-radius: 30px;
      background: #74ab7b;
      padding: 9px 20px;
      color: #2b2b2b;
      font-size: 12px;
      line-height: 1.5;
      letter-spacing: 0.02em;
      text-align: center;
    }
    .result-message.bubble-incorrect {
      background: #976263;
      color: #fff;
      animation: incorrect-message-impact 420ms ease-out both;
    }
    .result-lower-arrow {
      margin-top: 16px;
    }
    .result-lower-arrow:not(:disabled):hover { transform: translateY(4px); }
    .result-lower-arrow img {
      animation: result-arrow-reveal 460ms 280ms cubic-bezier(0.34,1.56,0.64,1) both;
    }
    /* result-stack correct state: goblin shifted up, no bypass */
    #screen-result-correct .result-stack {
      transform: translateY(65px);
    }
    #screen-result-correct .result-troll {
      margin-top: 0;
      animation: correct-troll-reveal 460ms cubic-bezier(0.2,0.8,0.2,1) both;
    }
    #screen-result-incorrect .result-troll {
      animation: incorrect-troll-reveal 460ms cubic-bezier(0.2,0.8,0.2,1) both;
    }
    .correct-reveal  { animation: correct-troll-reveal 460ms cubic-bezier(0.2,0.8,0.2,1) both; }
    .wrong-reveal    { animation: incorrect-troll-reveal 460ms cubic-bezier(0.2,0.8,0.2,1) both; }

    /* Speech bubbles (keep for explanation screen compat) */
    .bubble-missed {
      margin-top: 8px;
      padding-left: 16px;
      color: rgba(255,255,255,0.8);
    }
    .bubble-missed li { margin-bottom: 4px; }
    .bubble-evidence {
      display: block;
      margin-top: 2px;
      font-size: 0.88em;
      color: rgba(255,255,255,0.55);
      font-style: italic;
    }
    .bubble-correct-option {
      margin-top: 8px;
      font-weight: 600;
      color: rgba(255,255,255,0.9);
    }

    /* Next question button on incorrect result */
    .result-next-q-btn {
      display: inline-flex; align-items: center;
      padding: 9px 20px; margin-top: 12px;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
      font-weight: 600; color: #2b2b2b;
      background: #74ab7b;
      border: none; border-radius: 100px;
      cursor: pointer;
      transition: background-color 180ms ease, transform 180ms ease;
      -webkit-tap-highlight-color: transparent;
    }
    .result-next-q-btn:hover  { background: #c8e4cc; }
    .result-next-q-btn:active { transform: scale(0.96); }

    /* Dispute button */
    .dispute-btn-result {
      display: inline-flex; align-items: center;
      padding: 7px 16px; margin-top: 10px;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
      font-weight: 500; color: #74ab7b;
      background: rgba(43,43,43,0.50);
      border: 2px solid rgba(116,171,123,0.45); border-radius: 100px;
      cursor: pointer;
      transition: background-color 180ms ease, border-color 180ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1);
    }
    .dispute-btn-result:hover  { background: rgba(116,171,123,0.16); border-color: #74ab7b; }
    .dispute-btn-result:active { transform: scale(0.95); }

    /* Brand logo above question */
    .brand-logo-img {
      display: block;
      width: clamp(220px, 34cqw, 280px);
      height: auto;
      image-rendering: pixelated;
      margin: 0 auto 20px;
    }

    /* ── Screen: Explanation ──────────────────────────────────────────────── */
    #screen-explanation { align-items: stretch; }

    .explanation-goblin-area {
      display: flex;
      justify-content: center;
      margin: 8px 0 16px;
    }
    .explanation-goblin-img {
      width: 90px; height: 90px;
      object-fit: contain;
      image-rendering: pixelated;
      animation: explanation-troll-wobble 3.6s 600ms ease-in-out infinite;
    }
    .exp-heading {
      margin: 0 0 14px;
      font-size: 1em; font-weight: 600; letter-spacing: 0.02em;
      color: #74ab7b; line-height: 1.5; text-align: center;
      animation: q3-copy-enter 380ms 180ms ease-out both;
    }
    .exp-text-box {
      border: 1px solid rgba(116,171,123,0.24);
      border-radius: 24px;
      background: rgba(43,43,43,0.32);
      padding: 12px 16px;
      color: #74ab7b;
      font-size: 0.93em; font-weight: 400; line-height: 1.55; letter-spacing: 0.02em;
      margin-bottom: 12px;
      animation: q3-copy-enter 420ms 260ms ease-out both;
    }
    .exp-answer-label {
      margin: 8px 0 6px;
      font-size: 0.9em; font-weight: 600; letter-spacing: 0.02em;
      color: #74ab7b;
      animation: q3-copy-enter 360ms 320ms ease-out both;
    }
    .exp-answer-block {
      border-radius: 24px;
      background: rgba(43,43,43,0.22);
      padding: 12px 16px;
      color: #74ab7b;
      font-size: 0.93em; font-weight: 500; line-height: 1.5; letter-spacing: 0.02em;
      margin-bottom: 14px;
      animation: q3-answer-reveal 420ms 360ms cubic-bezier(0.34,1.56,0.64,1) both;
    }
    .exp-next-btn {
      display: flex; align-items: center; justify-content: center;
      width: 180px; margin: 16px auto 0; padding: 11px 0;
      font-family: var(--vscode-font-family);
      font-size: 1em; font-weight: 600; letter-spacing: 0.04em;
      color: #74ab7b;
      background: rgba(43,43,43,0.50);
      border: 3px solid #74ab7b;
      border-radius: 100px;
      cursor: pointer;
      transition: background-color 180ms ease, color 180ms ease;
      -webkit-tap-highlight-color: transparent;
      animation: explanation-button-label 400ms 460ms ease-out both;
    }
    .exp-next-btn:hover  { background: #74ab7b; color: #2b2b2b; }
    .exp-next-btn:active { transform: scale(0.98); }

    .hidden { display: none !important; }

    /* ── Keyframes ─────────────────────────────────────────────────────────── */
    @keyframes troll-arrive {
      from { opacity: 0; transform: translateY(16px) scale(0.6); }
      to   { opacity: 1; transform: translateY(0)    scale(1);   }
    }
    @keyframes answer-check {
      0%, 100% { transform: translateY(0)     scale(1);    opacity: 0.85; }
      50%       { transform: translateY(-14px) scale(1.04); opacity: 1;    }
    }
    @keyframes correct-troll-reveal {
      0%   { opacity: 0; transform: scale(0.5) translateY(20px); }
      60%  { opacity: 1; transform: scale(1.08) translateY(-4px); }
      100% { opacity: 1; transform: scale(1) translateY(0); }
    }
    @keyframes incorrect-troll-reveal {
      0%   { opacity: 0; transform: scale(0.7) rotate(-8deg); }
      40%  { opacity: 1; transform: scale(1.05) rotate(4deg); }
      70%  { transform: scale(0.97) rotate(-2deg); }
      100% { opacity: 1; transform: scale(1) rotate(0deg); }
    }
    @keyframes incorrect-message-impact {
      0%   { opacity: 0; transform: translateX(-20px) scale(0.95); }
      60%  { transform: translateX(4px) scale(1.02); }
      100% { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes correct-pulse {
      0%   { opacity: 0; transform: scale(0.9); }
      60%  { transform: scale(1.03); }
      100% { opacity: 1; transform: scale(1); }
    }
    @keyframes state-enter {
      from { opacity: 0; transform: translateY(12px); filter: blur(3px); }
      to   { opacity: 1; transform: translateY(0);    filter: blur(0);   }
    }
    @keyframes q2-meta-enter {
      from { opacity: 0; transform: translateY(-8px); }
      to   { opacity: 1; transform: translateY(0);    }
    }
    @keyframes q2-dot-pop {
      0%   { transform: scale(0.3); opacity: 0.3; }
      65%  { transform: scale(1.3); }
      100% { transform: scale(1);   opacity: 1;   }
    }
    @keyframes q2-card-enter {
      from { opacity: 0; transform: translateY(16px); }
      to   { opacity: 1; transform: translateY(0);    }
    }
    @keyframes q2-option-enter {
      from { opacity: 0; transform: translateX(-12px); }
      to   { opacity: 1; transform: translateX(0);     }
    }
    @keyframes q2-radio-select {
      0%   { transform: scale(1);    }
      55%  { transform: scale(1.13); }
      100% { transform: scale(1);    }
    }
    @keyframes q2-submit-ready {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0);   }
    }
    @keyframes q2-submit-complete {
      0%   { background: rgba(43,43,43,0.50); }
      50%  { background: rgba(116,171,123,0.3); }
      100% { background: rgba(43,43,43,0.50); }
    }
    @keyframes question-two-enter {
      from { opacity: 0; transform: translateX(20px); }
      to   { opacity: 1; transform: translateX(0);    }
    }
    @keyframes q3-copy-enter {
      from { opacity: 0; transform: translateY(12px); filter: blur(2px); }
      to   { opacity: 1; transform: translateY(0);    filter: blur(0);   }
    }
    @keyframes q3-answer-reveal {
      from { opacity: 0; transform: translateX(-16px) scale(0.97); }
      to   { opacity: 1; transform: translateX(0)     scale(1);    }
    }
    @keyframes result-arrow-reveal {
      from { opacity: 0; transform: translateY(-12px) scale(0.82); }
      70%  { opacity: 1; transform: translateY(3px) scale(1.08); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes explanation-troll-wobble {
      0%, 100% { transform: rotate(0deg) translateY(0); }
      20%      { transform: rotate(-3deg) translateY(-2px); }
      40%      { transform: rotate(3deg) translateY(-3px); }
      60%      { transform: rotate(-2deg) translateY(-1px); }
      80%      { transform: rotate(2deg) translateY(-2px); }
    }
    @keyframes explanation-button-label {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0);   }
    }
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

    /* ── Difficulty screen ───────────────────────────────────────────────────── */
    #screen-difficulty {
      display: flex; align-items: center; justify-content: center;
      min-height: 100%; background: #0a0c0b;
    }
    .difficulty-frame {
      position: relative; width: 360px; height: 394px;
      border: 1px solid #2a302c; border-radius: 24px; background: #0a0c0b;
    }
    .difficulty-slab {
      --slab-top: 56px;
      position: absolute; top: var(--slab-top); left: 34px;
      width: 292px; height: 78px;
      color: #0a0c0b; cursor: pointer; opacity: 1; transform: translateY(0);
      animation: difficulty-slab-enter 350ms ease-out backwards;
      animation-delay: calc(var(--slab-index) * 60ms);
      transition: opacity 250ms ease, transform 150ms ease-out;
      background: none; border: none; padding: 0;
    }
    .difficulty-slab-standard { --slab-top: 158px; }
    .difficulty-slab-deep     { --slab-top: 260px; }
    .difficulty-slab:not(:disabled):hover,
    .difficulty-slab:not(:disabled):focus-visible { transform: translateY(-2px); }
    .difficulty-slab:disabled { cursor: default; }
    .difficulty-slab-selected { transform: translateY(-4px) !important; }
    .difficulty-frame:has(.difficulty-slab-selected) .difficulty-slab:not(.difficulty-slab-selected) { opacity: 0.32; }
    .difficulty-card { display: block; width: 100%; height: 100%; overflow: visible; }
    .difficulty-slab-selected .difficulty-level-bars { animation: difficulty-pips-fill 200ms ease-out both; }
    @keyframes difficulty-slab-enter {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes difficulty-pips-fill {
      from { clip-path: inset(0 100% 0 0); }
      to   { clip-path: inset(0); }
    }

    /* ── Flow loading ────────────────────────────────────────────────────────── */
    .flow-loading {
      display: grid; min-height: 100%; place-items: center; background: #0a0c0b;
      animation: flow-loading-cycle-2500 var(--loading-duration) linear both;
    }
    @keyframes flow-loading-cycle-2500 {
      0%  { opacity: 0; } 8%  { opacity: 1; } 92% { opacity: 1; } 100% { opacity: 0; }
    }

    /* ── Intro logo ──────────────────────────────────────────────────────────── */
    .intro-logo-img {
      width: clamp(300px, 45cqw, 420px); height: auto;
      image-rendering: pixelated;
      animation: screen-enter 450ms ease both;
    }

    /* ── Goblin arrival ──────────────────────────────────────────────────────── */
    .goblin-arrival-img {
      width: 100px; height: 100px;
      object-fit: contain; image-rendering: pixelated;
      animation: troll-arrive 700ms cubic-bezier(0.22,1,0.36,1) both;
    }

    /* ── Chat ────────────────────────────────────────────────────────────────── */
    .chat-stack {
      display: flex; flex-direction: column; align-items: center;
      transform: translateY(60px); transition: transform 280ms ease-out;
    }
    .chat-troll-img {
      width: 100px; height: 100px; object-fit: contain; image-rendering: pixelated;
      transition: transform 420ms cubic-bezier(0.34,1.56,0.64,1);
    }
    .chat-bubble {
      width: 200px; min-height: 75px; margin-top: -1px;
      display: grid; place-items: center;
      border-radius: 30px; background: #74ab7b; padding: 10px 20px;
      color: #2b2b2b; font-size: 13px; font-weight: 400;
      line-height: 1.5; letter-spacing: 0.02em; text-align: center;
      transform-origin: 50% 0;
      animation: chat-bubble-pop 420ms cubic-bezier(0.34,1.56,0.64,1) both;
    }
    .continue-button {
      display: grid; width: 72px; height: 58px;
      place-items: start center; padding-top: 16px;
      cursor: pointer; background: none; border: none;
      transition: transform 180ms ease;
    }
    .continue-button:hover { transform: translateY(4px); }
    @keyframes screen-enter {
      from { opacity: 0; transform: scale(0.985); filter: blur(4px); }
      to   { opacity: 1; transform: scale(1); filter: blur(0); }
    }
    @keyframes troll-arrive {
      0%   { opacity: 0; transform: translateY(8px) scale(0.15); }
      68%  { opacity: 1; transform: translateY(-5px) scale(1.08); }
      84%  { transform: translateY(2px) scale(0.97); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes chat-bubble-pop {
      from { opacity: 0; transform: translateY(-10px) scale(0.35, 0.15); }
      65%  { opacity: 1; transform: translateY(2px) scale(1.06, 1.08); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
  </style>
</head>
<body>
<div class="app-shell">

  <!-- Screen 0a: Difficulty selector -->
  <div id="screen-difficulty">
    <div class="difficulty-frame">
      <button type="button" class="difficulty-slab difficulty-slab-quick" style="--slab-index:0">
        <svg class="difficulty-card" viewBox="0 0 292 78" aria-hidden="true">
          <defs><linearGradient id="dg-quick" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#BDDBC1"/><stop offset="1" stop-color="#74AB7B"/></linearGradient></defs>
          <path d="M0 28H292L272 78H20Z" fill="url(#dg-quick)"/>
          <path d="M0 28H5L25 78H20Z" fill="#0A0C0B" fill-opacity=".2"/>
          <path d="M292 28H287L267 78H272Z" fill="#0A0C0B" fill-opacity=".2"/>
          <path d="M12.4 34H279.6L268 63H24Z" fill="#0A0C0B" fill-opacity=".14" stroke="#0A0C0B" stroke-opacity=".38" stroke-width="1.5"/>
          <g class="difficulty-level-bars"><rect x="93" y="45" width="30" height="6" fill="#0A0C0B"/><rect x="131" y="45" width="30" height="6" fill="#0A0C0B" fill-opacity=".22"/><rect x="169" y="45" width="30" height="6" fill="#0A0C0B" fill-opacity=".22"/></g>
          <path d="M16.4 69H275.6L272 78H20Z" fill="#0A0C0B" fill-opacity=".32"/>
          <path d="M0 28V12H6V6H12V0H280V6H286V12H292V28Z" fill="#BDDBC1"/>
          <text x="75.9" y="19" fill="#0A0C0B" font-family="Inter,sans-serif" font-size="16" font-weight="700">Quick</text>
          <text x="127.4" y="19" fill="#1B3A2A" font-family="Inter,sans-serif" font-size="16" font-weight="400">30 seconds</text>
        </svg>
      </button>
      <button type="button" class="difficulty-slab difficulty-slab-standard" style="--slab-index:1">
        <svg class="difficulty-card" viewBox="0 0 292 78" aria-hidden="true">
          <defs><linearGradient id="dg-standard" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#74AB7B"/><stop offset="1" stop-color="#3A914D"/></linearGradient></defs>
          <path d="M0 28H292L272 78H20Z" fill="url(#dg-standard)"/>
          <path d="M0 28H5L25 78H20Z" fill="#0A0C0B" fill-opacity=".2"/>
          <path d="M292 28H287L267 78H272Z" fill="#0A0C0B" fill-opacity=".2"/>
          <path d="M12.4 34H279.6L268 63H24Z" fill="#0A0C0B" fill-opacity=".14" stroke="#0A0C0B" stroke-opacity=".38" stroke-width="1.5"/>
          <g class="difficulty-level-bars"><rect x="93" y="45" width="30" height="6" fill="#0A0C0B"/><rect x="131" y="45" width="30" height="6" fill="#0A0C0B"/><rect x="169" y="45" width="30" height="6" fill="#0A0C0B" fill-opacity=".22"/></g>
          <path d="M16.4 69H275.6L272 78H20Z" fill="#0A0C0B" fill-opacity=".32"/>
          <path d="M0 28V12H6V6H12V0H280V6H286V12H292V28Z" fill="#74AB7B"/>
          <text x="70.4" y="19" fill="#0A0C0B" font-family="Inter,sans-serif" font-size="16" font-weight="700">Standard</text>
          <text x="147.7" y="19" fill="#0F2A19" font-family="Inter,sans-serif" font-size="16" font-weight="400">2 minutes</text>
        </svg>
      </button>
      <button type="button" class="difficulty-slab difficulty-slab-deep" style="--slab-index:2">
        <svg class="difficulty-card" viewBox="0 0 292 78" aria-hidden="true">
          <defs><linearGradient id="dg-deep" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#175E2D"/><stop offset="1" stop-color="#014720"/></linearGradient></defs>
          <path d="M0 28H292L272 78H20Z" fill="url(#dg-deep)"/>
          <path d="M0 28H5L25 78H20Z" fill="#0A0C0B" fill-opacity=".2"/>
          <path d="M292 28H287L267 78H272Z" fill="#0A0C0B" fill-opacity=".2"/>
          <path d="M12.4 34H279.6L268 63H24Z" fill="#0A0C0B" fill-opacity=".14" stroke="#0A0C0B" stroke-opacity=".38" stroke-width="1.5"/>
          <g class="difficulty-level-bars"><rect x="93" y="45" width="30" height="6" fill="#BDDBC1"/><rect x="131" y="45" width="30" height="6" fill="#BDDBC1"/><rect x="169" y="45" width="30" height="6" fill="#BDDBC1"/></g>
          <path d="M16.4 69H275.6L272 78H20Z" fill="#0A0C0B" fill-opacity=".32"/>
          <path d="M0 28V12H6V6H12V0H280V6H286V12H292V28Z" fill="#175E2D"/>
          <text x="82.2" y="19" fill="#F2F8F3" font-family="Inter,sans-serif" font-size="16" font-weight="700">Deep</text>
          <text x="129" y="19" fill="#D6E6DA" font-family="Inter,sans-serif" font-size="16" font-weight="400">10 minutes</text>
        </svg>
      </button>
    </div>
  </div>

  <!-- Screen 0b: Flow loading (GIF) -->
  <div class="screen hidden flow-loading flow-loading-2500" id="screen-flow-loading" style="--loading-duration:2500ms" role="status" aria-label="Loading">
    <img src="${uris.goblinWalk}" width="612" height="384" alt="" aria-hidden="true" style="width:340px;height:auto;image-rendering:pixelated;">
  </div>

  <!-- Screen 0c: Intro (logo only) -->
  <div class="screen hidden" id="screen-intro" style="display:flex;align-items:center;justify-content:center;min-height:100%">
    <img src="${uris.logo}" class="intro-logo-img" alt="DrawBridge">
  </div>

  <!-- Screen 0d: Goblin arrival -->
  <div class="screen hidden" id="screen-goblin" style="display:flex;align-items:center;justify-content:center;min-height:100%">
    <img src="${uris.goblinIdle}" class="goblin-arrival-img" alt="" aria-hidden="true">
  </div>

  <!-- Screen 0e: Chat -->
  <div class="screen hidden" id="screen-chat" style="display:flex;align-items:center;justify-content:center;min-height:100%">
    <div class="chat-stack">
      <img src="${uris.goblinIdle}" class="chat-troll-img" alt="" aria-hidden="true">
      <div class="chat-bubble chat-bubble-pop" id="chat-bubble-text" aria-live="polite"></div>
      <button type="button" class="continue-button" id="chat-continue-btn" aria-label="Continue">
        <img src="${uris.arrowDown}" width="55" height="27" alt="" aria-hidden="true">
      </button>
    </div>
  </div>

  <!-- ── Screen 1: Question ────────────────────────────────────────────── -->
  <div class="screen hidden" id="screen-question">

    <img src="${uris.logo}" class="brand-logo-img" alt="" aria-hidden="true">

    <header class="q-meta">
      <span class="q-label" id="q-label">Question 1</span>
      <div class="progress-dots" id="progress-dots" aria-hidden="true"></div>
    </header>

    <div class="goblin-area">
      <button type="button" class="goblin-btn" id="explain-btn"
              aria-label="Show explanation and skip this question" disabled>
        <img id="goblin-img" src="${uris.goblinSleep}" class="goblin-btn-img" alt="" aria-hidden="true">
        <span class="goblin-tooltip">Show explanation</span>
      </button>
    </div>

    <div class="question-card">
      <p id="question-text" class="question-text"></p>
      <div id="answer-area" class="answer-area"></div>
      <button type="button" class="submit-pill" id="submit-btn" aria-label="Submit answer">
        Submit!
      </button>
      <p class="validation-msg" id="validation-msg" aria-live="polite"></p>
    </div>

  </div>

  <!-- ── Screen 2: Loading ──────────────────────────────────────────────── -->
  <div class="screen hidden" id="screen-loading" role="status" aria-label="Checking your answer">
    <img src="${uris.goblinWalk}" width="612" height="384" alt="" aria-hidden="true">
    <p id="loading-caption" class="loading-caption">Writing a question…</p>
  </div>

  <!-- ── Screen 3: Result — Correct ────────────────────────────────────── -->
  <div class="screen hidden" id="screen-result-correct">
    <div class="result-stack" id="result-correct-stack">
      <img class="drawgoblin-troll result-troll correct-reveal" id="goblin-correct-img"
           src="${uris.goblinCorrect}" width="140" height="114" alt="" aria-hidden="true">
      <div class="result-message bubble-correct" id="bubble-correct" aria-live="polite">
        <p id="bubble-correct-text"></p>
      </div>
      <button type="button" class="result-lower-arrow hidden" id="result-continue-btn">
        <img src="${uris.arrowDown}" width="55" height="27" alt="" aria-hidden="true">
      </button>
    </div>
  </div>

  <!-- ── Screen 4: Result — Incorrect ──────────────────────────────────── -->
  <div class="screen hidden" id="screen-result-incorrect">
    <div class="result-stack" id="result-incorrect-stack" style="transform: translateY(17px)">
      <button type="button" class="result-bypass-control" id="bypass-btn">
        <span class="result-upper-arrow">
          <img src="${uris.arrowUp}" width="55" height="27" alt="" aria-hidden="true">
        </span>
        <span class="result-hint">Drop the bridge</span>
      </button>
      <img class="drawgoblin-troll result-troll wrong-reveal" id="goblin-wrong-img"
           src="${uris.goblinWrong}" width="140" height="114" alt="" aria-hidden="true">
      <div class="result-message bubble-incorrect" id="bubble-incorrect" aria-live="polite">
        <p id="bubble-incorrect-text"></p>
        <ul id="bubble-missed" class="bubble-missed hidden"></ul>
        <p id="bubble-correct-option" class="bubble-correct-option hidden"></p>
      </div>
      <button type="button" class="result-lower-arrow" id="try-again-btn">
        <img src="${uris.arrowDownRed}" width="55" height="27" alt="" aria-hidden="true">
      </button>
      <button type="button" class="result-next-q-btn hidden" id="result-next-q-btn">Next Question</button>
      <button type="button" class="dispute-btn-result hidden" id="dispute-btn">My answer was right</button>
    </div>
  </div>

  <!-- ── Screen 5: Explanation ─────────────────────────────────────────── -->
  <div class="screen hidden" id="screen-explanation">
    <div class="explanation-goblin-area">
      <img src="${uris.goblinIdle}" class="explanation-goblin-img" alt="" aria-hidden="true">
    </div>
    <h2 id="exp-heading" class="exp-heading"></h2>
    <div class="exp-text-box" id="exp-text-box"></div>
    <p class="exp-answer-label hidden" id="exp-answer-label">Correct answer</p>
    <div class="exp-answer-block hidden" id="exp-answer-block"></div>
    <button type="button" class="exp-next-btn" id="exp-next-btn">Next Question</button>
  </div>

</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  /* ── URI constants ────────────────────────────────────────────────────── */
  var URI_SLEEP     = ${JSON.stringify(uris.goblinSleep)};
  var URI_IDLE      = ${JSON.stringify(uris.goblinIdle)};
  var URI_CORRECT   = ${JSON.stringify(uris.goblinCorrect)};
  var URI_WRONG     = ${JSON.stringify(uris.goblinWrong)};
  var URI_DOT1      = ${JSON.stringify(uris.dot1)};
  var URI_DOT2A     = ${JSON.stringify(uris.dot2a)};
  var URI_DOT2B     = ${JSON.stringify(uris.dot2b)};
  var URI_DOT3      = ${JSON.stringify(uris.dot3)};
  var URI_DOT_EMPTY = ${JSON.stringify(uris.dotEmpty)};

  /* ── Element refs ─────────────────────────────────────────────────────── */
  var qLabelEl          = document.getElementById("q-label");
  var progressEl        = document.getElementById("progress-dots");
  var questionTextEl    = document.getElementById("question-text");
  var answerAreaEl      = document.getElementById("answer-area");
  var submitBtn         = document.getElementById("submit-btn");
  var explainBtn        = document.getElementById("explain-btn");
  var goblinImg         = document.getElementById("goblin-img");
  var validationMsgEl   = document.getElementById("validation-msg");

  var bypassBtn         = document.getElementById("bypass-btn");
  var tryAgainBtn       = document.getElementById("try-again-btn");
  var resultNextQBtn    = document.getElementById("result-next-q-btn");
  var resultContinueBtn = document.getElementById("result-continue-btn");
  var disputeBtn        = document.getElementById("dispute-btn");

  var bubbleCorrectText = document.getElementById("bubble-correct-text");
  var bubbleIncorrectText = document.getElementById("bubble-incorrect-text");
  var bubbleMissedEl    = document.getElementById("bubble-missed");
  var bubbleCorrectOpt  = document.getElementById("bubble-correct-option");

  var expHeadingEl      = document.getElementById("exp-heading");
  var expTextBoxEl      = document.getElementById("exp-text-box");
  var expAnswerLblEl    = document.getElementById("exp-answer-label");
  var expAnswerBlkEl    = document.getElementById("exp-answer-block");
  var expNextBtn        = document.getElementById("exp-next-btn");

  /* ── State ────────────────────────────────────────────────────────────── */
  var currentKind = "free-text";
  var lastAnswer  = "";
  var questionNum = 1;
  var showQCount  = 0;
  var TOTAL_DOTS  = 5;

  /* ── Screen management ────────────────────────────────────────────────── */
  var SCREEN_IDS = [
    "screen-question",
    "screen-loading",
    "screen-result-correct",
    "screen-result-incorrect",
    "screen-explanation"
  ];

  function showScreen(id) {
    for (var i = 0; i < SCREEN_IDS.length; i++) {
      var el = document.getElementById(SCREEN_IDS[i]);
      if (!el) continue;
      if (SCREEN_IDS[i] === id) {
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    }
  }

  /* ── Progress dots ────────────────────────────────────────────────────── */
  function renderDots(current) {
    progressEl.innerHTML = "";
    var dotSets = [
      [URI_DOT1, URI_DOT2A, URI_DOT_EMPTY, URI_DOT_EMPTY, URI_DOT_EMPTY],
      [URI_DOT1, URI_DOT2B, URI_DOT_EMPTY, URI_DOT_EMPTY, URI_DOT_EMPTY],
      [URI_DOT1, URI_DOT2B, URI_DOT3, URI_DOT_EMPTY, URI_DOT_EMPTY],
    ];
    var setIdx = Math.min(current - 1, 2);
    var dots = dotSets[setIdx];
    for (var i = 0; i < dots.length; i++) {
      var img = document.createElement("img");
      img.src = dots[i];
      img.width = 22; img.height = 22;
      img.setAttribute("aria-hidden", "true");
      progressEl.appendChild(img);
    }
  }

  /* ── Goblin image swap with crossfade ─────────────────────────────────── */
  function setGoblinState(uri, canExplain) {
    goblinImg.style.opacity = "0";
    setTimeout(function () {
      goblinImg.src = uri;
      goblinImg.style.opacity = "1";
      explainBtn.disabled = !canExplain;
    }, 160);
  }

  /* ── Re-trigger a CSS animation by cloning the class ─────────────────── */
  function retriggerAnimation(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
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

  /* ── Render question (host-driven) ───────────────────────────────────── */
  function renderQuestion(payload) {
    showQCount++;
    questionNum = showQCount;
    qLabelEl.textContent = "Question " + questionNum;
    renderDots(questionNum);
    validationMsgEl.textContent = "";
    setGoblinState(URI_SLEEP, true);
    questionTextEl.textContent = payload.questionText || "";
    renderAnswerArea(payload.kind || "free-text", payload);
    showScreen("screen-question");
  }

  /* ── Show feedback ────────────────────────────────────────────────────
   *
   *  explained === true → explanation screen
   *  passed === true    → correct result screen (extension auto-closes)
   *  passed === false   → incorrect result screen
   *  else               → inline validation on question screen
   * ──────────────────────────────────────────────────────────────────── */
  function showFeedback(payload) {

    /* Explanation screen */
    if (payload.explained) {
      expHeadingEl.textContent = questionTextEl.textContent || "";
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
      if (payload.allowNextQuestion) {
        expNextBtn.classList.remove("hidden");
      } else {
        expNextBtn.classList.add("hidden");
      }
      showScreen("screen-explanation");
      return;
    }

    /* Correct result screen */
    if (payload.passed === true) {
      bubbleCorrectText.textContent = payload.message || "";
      if (payload.allowNextQuestion) {
        resultContinueBtn.classList.remove("hidden");
      } else {
        resultContinueBtn.classList.add("hidden");
      }
      retriggerAnimation(document.getElementById("goblin-correct-img"), "correct-reveal");
      showScreen("screen-result-correct");
      return;
    }

    /* Incorrect result screen */
    if (payload.passed === false) {
      bubbleIncorrectText.textContent = payload.message || "";
      bubbleMissedEl.innerHTML = "";
      if (Array.isArray(payload.missed) && payload.missed.length > 0) {
        bubbleMissedEl.classList.remove("hidden");
        payload.missed.forEach(function (item) {
          var li = document.createElement("li");
          li.textContent = item.text || "";
          if (item.evidence) {
            var ev = document.createElement("span");
            ev.className = "bubble-evidence"; ev.textContent = item.evidence;
            li.appendChild(ev);
          }
          bubbleMissedEl.appendChild(li);
        });
      } else {
        bubbleMissedEl.classList.add("hidden");
      }
      if (payload.correctOption) {
        bubbleCorrectOpt.textContent = "Correct answer: " + payload.correctOption;
        bubbleCorrectOpt.classList.remove("hidden");
      } else {
        bubbleCorrectOpt.classList.add("hidden");
      }
      if (payload.allowNextQuestion) {
        resultNextQBtn.classList.remove("hidden");
      } else {
        resultNextQBtn.classList.add("hidden");
      }
      if (payload.allowDispute) {
        disputeBtn.classList.remove("hidden");
      } else {
        disputeBtn.classList.add("hidden");
      }
      retriggerAnimation(document.getElementById("goblin-wrong-img"), "wrong-reveal");
      showScreen("screen-result-incorrect");
      return;
    }

    /* Validation / other — stay on question screen with inline message */
    validationMsgEl.textContent = payload.message || "";
    showScreen("screen-question");
  }

  /* ── Collect and post submit ──────────────────────────────────────────── */
  function collectSubmit() {
    validationMsgEl.textContent = "";

    if (currentKind === "ordering") {
      var order = Array.from(answerAreaEl.querySelectorAll("[data-index]")).map(function (r) {
        return parseInt(r.dataset.index, 10);
      });
      setGoblinState(URI_SLEEP, false);
      showScreen("screen-loading");
      var loadingCaption = document.getElementById("loading-caption");
      if (loadingCaption) loadingCaption.textContent = "Checking your answer…";
      vscode.postMessage({ type: "submit", order: order });
      return;
    }
    if (currentKind === "multiple-choice") {
      var sel = answerAreaEl.querySelector('input[name="mcq"]:checked');
      if (!sel) {
        validationMsgEl.textContent = "Please select an option before submitting.";
        return;
      }
      lastAnswer = sel.parentElement ? sel.parentElement.textContent.trim() : "";
      setGoblinState(URI_SLEEP, false);
      showScreen("screen-loading");
      var loadingCaption = document.getElementById("loading-caption");
      if (loadingCaption) loadingCaption.textContent = "Checking your answer…";
      vscode.postMessage({ type: "submit", selectedIndex: parseInt(sel.value, 10) });
      return;
    }
    var ta = document.getElementById("answer-input");
    var answer = ta ? ta.value : "";
    lastAnswer = answer;
    setGoblinState(URI_SLEEP, false);
    showScreen("screen-loading");
    var loadingCaption = document.getElementById("loading-caption");
    if (loadingCaption) loadingCaption.textContent = "Checking your answer…";
    vscode.postMessage({ type: "submit", answer: answer });
  }

  /* ── Button listeners ─────────────────────────────────────────────────── */
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

  bypassBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "bypass" });
  });

  tryAgainBtn.addEventListener("click", function () {
    var checked = answerAreaEl.querySelector('input[name="mcq"]:checked');
    if (checked) { checked.checked = false; }
    var ta = document.getElementById("answer-input");
    if (ta) { ta.value = ""; }
    showScreen("screen-question");
    setTimeout(function () {
      var ta2 = document.getElementById("answer-input");
      if (ta2) { ta2.focus(); }
    }, 50);
  });

  resultNextQBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "next_question" });
  });

  resultContinueBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "next_question" });
  });

  disputeBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "dispute", answer: lastAnswer });
  });

  expNextBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "next_question" });
  });

  /* ── Startup: show intro screens then signal ready ───────────────────── */
  renderDots(1);

  var CHAT_MESSAGES = [
    "Hey! I'm Drawgoblin",
    "I'll guide you through your first test in DrawBridge",
    "When you copy and paste code, I'll quiz you to let you pass!",
    "Get it..drawbridge..",
    "Well anyways, please answer these 5 questions, and i'll let you pass!"
  ];

  // Show difficulty screen first; delay "ready" until chat is done
  var introScreenIds = ["screen-difficulty", "screen-flow-loading", "screen-intro", "screen-goblin", "screen-chat"];
  var SCREEN_IDS_ALL = introScreenIds.concat(SCREEN_IDS); // SCREEN_IDS is existing array

  function showScreenById(id) {
    var allIds = SCREEN_IDS_ALL;
    for (var i = 0; i < allIds.length; i++) {
      var el = document.getElementById(allIds[i]);
      if (!el) continue;
      if (allIds[i] === id) el.classList.remove("hidden");
      else el.classList.add("hidden");
    }
  }

  // Difficulty selection
  var diffBtns = document.querySelectorAll(".difficulty-slab");
  for (var i = 0; i < diffBtns.length; i++) {
    diffBtns[i].addEventListener("click", function(e) {
      var btn = e.currentTarget;
      btn.closest(".difficulty-frame").querySelectorAll(".difficulty-slab").forEach(function(b) {
        b.classList.remove("difficulty-slab-selected");
      });
      btn.classList.add("difficulty-slab-selected");
      for (var j = 0; j < diffBtns.length; j++) diffBtns[j].disabled = true;
      setTimeout(function() { showScreenById("screen-flow-loading"); }, 700);
      setTimeout(function() { showScreenById("screen-intro"); }, 700 + 2500);
      setTimeout(function() { showScreenById("screen-goblin"); }, 700 + 2500 + 1500);
      setTimeout(function() { showScreenById("screen-chat"); }, 700 + 2500 + 1500 + 900);
    });
  }

  // Chat cycling
  var chatMsgIndex = 0;
  var chatBubbleEl = document.getElementById("chat-bubble-text");
  var continueBtnEl = document.getElementById("chat-continue-btn");
  function updateChatBubble() {
    if (chatBubbleEl) chatBubbleEl.textContent = CHAT_MESSAGES[chatMsgIndex];
  }
  if (continueBtnEl) {
    continueBtnEl.addEventListener("click", function() {
      chatMsgIndex++;
      if (chatMsgIndex >= CHAT_MESSAGES.length) {
        showScreenById("screen-question");
        vscode.postMessage({ type: "ready" });
      } else {
        updateChatBubble();
      }
    });
  }
  updateChatBubble();

  // Open on the loading screen and tell the host immediately. The question
  // replaces this screen as soon as it is ready, instead of waiting through
  // the difficulty tour and the chat.
  showScreenById("screen-loading");
  vscode.postMessage({ type: "ready" });

  /* ── Host message handler ─────────────────────────────────────────────── */
  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (!msg || !msg.type) return;
    if (msg.type === "showQuestion") {
      renderQuestion(msg);
    } else if (msg.type === "grading") {
      if (submitBtn) submitBtn.disabled = true;
      validationMsgEl.textContent = "Grading your answer…";
    } else if (msg.type === "showFeedback") {
      if (submitBtn) submitBtn.disabled = false;
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
    arrowDown:     makeUri("6758d.svg"),
    arrowDownRed:  makeUri("d10af.svg"),
    arrowUp:       makeUri("e3091.svg"),
    dotFull:       makeUri("e0bf4.svg"),
    dotHalf:       makeUri("a822a.svg"),
    dotFull2:      makeUri("9e436.svg"),
    dotFull3:      makeUri("a365e.svg"),
    logo:          makeUri("drawbridge-logo.png"),
    goblinWalk:    makeUri("goblin_walk_circle.gif"),
    dot1:          makeUri("e0bf4.svg"),
    dot2a:         makeUri("12289.svg"),
    dot2b:         makeUri("9e436.svg"),
    dot3:          makeUri("a365e.svg"),
    dotEmpty:      makeUri("a822a.svg"),
  };

  let disposed = false;
  let ready = false;
  let grading = false;
  const queued: unknown[] = [];
  let pendingResolve: ((value: QuizAction) => void) | null = null;
  let queuedAction: QuizAction | null = null;
  const interruptListeners = new Set<(kind: "bypass" | "cancel") => void>();

  const emitInterrupt = (kind: "bypass" | "cancel"): void => {
    for (const listener of interruptListeners) {
      listener(kind);
    }
  };

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
    if (msg.type === "bypass") { emitInterrupt("bypass"); resolvePending({ type: "bypass" }); return; }
    if (msg.type === "explain") { resolvePending({ type: "explain" }); return; }
    if (msg.type === "cancel") { resolvePending({ type: "cancel" }); return; }
    if (msg.type === "next_question") { resolvePending({ type: "next_question" }); return; }
    if (msg.type === "dispute") {
      resolvePending({ type: "dispute", answer: typeof msg.answer === "string" ? msg.answer : "" });
      return;
    }
    if (msg.type !== "submit" || grading) return;
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
    emitInterrupt("cancel");
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
      allowNextQuestion?: boolean;
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

    onInterrupt(listener: (kind: "bypass" | "cancel") => void): () => void {
      interruptListeners.add(listener);
      return () => {
        interruptListeners.delete(listener);
      };
    },

    beginGrade(): void {
      grading = true;
      post({ type: "grading" });
    },

    endGrade(): void {
      grading = false;
    },

    pollInterrupt(): "bypass" | "cancel" | undefined {
      if (queuedAction?.type === "bypass") {
        queuedAction = null;
        return "bypass";
      }
      if (disposed || queuedAction?.type === "cancel") {
        if (queuedAction?.type === "cancel") {
          queuedAction = null;
        }
        return "cancel";
      }
      return undefined;
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
