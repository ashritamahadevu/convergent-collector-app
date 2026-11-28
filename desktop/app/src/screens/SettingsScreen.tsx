import { useEffect, useState } from "react";
import BrandLogo from "../components/BrandLogo";
import Toolbar from "../components/Toolbar";
import type { SettingsEvent } from "../../../../src/dashboard/protocol";

const fields: { key: keyof SettingsEvent; label: string; kind: "boolean" | "number" | "text" | "choice"; choices?: string[] }[] = [
  { key: "enabled", label: "Checks enabled", kind: "boolean" },
  { key: "charThreshold", label: "Character threshold", kind: "number" },
  { key: "minAnswerLength", label: "Minimum answer length", kind: "number" },
  { key: "provider", label: "Provider", kind: "choice", choices: ["openai", "anthropic", "gemini", "ollama", "claude-cli", "cursor-cli", "codex-cli", "gemini-cli", "copilot-cli"] },
  { key: "model", label: "Model", kind: "text" },
  { key: "gradingMode", label: "Grading", kind: "choice", choices: ["free-text", "multiple-choice"] },
  { key: "nonCriticalPassFraction", label: "Non-critical pass fraction", kind: "number" },
  { key: "mode", label: "Mode", kind: "choice", choices: ["auto", "learn", "walkthrough"] },
  { key: "walkthroughFileThreshold", label: "Walkthrough file threshold", kind: "number" },
  { key: "walkthroughLineThreshold", label: "Walkthrough line threshold", kind: "number" },
  { key: "maxFollowups", label: "Max follow-ups", kind: "number" },
  { key: "agentPause", label: "Pause the agent", kind: "boolean" },
  { key: "checkPreset", label: "Check preset", kind: "choice", choices: ["quick", "standard", "deep"] },
  { key: "preferredLanguage", label: "Preferred language", kind: "text" },
  { key: "strictness", label: "Strictness", kind: "choice", choices: ["lenient", "standard", "strict"] },
  { key: "examDate", label: "Exam date", kind: "text" },
  { key: "interviewDate", label: "Interview date", kind: "text" },
];

export default function SettingsScreen() {
  const [current, setCurrent] = useState<SettingsEvent | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (!window.drawbridge) throw new Error("Open the desktop app to edit settings.");
        const result = await window.drawbridge.readSettings();
        if (!active) return;
        if (!result.ok) throw new Error(result.error);
        setCurrent(result.data.settings);
        if (result.data.settings) {
          const next: Record<string, string> = {};
          for (const field of fields) next[field.key] = String(result.data.settings[field.key] ?? "");
          setDraft(next);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Settings are unavailable.");
      }
    })();
    return () => { active = false; };
  }, []);

  async function save() {
    if (!current || !window.drawbridge) return;
    setMessage(""); setError("");
    const next: SettingsEvent = { ...current, updatedAt: Date.now(), occurredAt: Date.now() };
    for (const field of fields) {
      const raw = draft[field.key] ?? "";
      if (field.kind === "boolean") (next as unknown as Record<string, unknown>)[field.key] = raw === "true";
      else if (field.kind === "number") (next as unknown as Record<string, unknown>)[field.key] = Number(raw);
      else (next as unknown as Record<string, unknown>)[field.key] = raw;
    }
    const result = await window.drawbridge.writeSettings(next);
    if (!result.ok) { setError(result.error); return; }
    setCurrent(next);
    setMessage("Saved. VS Code picks this up on its next sync.");
  }

  return (
    <div className="relative size-full live-settings">
      <Toolbar active="home" />
      <BrandLogo className="absolute top-[45px] left-[184px] h-[70px] w-[190px] object-contain" />
      <section className="live-panel" aria-labelledby="settings-heading">
        <header className="live-panel-heading">
          <h1 id="settings-heading">Settings</h1>
          <p>These are the shared student settings. API keys stay in VS Code.</p>
        </header>
        {error && <p className="live-hint" role="alert">{error}</p>}
        {!current && !error && <p className="live-hint">Connect the extension and turn on desktop sync before editing settings here.</p>}
        {current && (
          <form className="live-settings-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            {fields.map((field) => (
              <label key={field.key}>
                <span>{field.label}</span>
                {field.kind === "choice" ? (
                  <select value={draft[field.key] ?? ""} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}>
                    {field.choices?.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
                  </select>
                ) : field.kind === "boolean" ? (
                  <select value={draft[field.key] ?? "true"} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}>
                    <option value="true">On</option>
                    <option value="false">Off</option>
                  </select>
                ) : (
                  <input value={draft[field.key] ?? ""} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />
                )}
              </label>
            ))}
            <button className="live-button live-primary" type="submit">Save settings</button>
            {message && <p className="live-hint">{message}</p>}
          </form>
        )}
      </section>
    </div>
  );
}
