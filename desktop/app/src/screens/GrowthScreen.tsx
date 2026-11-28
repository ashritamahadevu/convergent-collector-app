import { useEffect, useRef, useState } from "react";
import BrandLogo from "../components/BrandLogo";
import Toolbar from "../components/Toolbar";
import type { GrowthPage } from "../../electron/contract";

const empty: GrowthPage = {
  days: 7, totalChecks: 0, completedChecks: 0, bypassedChecks: 0,
  averageScoreOutOfFive: null, firstTry: { completedChecks: 0, averageScoreOutOfFive: null }, points: [],
};

function scoreText(value: number | null): string {
  return value === null ? "Not scored" : value.toLocaleString(undefined, { maximumFractionDigits: 1 }) + " / 5";
}

export default function GrowthScreen() {
  const [days, setDays] = useState<"7" | "30" | "all">("7");
  const [page, setPage] = useState<GrowthPage>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestNumber = useRef(0);

  useEffect(() => {
    const request = ++requestNumber.current;
    setLoading(true); setError("");
    void (async () => {
      try {
        if (!window.drawbridge) throw new Error("Open the desktop app to load growth.");
        const result = await window.drawbridge.readGrowth(days);
        if (request !== requestNumber.current) return;
        if (!result.ok) throw new Error(result.error);
        setPage(result.data);
      } catch (e) {
        if (request !== requestNumber.current) return;
        setPage(empty);
        setError(e instanceof Error ? e.message : "Growth is unavailable.");
      } finally {
        if (request === requestNumber.current) setLoading(false);
      }
    })();
    return () => { requestNumber.current++; };
  }, [days]);

  const peak = Math.max(5, ...page.points.map((point) => point.scoreOutOfFive));

  return (
    <div className="relative size-full live-growth">
      <Toolbar active="growth" />
      <BrandLogo className="absolute top-[45px] left-[184px] h-[70px] w-[190px] object-contain" />
      <section className="live-panel" aria-labelledby="growth-heading">
        <header className="live-panel-heading">
          <h1 id="growth-heading">Growth</h1>
          <p>Scores from saved checks. A quiet stretch with no checks stays empty.</p>
        </header>
        <div className="live-filter-row" role="group" aria-label="Growth period">
          {(["7", "30", "all"] as const).map((value) => (
            <button className={days === value ? "live-button live-primary" : "live-button"} key={value} type="button" onClick={() => setDays(value)}>
              {value === "all" ? "All" : value + " days"}
            </button>
          ))}
        </div>
        {error && <p className="live-hint" role="alert">{error}</p>}
        {loading && <p className="live-hint">Loading growth…</p>}
        <dl className="live-metrics">
          <div><dt>Checks</dt><dd>{page.totalChecks}</dd></div>
          <div><dt>Scored</dt><dd>{page.completedChecks}</dd></div>
          <div><dt>Average</dt><dd>{scoreText(page.averageScoreOutOfFive)}</dd></div>
          <div><dt>First try</dt><dd>{scoreText(page.firstTry.averageScoreOutOfFive)}</dd></div>
          <div><dt>Bypassed</dt><dd>{page.bypassedChecks}</dd></div>
        </dl>
        <ol className="live-bars" aria-label="Score points">
          {page.points.length === 0 && <li className="live-hint">No scored checks in this period.</li>}
          {page.points.slice(-24).map((point) => (
            <li key={point.eventId}>
              <span style={{ height: Math.max(4, (point.scoreOutOfFive / peak) * 120) }} />
              <strong>{point.scoreOutOfFive.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
