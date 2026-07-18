// The signature element of the reskin: circular icon nodes joined by a line —
// green = done, orange ✕ = the attack that failed, blue = where you are.
export interface NodeItem {
  icon?: string;
  label: string;
  sub?: string;
  state?: "done" | "fail" | "active" | "todo";
  onClick?: () => void;
}

const COLOR: Record<string, string> = {
  done: "var(--verdant)",
  fail: "var(--ember)",
  active: "var(--lamplight)",
  todo: "var(--mist-2)",
};

export function NodeStepper({ items, size = 40 }: { items: NodeItem[]; size?: number }) {
  return (
    <div className="node-row" style={{ display: "flex", alignItems: "flex-start", overflowX: "auto", padding: "2px 0" }}>
      {items.map((it, i) => {
        const st = it.state ?? "todo";
        const c = COLOR[st];
        return (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", flex: i < items.length - 1 ? "1 1 0" : "0 0 auto", minWidth: 0 }}>
            <div onClick={it.onClick} role={it.onClick ? "button" : undefined}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, cursor: it.onClick ? "pointer" : "default", minWidth: size + 16 }}>
              <span style={{
                width: size, height: size, borderRadius: "50%", display: "grid", placeItems: "center",
                fontSize: size * 0.38, fontWeight: 700, color: c,
                border: `1.6px solid ${c}`,
                background: `color-mix(in srgb, ${c} ${st === "active" ? 18 : 10}%, transparent)`,
                boxShadow: st === "active" ? `0 0 16px color-mix(in srgb, ${c} 40%, transparent)` : st === "done" ? `0 0 10px color-mix(in srgb, ${c} 18%, transparent)` : undefined,
                transition: "box-shadow .15s",
              }}>
                {it.icon ?? (st === "done" ? "✓" : st === "fail" ? "✕" : "•")}
              </span>
              <span style={{ textAlign: "center", lineHeight: 1.3 }}>
                <span style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: st === "todo" ? "var(--mist-2)" : "var(--paper)", whiteSpace: "nowrap" }}>{it.label}</span>
                {it.sub && <span className="mono" style={{ display: "block", fontSize: "0.58rem", color: "var(--mist-2)", whiteSpace: "nowrap", marginTop: 2 }}>{it.sub}</span>}
              </span>
            </div>
            {i < items.length - 1 && (
              <span style={{ flex: 1, height: 1.6, minWidth: 14, background: `linear-gradient(90deg, ${c}55, var(--line))`, marginTop: size / 2 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
