import { describe, expect, it } from "vitest";
import { classifyRun, drillSatisfies, heartbeatSatisfies } from "./rehearsal";

// The receipt's whole worth is that its verdicts cannot be faked from the
// client. These tests pin the semantics an external review caught us being
// loose about: a friendly "blocked" on a settled plan must never complete
// the safety drill, and history must never masquerade as this run's work.

const run = { runId: "rh-test-1", startedAt: 1_000 };
const blockedLabel = "Early-claim drill: blocked on-chain (SilenceNotProven) — funds moved: 0";

describe("drillSatisfies — Active plan + SilenceNotProven + this run, or nothing", () => {
  it("passes on an Active plan refused with SilenceNotProven after the run started", () => {
    expect(drillSatisfies({ kind: "drill", at: 2_000, label: blockedLabel, vaultState: 2, reason: "SilenceNotProven" }, run)).toBe(true);
  });
  it("passes when tagged for exactly this run", () => {
    expect(drillSatisfies({ kind: "drill", at: 2_000, label: blockedLabel, vaultState: 2, reason: "SilenceNotProven", rh: "rh-test-1" }, run)).toBe(true);
  });
  it("fails on a Released plan even with a friendly blocked sentence", () => {
    expect(drillSatisfies({ kind: "drill", at: 2_000, label: "Early-claim drill: blocked — this plan already paid its beneficiary (funds moved: 0)", vaultState: 5, reason: "BadState" }, run)).toBe(false);
  });
  it("fails on a Cancelled plan", () => {
    expect(drillSatisfies({ kind: "drill", at: 2_000, label: blockedLabel, vaultState: 6, reason: "BadState" }, run)).toBe(false);
  });
  it("fails on a Cancelling plan — funds still moving is not settled and not a drill", () => {
    expect(drillSatisfies({ kind: "drill", at: 2_000, label: blockedLabel, vaultState: 7, reason: "BadState" }, run)).toBe(false);
  });
  it("fails when the refusal reason is right but the plan is not Active", () => {
    expect(drillSatisfies({ kind: "drill", at: 2_000, label: blockedLabel, vaultState: 3, reason: "SilenceNotProven" }, run)).toBe(false);
  });
  it("fails when the event predates the run", () => {
    expect(drillSatisfies({ kind: "drill", at: 500, label: blockedLabel, vaultState: 2, reason: "SilenceNotProven" }, run)).toBe(false);
  });
  it("fails when tagged for a different run", () => {
    expect(drillSatisfies({ kind: "drill", at: 2_000, label: blockedLabel, vaultState: 2, reason: "SilenceNotProven", rh: "rh-other-run" }, run)).toBe(false);
  });
  it("fails for legacy label-only events without structured fields", () => {
    expect(drillSatisfies({ kind: "drill", at: 2_000, label: blockedLabel }, run)).toBe(false);
  });
  it("ignores non-drill events entirely", () => {
    expect(drillSatisfies({ kind: "silence", at: 2_000, label: blockedLabel, vaultState: 2, reason: "SilenceNotProven" }, run)).toBe(false);
  });
});

describe("classifyRun — a plan created after the run sheet started is this run's own work", () => {
  it("fresh when created at/after the run start", () => {
    expect(classifyRun(1_000, 1_000)).toBe("fresh-plan");
    expect(classifyRun(1_500, 1_000)).toBe("fresh-plan");
  });
  it("existing when it predates the run", () => {
    expect(classifyRun(999, 1_000)).toBe("existing-plan");
  });
});

describe("heartbeatSatisfies — history alone earns nothing on an existing plan", () => {
  it("fresh plan: the first proven epoch counts", () => {
    expect(heartbeatSatisfies(1, "fresh-plan", 0)).toBe(true);
    expect(heartbeatSatisfies(0, "fresh-plan", 0)).toBe(false);
  });
  it("existing plan: the epoch must grow during the rehearsal", () => {
    expect(heartbeatSatisfies(1, "existing-plan", 1)).toBe(false);
    expect(heartbeatSatisfies(2, "existing-plan", 1)).toBe(true);
    expect(heartbeatSatisfies(0, "existing-plan", 0)).toBe(false);
  });
});
