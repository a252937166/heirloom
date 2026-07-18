import { useState } from "react";

export function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="mono" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1200); }); }}
      style={{ background: "none", border: "1px solid var(--line)", borderRadius: 6, color: ok ? "var(--verdant)" : "var(--mist-2)", fontSize: "0.62rem", padding: "2px 7px", cursor: "pointer" }}>
      {ok ? "copied" : "copy"}
    </button>
  );
}
