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
  const payoutConfirmed = !!receipt?.settlements?.length || events.some((e) => e.kind === "settled");
  return { payoutConfirmed, awaiting: receipt?.awaitingSettlement ?? [] };
}
