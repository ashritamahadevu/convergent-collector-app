import { useEffect, useRef, useState } from "react";
import BrandLogo from "../components/BrandLogo";
import Toolbar from "../components/Toolbar";
import type { ConnectionStatus, ProjectSummary } from "../../electron/contract";

type Props = {
  onOpenProject: (project: ProjectSummary) => void;
  onOpenHistory: () => void;
};

export default function ProjectsScreen({ onOpenProject, onOpenHistory }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const requestNumber = useRef(0);

  async function load() {
    const request = ++requestNumber.current;
    setLoading(true); setError(""); setStatusError("");
    try {
      if (!window.drawbridge) throw new Error("Desktop bridge unavailable. Open this interface with npm.cmd start in desktop/app.");
      const [result, connection] = await Promise.all([
        window.drawbridge.readProjects(), window.drawbridge.readStatus(),
      ]);
      if (request !== requestNumber.current) return;
      setProjects(result.ok ? result.data.projects : []);
      if (!result.ok) setError(result.error);
      setStatus(connection.ok ? connection.data : null);
      if (!connection.ok) setStatusError(connection.error);
    } catch (e) {
      if (request !== requestNumber.current) return;
      setProjects([]); setStatus(null);
      setError(e instanceof Error ? e.message : "Could not load projects. Check the backend and Refresh.");
    } finally {
      if (request === requestNumber.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return () => { requestNumber.current++; };
  }, []);

  return <div className="relative size-full live-history-screen">
    <Toolbar active="home" />
    <BrandLogo className="absolute top-[45px] left-[184px] h-[70px] w-[190px] object-contain" />
    <span className="live-local-badge">Your projects · Your learning</span>
    <section className="live-history projects-home" aria-labelledby="projects-heading">
      <header className="live-history-heading">
        <div>
          <p className="live-eyebrow">BUILD. EXPLAIN. UNDERSTAND.</p>
          <h1 id="projects-heading">Projects</h1>
          <p>Pick a project to explore the checks behind your progress.</p>
        </div>
        <div className="live-actions">
          <button className="live-button" onClick={onOpenHistory}>All History</button>
          <button className="live-button live-primary" disabled={loading} onClick={() => void load()}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>
      <div className="live-connection" role="status">
        <span className={"live-dot " + (status?.extensionConnected ? "connected" : "")} />
        <span>{status ? status.extensionConnected ? "Extension recently seen" : "Extension not recently seen" : "Connection status unavailable"}</span>
        <span>{loading ? "Loading projects…" : error ? "Project summaries unavailable" :
          projects.length + (projects.length === 1 ? " project with saved checks" : " projects with saved checks")}</span>
      </div>
      {statusError && !error && <p className="live-hint">{statusError}</p>}
      <p className="live-hint">
        Summaries include all saved checks. Assessment averages exclude unscored checks; they are not mastery or first-try scores.
      </p>
      <div className="projects-scroll" aria-busy={loading}>
        {loading ? <div className="live-state" role="status"><h2>Loading your projects…</h2></div>
          : error ? <div className="live-state live-error" role="alert"><h2>Could not load projects</h2><p>{error}</p></div>
          : projects.length === 0 ? <div className="live-state home-glass-card project-empty">
            <img className="project-goblin" src="./assets/home/goblin_sprite.png" alt="" />
            <p className="live-eyebrow">YOUR NEXT CHECK STARTS HERE</p>
            <h2>No projects yet</h2>
            <p>In the Extension Development Host, connect Desktop Dashboard and complete a check in an open project folder.</p>
            <p>Then choose Refresh. Your project will appear here automatically.</p>
            <button className="live-button" onClick={onOpenHistory}>View History</button>
          </div>
          : <div className="project-grid">{projects.map(project => <article className="home-glass-card project-card" key={project.id} aria-label={"Project: " + (project.name || "Unnamed project")}>
            <div className="project-card-top"><span className="project-emblem">PROJECT</span>
              <span className="live-chip">{project.scoredChecks === 0 ? "Not assessed yet" : "Assessment recorded"}</span></div>
            <h2>{project.name || "Unnamed project"}</h2>
            <p className="project-identity" title={project.id}>Project ID: {project.id}</p>
            <div className="project-score">
              <strong>{project.averageScoreOutOfFive === null ? "Not assessed yet" :
                project.averageScoreOutOfFive.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " / 5"}</strong>
              <span>Average assessment score</span>
            </div>
            <dl className="project-counts">
              <div><dt>Recorded checks</dt><dd>{project.totalChecks}</dd></div>
              <div><dt>Scored</dt><dd>{project.scoredChecks}</dd></div>
              <div><dt>Unscored</dt><dd>{project.unscoredChecks}</dd></div>
            </dl>
            <p className="project-activity">Last activity: <time>{new Date(project.lastActivityAt).toLocaleString()}</time></p>
            <button className="live-button live-primary" onClick={() => onOpenProject(project)}>Open History</button>
          </article>)}</div>}
      </div>
    </section>
  </div>;
}
