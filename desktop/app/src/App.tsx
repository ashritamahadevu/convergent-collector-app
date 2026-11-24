import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import GrowthScreen from "./screens/GrowthScreen";
import HistoryScreen from "./screens/HistoryScreen";
import HomeScreen from "./screens/HomeScreen";
import MapAllScreen from "./screens/MapAllScreen";

type Screen = "home" | "history" | "growth" | "map";
type MapFilter = "all" | "review" | "strong";
type GrowthView = "summary" | "topics";

type MapFile = {
  name: string;
  x: number;
  y: number;
  icon: string;
  score: number;
  weakPoint: string;
  linkedFiles: string;
};

const screens = {
  home: HomeScreen,
  history: HistoryScreen,
  growth: GrowthScreen,
} satisfies Record<Exclude<Screen, "map">, React.ComponentType>;

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

const growthWeeks = [
  { week: "Oct 5", score: 30 },
  { week: "Oct 12", score: 40 },
  { week: "Oct 19", score: 44 },
  { week: "Oct 26", score: 49 },
  { week: "Nov 2", score: 54 },
  { week: "Nov 9", score: 47 },
];

const mapFiles: MapFile[] = [
  {
    name: "malloc.c",
    x: 587,
    y: 432,
    icon: "de7c3.svg",
    score: 45,
    weakPoint: "Coalescing free blocks",
    linkedFiles: "mm.c · free_list.c · realloc.c",
  },
  {
    name: "mm.c",
    x: 695,
    y: 495,
    icon: "b0c00.svg",
    score: 52,
    weakPoint: "Pointer arithmetic",
    linkedFiles: "malloc.c · mm.h · free_list.c",
  },
  {
    name: "free_list.c",
    x: 695,
    y: 620,
    icon: "c7809.svg",
    score: 48,
    weakPoint: "Segregated free lists",
    linkedFiles: "coalesce.c · split_block.c · malloc.c",
  },
  {
    name: "heap.c",
    x: 587,
    y: 682,
    icon: "d83a2.svg",
    score: 58,
    weakPoint: "Heap alignment",
    linkedFiles: "memlib.c · sbrk_wrap.c · mm.c",
  },
  {
    name: "utils.c",
    x: 479,
    y: 620,
    icon: "adda2.svg",
    score: 61,
    weakPoint: "Pointer arithmetic",
    linkedFiles: "main.c · heap.c · config.h",
  },
  {
    name: "main.c",
    x: 479,
    y: 495,
    icon: "c8b71.svg",
    score: 55,
    weakPoint: "Coalescing free blocks",
    linkedFiles: "mm.c · utils.c · driver.c",
  },
  {
    name: "realloc.c",
    x: 517,
    y: 312,
    icon: "9c188.svg",
    score: 42,
    weakPoint: "Pointer arithmetic",
    linkedFiles: "malloc.c · free_list.c · coalesce.c",
  },
  {
    name: "calloc.c",
    x: 660,
    y: 302,
    icon: "04a72.svg",
    score: 64,
    weakPoint: "None",
    linkedFiles: "malloc.c · mm.c · utils.c",
  },
  {
    name: "checkheap.c",
    x: 759,
    y: 379,
    icon: "f2383.svg",
    score: 57,
    weakPoint: "Heap alignment",
    linkedFiles: "heap.c · mm.c · free_list.c",
  },
  {
    name: "mm.h",
    x: 840,
    y: 494,
    icon: "84821.svg",
    score: 68,
    weakPoint: "None",
    linkedFiles: "mm.c · main.c · driver.c",
  },
  {
    name: "coalesce.c",
    x: 823,
    y: 616,
    icon: "9c69c.svg",
    score: 22,
    weakPoint: "Coalescing free blocks",
    linkedFiles: "free_list.c · split_block.c · realloc.c",
  },
  {
    name: "split_block.c",
    x: 770,
    y: 746,
    icon: "347f8.svg",
    score: 35,
    weakPoint: "Segregated free lists",
    linkedFiles: "free_list.c · coalesce.c · malloc.c",
  },
  {
    name: "list.h",
    x: 689,
    y: 786,
    icon: "541e3.svg",
    score: 66,
    weakPoint: "None",
    linkedFiles: "free_list.c · mm.c · heap.c",
  },
  {
    name: "sbrk_wrap.c",
    x: 587,
    y: 824,
    icon: "17eba.svg",
    score: 63,
    weakPoint: "None",
    linkedFiles: "memlib.c · heap.c · mm.c",
  },
  {
    name: "memlib.c",
    x: 486,
    y: 785,
    icon: "c7a2a.svg",
    score: 59,
    weakPoint: "Heap alignment",
    linkedFiles: "sbrk_wrap.c · heap.c · mm.c",
  },
  {
    name: "align.h",
    x: 407,
    y: 743,
    icon: "d57af.svg",
    score: 62,
    weakPoint: "Heap alignment",
    linkedFiles: "config.h · utils.c · heap.c",
  },
  {
    name: "config.h",
    x: 349,
    y: 616,
    icon: "1d946.svg",
    score: 0,
    weakPoint: "None",
    linkedFiles: "free_list.c · split_block.c · realloc.c",
  },
  {
    name: "tracefile.c",
    x: 324,
    y: 529,
    icon: "0920c.svg",
    score: 30,
    weakPoint: "Pointer arithmetic",
    linkedFiles: "driver.c · errors.c · main.c",
  },
  {
    name: "driver.c",
    x: 368,
    y: 431,
    icon: "6b3cd.svg",
    score: 49,
    weakPoint: "Pointer arithmetic",
    linkedFiles: "main.c · tracefile.c · errors.c",
  },
  {
    name: "errors.c",
    x: 433,
    y: 345,
    icon: "f9703.svg",
    score: 47,
    weakPoint: "None",
    linkedFiles: "driver.c · tracefile.c · config.h",
  },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>("history");
  const [toolbarMotion, setToolbarMotion] = useState({
    from: 131,
    to: 131,
    overshoot: 0,
    tailOffset: 0,
    active: false,
  });
  const [mapFilter, setMapFilter] = useState<MapFilter>("all");
  const [selectedMapFile, setSelectedMapFile] = useState("coalesce.c");
  const [mapSelectionChanged, setMapSelectionChanged] = useState(false);
  const [growthHover, setGrowthHover] = useState<number | null>(null);
  const [growthView, setGrowthView] = useState<GrowthView>("summary");
  const [scale, setScale] = useState(1);

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
    if (destination === "map") {
      setMapFilter("all");
      setSelectedMapFile("coalesce.c");
      setMapSelectionChanged(false);
    }
    if (destination === "growth") setGrowthView("summary");
  }, []);

  const navigateTo = useCallback(
    (destination: Screen) => {
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

  const ScreenComponent = screen === "map" ? MapAllScreen : screens[screen];
  const selectedFile = mapFiles.find((file) => file.name === selectedMapFile) ?? mapFiles[10];
  const selectMapFilter = (filter: MapFilter) => {
    setMapFilter(filter);
    setSelectedMapFile(filter === "strong" ? "config.h" : "coalesce.c");
    setMapSelectionChanged(filter !== "all");
  };
  const setMapNodeHovered = (name: string, hovered: boolean) => {
    const node = document.querySelector(`.map-screen [data-name="file-${name}"]`);
    node?.classList.toggle("map-node-hovered", hovered);
  };

  return (
    <main className="drawbridge-viewport">
      <div
        className={`drawbridge-canvas ${toolbarMotion.active ? "toolbar-liquid-active" : ""} ${
          screen === "map"
            ? `map-live-filters map-filter-${mapFilter} ${mapSelectionChanged ? "map-selection-active" : ""}`
            : screen === "growth"
              ? `growth-view-${growthView}`
              : ""
        }`}
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
        <div className="screen-transition" key={screen}>
          <ScreenComponent />
        </div>
        {screen !== "history" && <div className="prototype-banner" role="status">Design prototype · Sample data · Only History is connected to your saved checks.</div>}
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
        {screen === "growth" && (
          <>
            <div aria-label="Growth views" role="tablist">
              <button
                aria-selected={growthView === "summary"}
                className="growth-view-tab growth-summary-tab interactive-control"
                onClick={() => setGrowthView("summary")}
                role="tab"
                type="button"
              >
                Summary
              </button>
              <button
                aria-controls="growth-topics-panel"
                aria-selected={growthView === "topics"}
                className="growth-view-tab growth-topics-tab interactive-control"
                onClick={() => setGrowthView("topics")}
                role="tab"
                type="button"
              >
                Topics
              </button>
            </div>
            {growthView === "topics" && (
              <section
                aria-label="Correct answer by weak point"
                className="growth-topics-panel"
                id="growth-topics-panel"
                role="tabpanel"
              >
                <div className="growth-topic-breakdown">
                  <h2>Correct answer by weak point</h2>
                  <div className="growth-topic-row">
                    <span>Coalescing free blocks</span>
                    <img alt="" src="./assets/growth/f277b.svg" />
                    <strong>30%</strong>
                  </div>
                  <div className="growth-topic-row">
                    <span>Segregated free lists</span>
                    <img alt="" src="./assets/growth/95656.svg" />
                    <strong>55%</strong>
                  </div>
                  <div className="growth-topic-row">
                    <span>Pointer arithmetic</span>
                    <img alt="" src="./assets/growth/117a4.svg" />
                    <strong>45%</strong>
                  </div>
                </div>
                <aside className="growth-topic-goal">
                  <h2>Weekly goal</h2>
                  <p>Raise your comprehension score to 80%</p>
                  <button
                    className="interactive-control"
                    onClick={() => navigateTo("history")}
                    type="button"
                  >
                    See past checks
                  </button>
                </aside>
              </section>
            )}
            <div aria-label="Weekly chart columns" role="group">
              {growthWeeks.map((item, index) => (
                <button
                  aria-label={`${item.week}: ${item.score}%`}
                  className="chart-column-hit-target interactive-control"
                  key={item.week}
                  onBlur={() => setGrowthHover(null)}
                  onFocus={() => setGrowthHover(index)}
                  onMouseEnter={() => setGrowthHover(index)}
                  onMouseLeave={() => setGrowthHover(null)}
                  style={{ left: 267 + index * 163 }}
                  type="button"
                />
              ))}
              {growthHover !== null && (
                <div
                  className="chart-tooltip"
                  role="tooltip"
                  style={{ left: 285 + growthHover * 163 }}
                >
                  <span>{growthWeeks[growthHover].week}</span>
                  <strong>{growthWeeks[growthHover].score}%</strong>
                </div>
              )}
            </div>
          </>
        )}
        {screen === "map" && (
          <>
            <div aria-label="Map filters" role="group">
              <button
                aria-pressed={mapFilter === "all"}
                aria-label="All files"
                className={`map-filter-hit-target map-filter-visible interactive-control ${
                  mapFilter === "all" ? "map-filter-visible-active" : ""
                }`}
                onClick={() => selectMapFilter("all")}
                style={{ left: 207, width: 94 }}
                type="button"
              >
                All Files
              </button>
              <button
                aria-pressed={mapFilter === "review"}
                aria-label="Needs review"
                className={`map-filter-hit-target map-filter-visible interactive-control ${
                  mapFilter === "review" ? "map-filter-visible-active" : ""
                }`}
                onClick={() => selectMapFilter("review")}
                style={{ left: 317, width: 148 }}
                type="button"
              >
                Needs Review
              </button>
              <button
                aria-pressed={mapFilter === "strong"}
                aria-label="Strong"
                className={`map-filter-hit-target map-filter-visible interactive-control ${
                  mapFilter === "strong" ? "map-filter-visible-active" : ""
                }`}
                onClick={() => selectMapFilter("strong")}
                style={{ left: 481, width: 94 }}
                type="button"
              >
                Strong
              </button>
            </div>
            <div aria-label="Files" role="group">
              {mapFiles.map((file) => (
                <button
                  aria-label={file.name}
                  aria-pressed={file.name === selectedMapFile}
                  className="map-file-hit-target interactive-control"
                  key={file.name}
                  onBlur={() => setMapNodeHovered(file.name, false)}
                  onClick={() => {
                    setSelectedMapFile(file.name);
                    setMapSelectionChanged(true);
                  }}
                  onFocus={() => setMapNodeHovered(file.name, true)}
                  onMouseEnter={() => setMapNodeHovered(file.name, true)}
                  onMouseLeave={() => setMapNodeHovered(file.name, false)}
                  style={{ left: file.x - 26, top: file.y - 26 }}
                  type="button"
                />
              ))}
            </div>
            {mapSelectionChanged && (
              <>
                <div
                  aria-hidden="true"
                  className="map-selection-ring"
                  style={{ left: selectedFile.x - 25, top: selectedFile.y - 25 }}
                >
                  <img alt="" src={`./assets/map-all/${selectedFile.icon}`} />
                </div>
                <section aria-label="Selected file" className="selected-file-panel">
                  <h2>Selected File</h2>
                  <img
                    alt=""
                    className="selected-file-icon"
                    src={`./assets/map-all/${selectedFile.icon}`}
                  />
                  <p className="selected-file-name">{selectedFile.name}</p>
                  <p className="selected-file-weak">Weak point: {selectedFile.weakPoint}</p>
                  <p className="selected-file-score">{selectedFile.score}%</p>
                  <p className="selected-file-status">
                    {selectedFile.score >= 50 ? "Strong" : "Needs review"}
                  </p>
                  <p className="selected-file-linked-label">Linked files</p>
                  <p className="selected-file-linked">{selectedFile.linkedFiles}</p>
                  <button className="selected-file-action interactive-control" type="button">
                    {selectedFile.name === "config.h" ? "Check needs review" : "Review this file"}
                  </button>
                </section>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
