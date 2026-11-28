import { Fragment, useEffect, useRef, useState } from "react";
import BrandLogo from "../components/BrandLogo";
import Toolbar from "../components/Toolbar";
import type { ReviewEvent } from "../../../../src/dashboard/protocol";
import type { ConnectionStatus, ProjectSummary } from "../../electron/contract";

const pageSize = 20;
const date = (value: number | null) => {
  if (value === null) return "Never";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Timestamp unavailable" : d.toLocaleString();
};
const score = (event: ReviewEvent) => event.score === null
  ? "Not scored" : (event.score * 5).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "/5";

const shortDate = (value: number) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Unavailable" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

type Project = Pick<ProjectSummary, "id" | "name">;
export default function HistoryScreen({ project, onProjectChange }: {
  project: Project | null; onProjectChange: (project: Project | null) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [checks, setChecks] = useState<ReviewEvent[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsError, setProjectsError] = useState("");
  const requestNumber = useRef(0);

  async function load(nextOffset: number) {
    const request = ++requestNumber.current;
    setLoading(true);
    setExpandedId(null);
    setError("");
    setStatusError("");
    setProjectsError("");
    const bridge = window.drawbridge;
    if (!bridge) {
      setError("Desktop bridge unavailable. Open this interface with npm.cmd start in desktop/app, rather than in a web browser.");
      setChecks([]);
      setStatus(null);
      setLoading(false);
      return;
    }
    try {
      const [history, connection, list] = await Promise.all([
        bridge.readHistory({ limit: pageSize, offset: nextOffset, projectId: project?.id }), bridge.readStatus(),
        bridge.readProjects(),
      ]);
      if (request !== requestNumber.current) return;
      if (!history.ok) {
        setError(history.error);
        setChecks([]);
      } else {
        setChecks(history.data.checks);
        setOffset(nextOffset);
        setUpdatedAt(Date.now());
      }
      setStatus(connection.ok ? connection.data : null);
      if (!connection.ok) setStatusError(connection.error);
      setProjects(list.ok ? list.data.projects : []);
      if (!list.ok) setProjectsError(list.error);
    } catch {
      if (request !== requestNumber.current) return;
      setChecks([]);
      setStatus(null);
      setError("The desktop bridge could not complete the request. Restart the desktop app and check the backend terminal.");
    } finally {
      if (request === requestNumber.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load(0);
    return () => { requestNumber.current++; };
  }, []);

  const page = Math.floor(offset / pageSize) + 1;
  const pagination = <div className="history-page-controls">
    <button aria-label="First page" title="First page" disabled={loading || offset === 0}
      onClick={() => void load(0)}>«</button>
    <button aria-label="Previous" title="Previous page" disabled={loading || offset === 0}
      onClick={() => void load(Math.max(0, offset - pageSize))}>‹</button>
    <span aria-label={"Page " + page}>Page {page}</span>
    <button aria-label="Next" title="Next page" disabled={loading || !!error || checks.length < pageSize}
      onClick={() => void load(offset + pageSize)}>›</button>
  </div>;

  return (
    <div className="history-screen history-view relative size-full live-history-screen">
      <Toolbar active="history" />
      <BrandLogo className="absolute top-[45px] left-[184px] h-[70px] w-[190px] object-contain" />
      <section className="live-history" aria-labelledby="history-heading">
        <header className="live-history-heading">
          <div>
            <h1 id="history-heading">History</h1>
            <p>{project ? projects.find(p => p.id === project.id)?.name || project.name || "Unnamed project" : "All projects"}</p>
          </div>
          <div className="history-header-actions">
            <span className="history-sync" role="status"
              title={status ? "Last received: " + date(status.lastSyncedAt) + (updatedAt ? " · Refreshed: " + date(updatedAt) : "") : statusError}>
              <span className={"live-dot " + (status?.extensionConnected ? "connected" : "")} />
              {status ? status.extensionConnected ? "Connected" : "Waiting for extension" : "Status unavailable"}
            </span>
            <button className="live-button live-primary" disabled={loading} onClick={() => void load(0)}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </header>
        {statusError && !error && <p className="live-hint">{statusError}</p>}
        <h2 className="history-section-title">Checks</h2>
        <div className="live-history-tools">
          <div className="history-filter-controls">
            <span className="history-all-pill">All checks</span>
            <label className="project-filter">
              <span className="history-project-label">Project</span>
              <select aria-label="Project" value={project?.id ?? ""} disabled={loading} onChange={e => {
                const selected = projects.find(p => p.id === e.target.value);
                onProjectChange(selected ? { id: selected.id, name: selected.name } : null);
              }}>
                <option value="">All projects</option>
                {project && !projects.some(p => p.id === project.id) &&
                  <option value={project.id}>{project.name || "Unnamed project"}</option>}
                {projects.map(p => <option key={p.id} value={p.id}>{p.name || "Unnamed project"} · {p.id.slice(0, 8)}</option>)}
              </select>
            </label>
          </div>
          {pagination}
        </div>
        {projectsError && !error && <p className="live-hint">Project selector unavailable: {projectsError}</p>}
        <div className="live-records" aria-busy={loading}>
          {loading ? <div className="live-state" role="status"><h2>Loading saved checks…</h2></div>
            : error ? <div className="live-state live-error" role="alert">
                <h2>Could not load History</h2><p>{error}</p>
              </div>
            : checks.length === 0 ? <div className="live-state">
                <h2>{offset === 0 ? "No learning checks yet" : "No more checks on this page"}</h2>
                <p>{offset === 0
                  ? "Complete a check in VS Code, then choose Refresh."
                  : "Choose Previous or Refresh to return to the newest saved checks."}</p>
              </div>
            : <table className="live-table">
                <thead><tr><th scope="col">Checks</th><th scope="col">Concepts</th><th scope="col">Date</th><th scope="col">Score</th><th scope="col">Status</th></tr></thead>
                <tbody>{checks.map(event => <Fragment key={event.eventId}>
                  <tr className="history-record">
                    <td>
                      <button className="history-check-toggle" aria-expanded={expandedId === event.eventId}
                        aria-controls={"details-" + event.eventId}
                        onClick={() => setExpandedId(id => id === event.eventId ? null : event.eventId)}
                        title="View answer and feedback">
                        <strong>{event.project.name || "Unnamed project"}<span className="history-row-chevron" aria-hidden="true">{expandedId === event.eventId ? "−" : "+"}</span></strong>
                        <span className="live-question">{event.question || "Question text unavailable"}</span>
                      </button>
                    </td>
                    <td className="history-concepts">{event.concepts.length ? event.concepts.join(", ") : "Not tagged"}</td>
                    <td className="history-date"><time title={date(event.occurredAt)}>{shortDate(event.occurredAt)}</time></td>
                    <td className="live-score">
                      <div className="history-score-value" title="Recorded assessment score">
                        <span className="history-score-blocks" aria-hidden="true">
                          {[0, 1, 2, 3, 4].map(index => <span key={index}>
                            <i style={{ width: (event.score === null ? 0 : Math.max(0, Math.min(1, event.score * 5 - index))) * 100 + "%" }} />
                          </span>)}
                        </span>
                        <strong>{score(event)}</strong>
                      </div>
                    </td>
                    <td><span className={"live-outcome outcome-" + event.outcome}>{event.outcome}</span></td>
                  </tr>
                  {expandedId === event.eventId && <tr className="history-detail-row" id={"details-" + event.eventId}>
                    <td colSpan={5}>
                      <dl className="live-details">
                        <dt>Question</dt><dd>{event.question || "Not captured"}</dd>
                        <dt>Final recorded answer</dt><dd>{event.answer || "Not captured by this check path"}</dd>
                        <dt>Feedback</dt><dd>{event.feedback || "Not captured"}</dd>
                        {event.misconception && <><dt>Misconception</dt><dd>{event.misconception}</dd></>}
                        <dt>Project</dt><dd>{event.project.name || "Unnamed project"}</dd>
                        <dt>Date</dt><dd>{date(event.occurredAt)}</dd>
                        <dt>File</dt><dd>{event.filePath || "Not available"}</dd>
                        <dt>Source / mode</dt><dd>{event.source} / {event.mode}</dd>
                        <dt>Topic / check shape</dt><dd>{event.topic || "Not tagged"} / {event.shape}</dd>
                        <dt>Check group</dt><dd>{event.groupId}</dd>
                        <dt>Reported retries</dt><dd>{event.retries} · Individual attempts are not stored here. Local-picker checks report zero when unavailable.</dd>
                        <dt>Event ID</dt><dd>{event.eventId}</dd>
                      </dl>
                    </td>
                  </tr>}
                </Fragment>)}</tbody>
              </table>}
        </div>
      </section>
    </div>
  );
}
