import { useEffect, useRef, useState } from "react";
import BrandLogo from "../components/BrandLogo";
import Toolbar from "../components/Toolbar";
import type { ReviewEvent } from "../../../../src/dashboard/protocol";
import type { ConnectionStatus } from "../../electron/contract";

const pageSize = 20;
const date = (value: number | null) => {
  if (value === null) return "Never";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Timestamp unavailable" : d.toLocaleString();
};
const score = (event: ReviewEvent) => event.score === null
  ? "Not scored" : (event.score * 5).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " / 5";

export default function HistoryScreen() {
  const [checks, setChecks] = useState<ReviewEvent[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const requestNumber = useRef(0);

  async function load(nextOffset: number) {
    const request = ++requestNumber.current;
    setLoading(true);
    setError("");
    setStatusError("");
    const bridge = window.drawbridge;
    if (!bridge) {
      setError("Desktop bridge unavailable. Open this interface with npm.cmd start in desktop/app, rather than in a web browser.");
      setChecks([]);
      setStatus(null);
      setLoading(false);
      return;
    }
    try {
      const [history, connection] = await Promise.all([
        bridge.readHistory({ limit: pageSize, offset: nextOffset }), bridge.readStatus(),
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

  return (
    <div className="history-screen relative size-full live-history-screen">
      <Toolbar active="history" />
      <BrandLogo className="absolute top-[45px] left-[184px] h-[70px] w-[190px] object-contain" />
      <span className="live-local-badge">Local learning history</span>
      <section className="live-history" aria-labelledby="history-heading">
        <header className="live-history-heading">
          <div>
            <p className="live-eyebrow">YOUR LEARNING RECORD</p>
            <h1 id="history-heading">History</h1>
            <p>One comprehension check per row. Open a check to read its answer and feedback.</p>
          </div>
          <button className="live-button live-primary" disabled={loading} onClick={() => void load(0)}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </header>
        <div className="live-connection" role="status">
          <span className={"live-dot " + (status?.extensionConnected ? "connected" : "")} />
          <span>{status
            ? status.extensionConnected ? "Extension recently seen" : "Extension not recently seen"
            : "Connection status unavailable"}</span>
          {status && <span>Last check received: {date(status.lastSyncedAt)}</span>}
          {updatedAt !== null && !error && <span>Loaded: {date(updatedAt)}</span>}
        </div>
        {status && !status.extensionConnected && <p className="live-hint">
          History remains available while VS Code is closed. To send new checks, pair the extension and enable Desktop Sync.
        </p>}
        {statusError && !error && <p className="live-hint">{statusError}</p>}
        <div className="live-history-tools">
          <span className="live-chip">All checks · newest first</span>
          <p>Search, week and “Needs review” filters are deferred until they can cover all pages.</p>
        </div>
        <p className="live-hint">
          Assessment scores use the recorded score × 5, not a count of five questions or a first-try score.
          Bypasses and other unscored checks say “Not scored.”
        </p>
        <div className="live-records" aria-busy={loading}>
          {loading ? <div className="live-state" role="status"><h2>Loading saved checks…</h2></div>
            : error ? <div className="live-state live-error" role="alert">
                <h2>Could not load History</h2><p>{error}</p>
              </div>
            : checks.length === 0 ? <div className="live-state">
                <h2>{offset === 0 ? "No learning checks yet" : "No more checks on this page"}</h2>
                <p>{offset === 0
                  ? "Start and pair the VS Code extension, complete a supported quiz, then choose Refresh."
                  : "Choose Previous or Refresh to return to the newest saved checks."}</p>
              </div>
            : <table className="live-table">
                <thead><tr><th>Check / details</th><th>Concepts</th><th>When</th><th>Assessment</th><th>Outcome</th></tr></thead>
                <tbody>{checks.map(event => <tr key={event.eventId}>
                  <td><details>
                    <summary><strong>{event.project.name || "Unnamed project"}</strong>
                      <span className="live-question">{event.question || "Question text unavailable"}</span>
                      <span className="live-detail-prompt">View answer and feedback</span>
                    </summary>
                    <dl className="live-details">
                      <dt>Question</dt><dd>{event.question || "Not captured"}</dd>
                      <dt>Final recorded answer</dt><dd>{event.answer || "Not captured by this check path"}</dd>
                      <dt>Feedback</dt><dd>{event.feedback || "Not captured"}</dd>
                      {event.misconception && <><dt>Misconception</dt><dd>{event.misconception}</dd></>}
                      <dt>File</dt><dd>{event.filePath || "Not available"}</dd>
                      <dt>Source / mode</dt><dd>{event.source} / {event.mode}</dd>
                      <dt>Topic / check shape</dt><dd>{event.topic || "Not tagged"} / {event.shape}</dd>
                      <dt>Check group</dt><dd>{event.groupId}</dd>
                      <dt>Reported retries</dt><dd>{event.retries} · Individual attempts are not stored here. Local-picker checks report zero when unavailable.</dd>
                      <dt>Event ID</dt><dd>{event.eventId}</dd>
                    </dl>
                  </details></td>
                  <td>{event.concepts.length ? event.concepts.join(", ") : "Not tagged"}</td>
                  <td><time>{date(event.occurredAt)}</time></td>
                  <td className="live-score">{score(event)}</td>
                  <td><span className={"live-outcome outcome-" + event.outcome}>{event.outcome}</span></td>
                </tr>)}</tbody>
              </table>}
        </div>
        <footer className="live-pagination">
          <span>{checks.length && !error && !loading ? "Checks " + (offset + 1) + "–" + (offset + checks.length) : "20 checks per page"}</span>
          <button className="live-button" disabled={loading || offset === 0} onClick={() => void load(Math.max(0, offset - pageSize))}>Previous</button>
          <button className="live-button" disabled={loading || !!error || checks.length < pageSize} onClick={() => void load(offset + pageSize)}>Next</button>
        </footer>
      </section>
    </div>
  );
}
