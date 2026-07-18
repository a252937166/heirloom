// The official Flare logomark — used wherever the copy says "Flare", so the
// load-bearing network is visible at a glance (brand red #E62058).
import flare from "../assets/flare.svg";

export function FlareMark({ size = 15, text = true, style }: {
  size?: number;
  text?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.4), verticalAlign: "-0.14em", ...style }}>
      <img src={flare} alt="Flare" style={{ width: size, height: size, display: "block" }} />
      {text && <span style={{ fontWeight: 600, color: "var(--paper)", textTransform: "none", letterSpacing: "0.01em" }}>Flare</span>}
    </span>
  );
}
