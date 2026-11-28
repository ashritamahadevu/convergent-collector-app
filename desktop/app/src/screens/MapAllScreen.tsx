import { useEffect, useMemo, useState } from "react";
import BrandLogo from "../components/BrandLogo";
import Toolbar from "../components/Toolbar";
import type { MapPage } from "../../electron/contract";

type Filter = "all" | "review" | "strong";

const empty: MapPage = { files: [], edges: [] };

export default function MapAllScreen() {
  const [page, setPage] = useState<MapPage>(empty);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (!window.drawbridge) throw new Error("Open the desktop app to load the map.");
        const result = await window.drawbridge.readMap();
        if (!active) return;
        if (!result.ok) throw new Error(result.error);
        setPage(result.data);
      } catch (e) {
        if (!active) return;
        setPage(empty);
        setError(e instanceof Error ? e.message : "The map is unavailable.");
      }
    })();
    return () => { active = false; };
  }, []);

  const files = useMemo(() => page.files.filter((file) => {
    if (filter === "strong") return file.status === "understood";
    if (filter === "review") return file.core && (file.status === "not-yet" || file.status === "in-progress");
    return true;
  }), [filter, page.files]);
  const visible = new Set(files.map((file) => file.path));
  const edges = page.edges.filter((edge) => visible.has(edge.fromPath) && visible.has(edge.toPath));
  const current = files.find((file) => file.path === selected) ?? null;
  const linked = current ? edges.filter((edge) => edge.fromPath === current.path || edge.toPath === current.path) : [];

  return (
    <div className="relative size-full live-map">
      <Toolbar active="map" />
      <BrandLogo className="absolute top-[45px] left-[184px] h-[70px] w-[190px] object-contain" />
      <section className="live-panel" aria-labelledby="map-heading">
        <header className="live-panel-heading">
          <h1 id="map-heading">Map</h1>
          <p>File understanding is mastery times recall. Links are the saved call and import edges.</p>
        </header>
        <div className="live-filter-row" role="group" aria-label="Map filters">
          {([["all", "All files"], ["review", "Needs review"], ["strong", "Strong"]] as const).map(([value, label]) => (
            <button className={filter === value ? "live-button live-primary" : "live-button"} key={value} type="button" onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
        {error && <p className="live-hint" role="alert">{error}</p>}
        <div className="live-map-layout">
          <ul className="live-file-list">
            {files.length === 0 && <li className="live-hint">No files in this filter.</li>}
            {files.map((file) => (
              <li key={file.path}>
                <button className={file.path === selected ? "live-button live-primary" : "live-button"} type="button" onClick={() => setSelected(file.path)}>
                  <span>{file.path.split(/[\\/]/).pop()}</span>
                  <strong>{file.status === "skipped" ? "Not core" : Math.round(file.score * 100) + "%"}</strong>
                </button>
              </li>
            ))}
          </ul>
          <aside className="live-file-detail" aria-label="Selected file">
            {!current && <p className="live-hint">Select a file.</p>}
            {current && (
              <>
                <h2>{current.path}</h2>
                <p>{current.status === "understood" ? "Understood" : current.status === "in-progress" ? "In progress" : current.status === "not-yet" ? "Not yet" : "Not a core file"}</p>
                <h3>Links</h3>
                {linked.length === 0 && <p className="live-hint">No saved links.</p>}
                <ul>
                  {linked.map((edge) => (
                    <li key={edge.fromPath + edge.toPath + edge.kind}>
                      {edge.fromPath === current.path ? edge.toPath : edge.fromPath} · {edge.kind}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
