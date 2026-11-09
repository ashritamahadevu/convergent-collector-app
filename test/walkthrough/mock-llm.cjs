"use strict";

/**
 * In-process stand-in for the Ollama chat endpoint. It replaces
 * globalThis.fetch so nothing ever binds or connects to 127.0.0.1:11434.
 * Generation answers are fixed so tests know the right answers:
 *   multiple-choice: correctIndex 1
 *   ordering: items ["second", "first", "third"], correctOrder [1, 0, 2]
 *   free-text judge: passes when the answer contains "GOOD"
 */

const calls = [];
let failGenerate = false;
let tags = ["control-flow"];

function reply(content) {
  return new Response(JSON.stringify({ message: { content } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function mockFetch(url, init) {
  const target = String(url);
  if (!target.includes("11434")) {
    throw new Error("unexpected network call in test: " + target);
  }
  const body = JSON.parse(init.body);
  const prompt = body.messages.map((m) => m.content).join("\n");
  const kind = prompt.includes("Generate ONE ordering question")
    ? "ordering"
    : prompt.includes("Generate ONE multiple-choice")
      ? "multiple-choice"
      : prompt.includes("Generate ONE free-text")
        ? "free-text"
        : "judge";
  const code = (prompt.match(/<code language="[^"]*">\n([\s\S]*?)\n<\/code>/) || [])[1] || "";
  calls.push({ kind, code, prompt });
  if (kind !== "judge" && failGenerate) {
    return new Response("model down", { status: 400 });
  }
  if (kind === "ordering") {
    return reply(JSON.stringify({
      kind: "ordering",
      question: "Put the steps in order.",
      referenceAnswer: "first, second, third",
      items: ["second", "first", "third"],
      correctOrder: [1, 0, 2],
      conceptTags: tags,
      flagged: false,
    }));
  }
  if (kind === "multiple-choice") {
    return reply(JSON.stringify({
      kind: "multiple-choice",
      question: "What does it return?",
      referenceAnswer: "B",
      criteria: [],
      options: ["A", "B", "C"],
      correctIndex: 1,
      conceptTags: tags,
      flagged: false,
    }));
  }
  if (kind === "free-text") {
    return reply(JSON.stringify({
      kind: "free-text",
      question: "Explain the main behavior.",
      referenceAnswer: "It does the thing.",
      criteria: [
        { id: "c1", text: "Names the main outcome", hint: "Look at the return", critical: true },
        { id: "c2", text: "Mentions the input", hint: "Look at the parameter", critical: false },
      ],
      conceptTags: tags,
      flagged: false,
    }));
  }
  const answer = (prompt.match(/<student_answer>\n([\s\S]*?)\n<\/student_answer>/) || [])[1] || "";
  const verdict = answer.includes("GOOD") ? "pass" : "fail";
  return reply(JSON.stringify({
    criteria: [
      { id: "c1", analysis: "x", verdict, evidence: verdict === "pass" ? "GOOD" : "NONE" },
      { id: "c2", analysis: "x", verdict, evidence: verdict === "pass" ? "GOOD" : "NONE" },
    ],
    misconception: verdict === "pass" ? "" : "missed it",
  }));
}

module.exports = {
  install() {
    globalThis.fetch = mockFetch;
  },
  calls,
  reset() {
    calls.length = 0;
    failGenerate = false;
    tags = ["control-flow"];
  },
  setFailGenerate(v) {
    failGenerate = v;
  },
  setTags(v) {
    tags = v;
  },
};
