type ToolbarItem = "home" | "history" | "growth" | "map";

const items: Array<{ id: ToolbarItem; top: number }> = [
  { id: "home", top: 0 },
  { id: "history", top: 131 },
  { id: "growth", top: 263 },
  { id: "map", top: 393 },
];

function ToolbarIcon({ item, active }: { item: ToolbarItem; active: boolean }) {
  if (item === "map" && active) {
    return (
      <span className="toolbar-map-active">
        <img alt="" src="./assets/toolbar/map-active-left.svg" />
        <img alt="" src="./assets/toolbar/map-active-right.svg" />
      </span>
    );
  }

  return <img alt="" src={`./assets/toolbar/${item}-${active ? "active" : "light"}.svg`} />;
}

export default function Toolbar({ active }: { active: ToolbarItem }) {
  return (
    <div className="drawbridge-toolbar" aria-hidden="true">
      <span
        className="toolbar-active-pill"
        style={{ top: items.find((item) => item.id === active)?.top }}
      >
        <span className="toolbar-liquid-core" />
      </span>
      {items.map((item) => (
        <span
          className={`toolbar-icon-slot ${item.id === active ? "toolbar-icon-slot-active" : ""}`}
          key={item.id}
          style={{ top: item.top }}
        >
          <ToolbarIcon active={item.id === active} item={item.id} />
        </span>
      ))}
    </div>
  );
}
