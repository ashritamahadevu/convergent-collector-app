import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import GrowthScreen from "./screens/GrowthScreen";
import HistoryScreen from "./screens/HistoryScreen";
import ProjectsScreen from "./screens/ProjectsScreen";
import HomeScreen from "./screens/HomeScreen";
import SettingsScreen from "./screens/SettingsScreen";
import type { ProjectSummary } from "../electron/contract";
import MapAllScreen from "./screens/MapAllScreen";

type Screen = "home" | "history" | "growth" | "map";
type UpdateStatus = { phase: "downloading" | "ready" | "error"; version: string | null; message: string | null };
type HomePanel = "home" | "projects" | "settings";

function UpdateBanner({ status, onRestart }: { status: UpdateStatus; onRestart: () => void }) {
  const name = status.version ? `DrawBridge ${status.version}` : "DrawBridge";
  const text = status.phase === "downloading"
    ? `Downloading ${name}.`
    : status.phase === "ready"
      ? `${name} is ready.`
      : status.message || "Couldn't check for updates.";
  return (
    <div className="update-banner" role="status">
      <span>{text}</span>
      {status.phase === "ready" && (
        <button className="live-button live-primary" onClick={onRestart} type="button">Restart</button>
      )}
    </div>
  );
}

const navItems: Array<{ screen: Screen; label: string; top: number }> = [
  { screen: "home", label: "Home", top: 278 },
  { screen: "history", label: "History", top: 409 },
  { screen: "growth", label: "Growth", top: 541 },
  { screen: "map", label: "Map", top: 672 },
];

const toolbarOffsets: Record<Screen, number> = {
  home: 0,
  history: 131,
  growth: 263,
  map: 393,
};

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [homePanel, setHomePanel] = useState<HomePanel>("home");
  const [selectedProject, setSelectedProject] = useState<Pick<ProjectSummary, "id" | "name"> | null>(null);
  const [toolbarMotion, setToolbarMotion] = useState({
    from: 0,
    to: 0,
    overshoot: 0,
    tailOffset: 0,
    active: false,
  });
  const [scale, setScale] = useState(1);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    const bridge = window.drawbridge;
    if (!bridge) return;
    let active = true;
    void bridge.readUpdateStatus().then(status => { if (active && status) setUpdate(status); });
    const stop = bridge.onUpdateStatus(status => { if (active) setUpdate(status); });
    return () => { active = false; stop(); };
  }, []);

  useEffect(() => {
    const fitCanvas = () => {
      setScale(Math.min(window.innerWidth / 1440, window.innerHeight / 1024));
    };
    fitCanvas();
    window.addEventListener("resize", fitCanvas);
    return () => window.removeEventListener("resize", fitCanvas);
  }, []);

  const showScreen = useCallback((destination: Screen) => {
    setScreen(destination);
  }, []);

  const navigateTo = useCallback(
    (destination: Screen) => {
      if (destination === "home") setHomePanel("home");
      if (destination === screen) return;
      const from = toolbarOffsets[screen];
      const to = toolbarOffsets[destination];
      setToolbarMotion({
        from,
        to,
        overshoot: to + (to > from ? 7 : -7),
        tailOffset: to > from ? -20 : 20,
        active: true,
      });
      showScreen(destination);
    },
    [screen, showScreen],
  );

  return (
    <main className="drawbridge-viewport">
      <div className="drawbridge-backdrop" aria-hidden="true">
        <img className="drawbridge-bridge" src="./assets/home/0687b.svg" alt="" />
      </div>
      <div
        className={`drawbridge-canvas ${toolbarMotion.active ? "toolbar-liquid-active" : ""}`}
        style={
          {
            transform: `translate(-50%, -50%) scale(${scale})`,
            "--toolbar-from": `${toolbarMotion.from}px`,
            "--toolbar-to": `${toolbarMotion.to}px`,
            "--toolbar-overshoot": `${toolbarMotion.overshoot}px`,
            "--toolbar-tail-offset": `${toolbarMotion.tailOffset}px`,
          } as CSSProperties
        }
      >
        <div className="screen-transition" key={screen + (screen === "home" ? "-" + homePanel : "")}>
          {screen === "home" ? homePanel === "projects" ? <ProjectsScreen
            onOpenProject={project => { setSelectedProject(project); navigateTo("history"); }}
            onOpenHistory={() => { setSelectedProject(null); navigateTo("history"); }}
          /> : homePanel === "settings" ? <SettingsScreen /> : <HomeScreen /> : screen === "history" ? <HistoryScreen
            key={selectedProject?.id ?? "all"}
            project={selectedProject}
            onProjectChange={setSelectedProject}
          /> : screen === "growth" ? <GrowthScreen /> : <MapAllScreen />}
        </div>
        {screen === "home" && (
          <>
            <button className="home-projects-control live-button" onClick={() => setHomePanel(value => value === "projects" ? "home" : "projects")} type="button">
              {homePanel === "projects" ? "Back to Home" : "Browse projects"}
            </button>
            <button className="home-settings-control live-button" onClick={() => setHomePanel(value => value === "settings" ? "home" : "settings")} type="button">
              {homePanel === "settings" ? "Back to Home" : "Settings"}
            </button>
          </>
        )}
        <nav aria-label="DrawBridge">
          {navItems.map((item) => (
            <button
              aria-current={screen === item.screen ? "page" : undefined}
              aria-label={item.label}
              className="nav-hit-target interactive-control"
              key={item.screen}
              onClick={() => navigateTo(item.screen)}
              style={{ top: item.top }}
              type="button"
            />
          ))}
        </nav>
      </div>
      {update && (
        <UpdateBanner
          onRestart={() => {
            void window.drawbridge?.installUpdate().then(result => {
              if (!result.ok) setUpdate({ phase: "error", version: update.version, message: result.error });
            });
          }}
          status={update}
        />
      )}
    </main>
  );
}
