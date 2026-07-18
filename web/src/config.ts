export const CONFIG = {
  chainId: 114,
  rpc: "https://coston2-api.flare.network/ext/C/rpc",
  explorer: "https://coston2-explorer.flare.network",
  xrplExplorer: "https://testnet.xrpl.org",
  factory: "0xa1b97724E7447278ed749f57CEa1915Ad2C3AFA2",
  implementation: "0x64eFCB1E2c3efC7868b645f9b3c6F99f6006a0d6",
  fxrp: "0x0b6A3645c240605887a5532109323A3E12273dc7",
  assetManager: "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA",
  coreVaultXrpl: "rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p",
  beacon: "r4vEYPxYkEWzoEySUETDRgnUKu8GG9b1GN",
  lotSizeUBA: 10_000_000n,
  api: "/api",
  demo: { heartbeatPeriod: 240, grace: 60, challenge: 120 },
  storyVault: "0x5655FED767c4315218393c5501c3624917a9BaEB",
  // Maya's wallet from the case study — a safe default beneficiary for people
  // who are just exploring (payouts to it are visible on the public explorer)
  demoBeneficiary: "rKZo43bi3Vt5ba9gKzUbzMGx4tXV9NUXpq",
  github: "https://github.com/a252937166/heirloom",
  faucet: "https://faucet.flare.network/coston2",
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
