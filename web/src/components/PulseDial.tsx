// The signature element: a ledger-ticked dial that fills as silence elapses
// and pulses while the owner is provably alive.
import { useEffect, useState } from "react";

export function PulseDial({
  size = 260,
  lastAliveTs,
  deadlineTs,
  state,
  label,
}: {
  size?: number;
  lastAliveTs: number; // unix
  deadlineTs: number; // unix — end of period+grace
  state: number; // vault state
  label?: string;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const total = Math.max(1, deadlineTs - lastAliveTs);
  const elapsed = Math.min(total, Math.max(0, now - lastAliveTs));
  const frac = state >= 4 ? 1 : elapsed / total;
  const remaining = Math.max(0, deadlineTs - now);

  const r = size / 2 - 14;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;
  const ticks = 48;
  const alive = state === 2 && remaining > 0;
  const color = state >= 4 ? "var(--ember)" : state === 3 ? "var(--ember)" : remaining > total * 0.25 ? "var(--verdant)" : "var(--lamplight)";

  const fmt = (s: number) => {
    if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
    if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${s}s`;
  };

  return (
    <div className="dial-wrap" style={{ width: size, height: size }} role="img"
      aria-label={`Inactivity dial: ${fmt(remaining)} until the silence deadline`}>
      <svg width={size} height={size}>
        {/* ledger ticks */}
        {Array.from({ length: ticks }, (_, i) => {
          const a = (i / ticks) * 2 * Math.PI - Math.PI / 2;
          const r1 = r + 6;
          const r2 = r + (i % 4 === 0 ? 12 : 9);
          return (
            <line
              key={i}
              x1={cx + r1 * Math.cos(a)} y1={cx + r1 * Math.sin(a)}
              x2={cx + r2 * Math.cos(a)} y2={cx + r2 * Math.sin(a)}
              stroke={i / ticks <= frac ? color : "var(--line)"}
              strokeWidth={1}
            />
          );
        })}
        {/* base ring */}
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--line)" strokeWidth={2} />
        {/* silence progress */}
        <circle
          cx={cx} cy={cx} r={r} fill="none"
          stroke={color} strokeWidth={2.5} strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
          transform={`rotate(-90 ${cx} ${cx})`}
          style={{ transition: "stroke-dashoffset 1s linear" }}
        />
        {/* alive pulse */}
        {alive && (
          <circle className="pulse-ping" cx={cx} cy={cx} r={r - 18} fill="none" stroke="var(--verdant)" strokeWidth={1.2} />
        )}
      </svg>
      <div className="dial-center">
        <div className="big">{state >= 4 ? "—" : fmt(remaining)}</div>
        <div className="small">{label ?? (state === 3 ? "challenge window" : "until silence deadline")}</div>
      </div>
    </div>
  );
}
