/**
 * Illustrative vault state shown before a wallet is connected (or when
 * the connected wallet has no vault).
 *
 * The real dashboard uses `useVault()` + `useQuotes()` hooks and derives
 * the same shape from on-chain data. Keeping this mock around lets us
 * render a complete, compelling dashboard for demos and first-time
 * visitors without requiring wallet setup.
 */
export const MOCK_VAULT = {
  pair: "SOL / USDC",
  tvl: 1_250_000,
  apy: 12.4,
  sharePrice: 1.032,
  totalShares: 1_211_240,
  lastRebalance: 14,
  encryptedState: [
    "a3f2c1e847b9d06f5c8a3e27d14b096e",
    "7d91f3b2e8c40a1d6f95372c0e48d1ab",
    "5c6a0f82d39e71b4c28f5a0163e7d4b9",
    "2e8fc71d4a956b30e1c87f24d05a3c68",
    "9b4d62f8c1073e5a28d49b1f70c6e3a2",
  ],
  quotes: {
    bidPrice: 149.625,
    bidSize: 83.2,
    askPrice: 150.375,
    askSize: 10000,
    shouldRebalance: false,
    oraclePrice: 150.0,
    timestamp: 0, // filled at render time to avoid SSR drift
  },
  rebalanceHistory: [
    { time: "2m ago", bid: 149.625, ask: 150.375, rebalanced: false },
    { time: "3m ago", bid: 149.6, ask: 150.4, rebalanced: true },
    { time: "4m ago", bid: 149.55, ask: 150.45, rebalanced: false },
    { time: "5m ago", bid: 149.7, ask: 150.3, rebalanced: false },
    { time: "6m ago", bid: 149.4, ask: 150.6, rebalanced: true },
  ],
};

export type VaultDisplay = typeof MOCK_VAULT;
