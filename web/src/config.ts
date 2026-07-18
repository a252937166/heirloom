export const CONFIG = {
  chainId: 114,
  rpc: "https://coston2-api.flare.network/ext/C/rpc",
  explorer: "https://coston2-explorer.flare.network",
  xrplExplorer: "https://testnet.xrpl.org",
  factory: "0x83c447F9FC7703801e6582d36df24718dD3C9AE1",
  implementation: "0x6849Db087A2d31b4Da523a64b752d270e1a6bEf8",
  fxrp: "0x0b6A3645c240605887a5532109323A3E12273dc7",
  assetManager: "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA",
  coreVaultXrpl: "rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p",
  beacon: "r4vEYPxYkEWzoEySUETDRgnUKu8GG9b1GN",
  lotSizeUBA: 10_000_000n,
  api: "/api",
  demo: { heartbeatPeriod: 240, grace: 60, challenge: 120 },
  storyVault: "0x5655FED767c4315218393c5501c3624917a9BaEB",
} as const;

export const STATE_NAMES = [
  "Uninitialized",
  "Awaiting funding",
  "Active",
  "Claim pending",
  "Releasing",
  "Released",
  "Cancelled",
] as const;
