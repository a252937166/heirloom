// The signature dial, reskinned to the reference mock: a thick multi-segment
// ring (green while safe, orange as the deadline nears, orange in a challenge)
// with a violet heartbeat wave running through the center.
import { useEffect, useId, useState } from "react";
import { chainNow } from "../lib/time";

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  // fractions of the circle, starting at 12 o'clock, clockwise
  const a0 = 2 * Math.PI * from - Math.PI / 2;
  const a1 = 2 * Math.PI * to - Math.PI / 2;
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  const large = to - from > 0.5 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

export function PulseDial({
  size = 260,
  lastAliveTs,
  deadlineTs,
  state,
  label,
}: {
  size?: number;
  lastAliveTs: number; // unix
  deadlineTs: number;  // unix — end of period+grace (or challenge end)
  state: number;       // vault state
  label?: string;
}) {
  const [now, setNow] = useState(() => chainNow());
  useEffect(() => {
    const t = setInterval(() => setNow(chainNow()), 1000);
    return () => clearInterval(t);
  }, []);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const total = Math.max(1, deadlineTs - lastAliveTs);
  const elapsed = Math.min(total, Math.max(0, now - lastAliveTs));
  const frac = state >= 4 ? 1 : elapsed / total;
  const remaining = Math.max(0, deadlineTs - now);

  const cx = size / 2;
  const r = size / 2 - 12;
  const W = 9; // ring thickness
  const alive = state === 2 && remaining > 0;
  const challenge = state === 3;
  const settled = state === 5;            // green: value reached the beneficiary
  const cancelledDone = state === 6;      // neutral: returned to the owner
  const inFlight = state === 4 || state === 7; // amber: settlement in motion
  const AMBER_AT = 0.72; // the tail of the window renders orange

  const fmt = (s: number) => {
    if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
    if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${s}s`;
  };

  const greenTo = challenge ? 0 : Math.min(frac, AMBER_AT);
  const amberFrom = AMBER_AT;
  const amberTo = challenge ? frac : frac > AMBER_AT ? frac : AMBER_AT;
  const eps = 0.004;

  return (
    <div className="dial-wrap" style={{ width: size, height: size }} role="img"
      aria-label={`Inactivity dial: ${fmt(remaining)} until the ${challenge ? "challenge ends" : "silence deadline"}`}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id={`hl-green-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2fd674" />
            <stop offset="100%" stopColor="#8be04a" />
          </linearGradient>
          <linearGradient id={`hl-amber-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffb03c" />
            <stop offset="100%" stopColor="#ff8a3c" />
          </linearGradient>
        </defs>
        {/* track */}
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--line)" strokeWidth={W} opacity={0.55} />
        {/* settled: full green ring */}
        {settled && <circle cx={cx} cy={cx} r={r} fill="none" stroke={`url(#hl-green-${uid})`} strokeWidth={W} strokeLinecap="round" />}
        {/* cancelled: neutral full ring — completed, but no payout story */}
        {cancelledDone && <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--mist-2)" strokeWidth={W} strokeLinecap="round" opacity={0.7} />}
        {/* elapsed, safe part (green) */}
        {!settled && !cancelledDone && !inFlight && greenTo > eps && (
          <path d={arc(cx, cx, r, 0, greenTo)} fill="none" stroke={`url(#hl-green-${uid})`} strokeWidth={W} strokeLinecap="round" />
        )}
        {/* the tail of the window / challenge (orange) */}
        {!settled && !cancelledDone && !inFlight && (challenge ? frac > eps : frac > AMBER_AT) && (
          <path d={arc(cx, cx, r, challenge ? 0 : amberFrom, Math.max(amberTo, (challenge ? 0 : amberFrom) + eps))}
            fill="none" stroke={`url(#hl-amber-${uid})`} strokeWidth={W} strokeLinecap="round" />
        )}
        {/* in flight (releasing or cancelling): full amber */}
        {inFlight && <circle cx={cx} cy={cx} r={r} fill="none" stroke={`url(#hl-amber-${uid})`} strokeWidth={W} strokeLinecap="round" opacity={0.9} />}
        {/* alive ping */}
        {alive && <circle className="pulse-ping" cx={cx} cy={cx} r={r - 16} fill="none" stroke="var(--verdant)" strokeWidth={1.2} />}
        {challenge && <circle className="pulse-ping" cx={cx} cy={cx} r={r - 16} fill="none" stroke="var(--ember)" strokeWidth={1.4} />}
        {/* glowing tip at the end of the progress arc */}
        {!settled && state < 4 && frac > eps && (() => {
          const a = 2 * Math.PI * frac - Math.PI / 2;
          return <circle className="dial-tip" cx={cx + r * Math.cos(a)} cy={cx + r * Math.sin(a)} r={W / 2 + 1}
            fill={challenge || frac > AMBER_AT ? "#ffb03c" : "#6fe89a"} style={{ color: challenge || frac > AMBER_AT ? "#ffb03c" : "#6fe89a" }} />;
        })()}
        {/* heartbeat wave through the center */}
        <polyline
          className="ecg"
          points={`${cx - r * 0.55},${cx + r * 0.38} ${cx - r * 0.3},${cx + r * 0.38} ${cx - r * 0.2},${cx + r * 0.26} ${cx - r * 0.08},${cx + r * 0.5} ${cx + r * 0.02},${cx + r * 0.3} ${cx + r * 0.12},${cx + r * 0.38} ${cx + r * 0.55},${cx + r * 0.38}`}
          fill="none" stroke="var(--violet)" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round"
          strokeDasharray="110 110" opacity={0.85}
        />
      </svg>
      <div className="dial-center">
        <div className={settled || cancelledDone ? "big pop-in" : "big"} style={settled ? { color: "var(--verdant)" } : cancelledDone ? { color: "var(--mist)" } : undefined}>{state >= 4 ? (settled || cancelledDone ? "✓" : "…") : fmt(remaining)}</div>
        <div className="small">{label ?? (challenge ? "challenge window" : "until silence deadline")}</div>
      </div>
    </div>
  );
}
