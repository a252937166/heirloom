// Cross-chain honesty: contract state 5 (Released) or 6 (Cancelled) means a
// redemption was REQUESTED — the underlying XRP payout is a separate, later
// fact, confirmed only when a settlement payment matching the redemption's
// payment reference lands on XRPL. The UI must never collapse the two.
export interface Receipt {
  redemptions: { requestId: string; paymentReference: string; valueUBA: string; feeUBA: string }[];
  settlements: { requestId: string; deliveredDrops: string; txXrpl: string; paymentReference: string }[];
  awaitingSettlement?: string[];
}

export interface SettlementView {
  payoutConfirmed: boolean;
  awaiting: string[];
}

export function deriveSettlement(receipt: Receipt | null, events: { kind: string }[]): SettlementView {
  // one redeemAmount can fan out into SEVERAL redemption requests (one per
  // agent), each settled by its own XRPL payment — "delivered" is only true
  // once EVERY request's payment reference has a matching settlement
  const redemptions = receipt?.redemptions ?? [];
  if (redemptions.length > 0) {
    const settled = new Set((receipt?.settlements ?? []).map((s) => s.paymentReference.toLowerCase()));
    const awaiting = [...new Set(redemptions.map((r) => r.paymentReference).filter((ref) => !settled.has(ref.toLowerCase())))];
    return { payoutConfirmed: awaiting.length === 0, awaiting };
  }
  // no per-request data (older vault meta or API gap) — fall back to event truth
  const payoutConfirmed = !!receipt?.settlements?.length || events.some((e) => e.kind === "settled");
  return { payoutConfirmed, awaiting: receipt?.awaitingSettlement ?? [] };
}
