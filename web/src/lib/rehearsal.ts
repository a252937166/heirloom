// Rehearsal session — the Recovery Kit's "rehearse the claim once, together,
// today" turned into a first-class, self-serve flow. Everything verifiable is
// verified against chain/keeper truth (never a bare checkbox), progress
// survives reloads, and the outcome is a downloadable receipt a tester can
// hand back — the evidence behind "N pairs completed the drill unassisted".
export const REHEARSAL_STEPS = [
  "wallet", // owner: get a testnet wallet ready (or choose the manual path)
  "create", // owner: create the plan (vault exists on-chain)
  "fund", // owner: one XRPL payment → vault Active (chain-verified)
  "heartbeat", // owner: first heartbeat proven (chain-verified, epoch ≥ 1)
  "handover", // owner → beneficiary: Recovery Kit delivered (self-attested)
  "drill", // beneficiary: early-claim drill blocked on-chain (event-verified)
  "debrief", // both: three honest-model questions (recorded, never gated)
] as const;
export type StepId = (typeof REHEARSAL_STEPS)[number];

export interface StepState {
  doneAt: number; // unix seconds
  evidence?: string; // tx hash / vault address / event ref — whatever proved it
}

export interface RehearsalSession {
  v: 1; // schema version — bump on breaking change, older sessions restart
  runId: string;
  startedAt: number;
  vault?: string; // set once the plan exists; verification anchors to it
  mode?: "gemwallet" | "manual";
  steps: Partial<Record<StepId, StepState>>;
  answers?: Record<string, string>; // debrief answers, recorded verbatim
}

const KEY = "heirloom.rehearsal.v1";

export function loadSession(): RehearsalSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as RehearsalSession;
    if (s.v !== 1 || !s.runId) return null; // unknown schema — treat as absent
    return s;
  } catch {
    return null;
  }
}

export function newSession(): RehearsalSession {
  const s: RehearsalSession = {
    v: 1,
    runId: `rh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: Math.floor(Date.now() / 1000),
    steps: {},
  };
  saveSession(s);
  return s;
}

export function saveSession(s: RehearsalSession) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode — flow still works, just无法续跑 */ }
}

export function clearSession() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function markDone(s: RehearsalSession, id: StepId, evidence?: string): RehearsalSession {
  if (s.steps[id]) return s; // first completion wins — timings stay honest
  const next = { ...s, steps: { ...s.steps, [id]: { doneAt: Math.floor(Date.now() / 1000), ...(evidence ? { evidence } : {}) } } };
  saveSession(next);
  return next;
}

export const stepIndex = (id: StepId) => REHEARSAL_STEPS.indexOf(id);
export const firstOpenStep = (s: RehearsalSession): StepId | null =>
  REHEARSAL_STEPS.find((id) => !s.steps[id]) ?? null;
export const doneCount = (s: RehearsalSession) => REHEARSAL_STEPS.filter((id) => s.steps[id]).length;

// The receipt is deliberately boring JSON: run identity, per-step timestamps
// and evidence, total wall-clock, and the debrief answers — nothing private.
export function buildReceipt(s: RehearsalSession) {
  const done = REHEARSAL_STEPS.filter((id) => s.steps[id]);
  const last = Math.max(s.startedAt, ...done.map((id) => s.steps[id]!.doneAt));
  return {
    kind: "heirloom-rehearsal-receipt",
    runId: s.runId,
    vault: s.vault ?? null,
    mode: s.mode ?? null,
    startedAt: s.startedAt,
    completedAt: done.length === REHEARSAL_STEPS.length ? last : null,
    totalSeconds: last - s.startedAt,
    steps: Object.fromEntries(done.map((id) => [id, s.steps[id]])),
    answers: s.answers ?? {},
    build: __BUILD_SHA__,
  };
}
