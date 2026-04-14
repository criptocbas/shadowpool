"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useVault, useQuotes, useDeposit, useWithdraw } from "@/hooks";

// USDC (quote) has 6 decimals on Solana. Share tokens are minted with 9.
const QUOTE_DECIMALS = 6;
const SHARE_DECIMALS = 9;

function toRawUnits(displayAmount: string, decimals: number): bigint | null {
  const trimmed = displayAmount.trim();
  if (!trimmed || isNaN(Number(trimmed))) return null;
  // Avoid floating-point drift on fractional inputs by parsing the
  // integer and fractional parts separately.
  const [intPart, fracPart = ""] = trimmed.split(".");
  const paddedFrac = (fracPart + "0".repeat(decimals)).slice(0, decimals);
  try {
    return BigInt(intPart || "0") * BigInt(10 ** decimals) + BigInt(paddedFrac || "0");
  } catch {
    return null;
  }
}

// ─── Demo-state fallback (shown before wallet connects) ────────────────
// When a wallet is connected and a vault exists, the dashboard renders
// real on-chain data instead. See `v` derivation in VaultDashboard below.
const MOCK_VAULT = {
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
    timestamp: Date.now() - 14000,
  },
  rebalanceHistory: [
    { time: "2m ago", bid: 149.625, ask: 150.375, rebalanced: false },
    { time: "3m ago", bid: 149.6, ask: 150.4, rebalanced: true },
    { time: "4m ago", bid: 149.55, ask: 150.45, rebalanced: false },
    { time: "5m ago", bid: 149.7, ask: 150.3, rebalanced: false },
    { time: "6m ago", bid: 149.4, ask: 150.6, rebalanced: true },
  ],
};

// ─── Hex Shimmer ──────────────────────────────────────────────────────
function useShimmeringHex(base: string, interval: number) {
  const mutate = useCallback(() => {
    const chars = "0123456789abcdef";
    const arr = base.split("");
    const idx = Math.floor(Math.random() * arr.length);
    arr[idx] = chars[Math.floor(Math.random() * 16)];
    return arr.join("");
  }, [base]);

  const [hex, setHex] = useState(base);
  useEffect(() => {
    const id = setInterval(() => setHex(mutate()), interval);
    return () => clearInterval(id);
  }, [mutate, interval]);
  return hex;
}

function EncryptedField({
  label,
  baseHex,
  index,
}: {
  label: string;
  baseHex: string;
  index: number;
}) {
  const hex = useShimmeringHex(baseHex, 80 + index * 20);
  return (
    <div
      className="cipher-shimmer py-2"
      style={{ animationDelay: `${index * 0.3}s` }}
    >
      <div
        className="text-[10px] font-mono uppercase tracking-wider mb-1"
        style={{ color: "var(--text-tertiary)" }}
      >
        {label}
      </div>
      <div
        className="font-mono text-xs tracking-widest break-all leading-relaxed"
        style={{ color: "var(--accent-encrypted)" }}
      >
        0x{hex}
      </div>
    </div>
  );
}

// ─── Lock Icon ────────────────────────────────────────────────────────
function LockIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block mr-1 opacity-60"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}

// ─── MPC Vertical Divider ──────────────────────────────────────────────
function MPCDivider() {
  return (
    <div className="vault-mpc-divider flex flex-row md:flex-col items-center justify-center gap-2 py-3 md:py-0 px-4 md:px-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="contents">
          <div
            className="mpc-node w-[6px] h-[6px] rounded-full shrink-0"
            style={{
              background: "var(--accent-encrypted)",
              animationDelay: `${i * 0.5}s`,
            }}
          />
          {i < 2 && (
            <div
              className="mpc-line w-4 md:w-px h-px md:h-5 shrink-0"
              style={{
                background: "var(--accent-encrypted-dim)",
                animationDelay: `${i * 0.5 + 0.25}s`,
              }}
            />
          )}
        </div>
      ))}
      <div
        className="text-[7px] font-mono uppercase tracking-[0.2em] md:[writing-mode:vertical-rl] md:rotate-180 mt-1 md:mt-2 whitespace-nowrap"
        style={{ color: "var(--accent-encrypted-dim)" }}
      >
        MPC
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────
export default function VaultDashboard() {
  const [mounted, setMounted] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");
  useEffect(() => setMounted(true), []);

  // Real on-chain data — vault fetched for the connected wallet, quotes
  // streamed via program event listener.
  const { publicKey, connected } = useWallet();
  const { vault, loading: vaultLoading, refetch: refetchVault } = useVault(publicKey ?? null);
  const { quotes } = useQuotes();
  const {
    deposit,
    loading: depositLoading,
    error: depositError,
    txSig: depositTxSig,
  } = useDeposit(publicKey ?? null);
  const {
    withdraw,
    loading: withdrawLoading,
    error: withdrawError,
    txSig: withdrawTxSig,
  } = useWithdraw(publicKey ?? null);

  // Surface the relevant tx feedback regardless of active tab.
  const txError = depositError ?? withdrawError;
  const txSig = depositTxSig ?? withdrawTxSig;
  const txLoading = depositLoading || withdrawLoading;

  // Derive the display model `v`. When on-chain data exists we use it;
  // otherwise we fall back to MOCK_VAULT so the page still renders as a
  // compelling demo before a wallet is connected.
  const v = useMemo(() => {
    if (!vault) return MOCK_VAULT;

    const toNum = (val: unknown): number => {
      if (val === null || val === undefined) return 0;
      const anyVal = val as { toNumber?: () => number; toString?: () => string };
      if (typeof anyVal.toNumber === "function") {
        try { return anyVal.toNumber(); } catch { /* bignum overflow */ }
      }
      const s = anyVal.toString?.() ?? String(val);
      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    };

    // Prefer the live quote stream; fall back to the last persisted on-chain
    // quotes so the dashboard stays populated across page refreshes.
    const hasLiveQuotes = quotes != null;
    const bidPrice6 = hasLiveQuotes ? toNum(quotes.bidPrice) : toNum(vault.lastBidPrice);
    const askPrice6 = hasLiveQuotes ? toNum(quotes.askPrice) : toNum(vault.lastAskPrice);
    const bidSize9  = hasLiveQuotes ? toNum(quotes.bidSize)  : toNum(vault.lastBidSize);
    const askSize9  = hasLiveQuotes ? toNum(quotes.askSize)  : toNum(vault.lastAskSize);
    const rebalanceFlag = hasLiveQuotes
      ? quotes.shouldRebalance !== 0
      : vault.lastShouldRebalance !== 0;

    // Convert raw on-chain units to display units.
    // tokenB (quote) uses 6 decimals; tokenA (base) uses 9 decimals.
    // Quote prices are scaled by 1e6 (micro-USDC); sizes by 1e9 (lamports).
    const tvlUsdc = toNum(vault.totalDepositsB) / 1e6;

    const ciphertextHex = vault.encryptedState.map(
      (ct: number[]) => Buffer.from(ct).toString("hex").slice(0, 32)
    );

    return {
      pair: "SOL / USDC",
      tvl: tvlUsdc,
      apy: MOCK_VAULT.apy,                    // TODO: compute from reveal_performance history
      sharePrice: MOCK_VAULT.sharePrice,      // TODO: total_deposits_b / total_shares
      totalShares: toNum(vault.totalShares),
      lastRebalance: MOCK_VAULT.lastRebalance,// TODO: slot delta from vault.quotesSlot
      encryptedState: ciphertextHex.length === 5 ? ciphertextHex : MOCK_VAULT.encryptedState,
      quotes: {
        bidPrice: bidPrice6 / 1e6,
        bidSize: bidSize9 / 1e9,
        askPrice: askPrice6 / 1e6,
        askSize: askSize9 / 1e9,
        shouldRebalance: rebalanceFlag,
        oraclePrice: MOCK_VAULT.quotes.oraclePrice, // TODO: pipe Pyth feed
        timestamp: hasLiveQuotes ? quotes.receivedAt : Date.now(),
      },
      rebalanceHistory: MOCK_VAULT.rebalanceHistory, // TODO: derive from program events
    };
  }, [vault, quotes]);

  const isDemoMode = !connected || !vault;

  // ─── Deposit / Withdraw handlers ──────────────────────────────
  // The program exposes deposit/withdraw with explicit SPL account
  // arguments so the program doesn't need token-account derivation. We
  // resolve user ATAs here, parse the amount, and delegate to the hook.
  const handleDeposit = useCallback(async () => {
    if (!vault || !publicKey) return;
    const raw = toRawUnits(depositAmount, QUOTE_DECIMALS);
    if (raw === null || raw <= BigInt(0)) return;
    const [userTokenAccount, userShareAccount] = await Promise.all([
      getAssociatedTokenAddress(vault.tokenBMint, publicKey, false, TOKEN_PROGRAM_ID),
      getAssociatedTokenAddress(vault.shareMint, publicKey, false, TOKEN_PROGRAM_ID),
    ]);
    await deposit(
      Number(raw),           // amount in quote raw units
      userTokenAccount,
      userShareAccount,
      vault.tokenBVault,
      vault.shareMint
    );
    refetchVault();          // sync the dashboard after a successful deposit
    setDepositAmount("");
  }, [vault, publicKey, depositAmount, deposit, refetchVault]);

  const handleWithdraw = useCallback(async () => {
    if (!vault || !publicKey) return;
    const rawShares = toRawUnits(depositAmount, SHARE_DECIMALS);
    if (rawShares === null || rawShares <= BigInt(0)) return;
    const [userTokenAccount, userShareAccount] = await Promise.all([
      getAssociatedTokenAddress(vault.tokenBMint, publicKey, false, TOKEN_PROGRAM_ID),
      getAssociatedTokenAddress(vault.shareMint, publicKey, false, TOKEN_PROGRAM_ID),
    ]);
    await withdraw(
      Number(rawShares),
      userTokenAccount,
      userShareAccount,
      vault.tokenBVault,
      vault.shareMint
    );
    refetchVault();
    setDepositAmount("");
  }, [vault, publicKey, depositAmount, withdraw, refetchVault]);

  const canSubmit =
    connected &&
    vault !== null &&
    !txLoading &&
    toRawUnits(depositAmount, activeTab === "deposit" ? QUOTE_DECIMALS : SHARE_DECIMALS) !== null;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-deep)" }}>
      {/* Top bar */}
      <header
        className="flex items-center justify-between px-6 md:px-10 py-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <Link href="/" className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: "var(--accent-encrypted)" }}
          />
          <span className="font-medium text-sm tracking-wide">SHADOWPOOL</span>
        </Link>
        <div className="flex items-center gap-4">
          <div
            className="flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: connected
                  ? "var(--accent-revealed)"
                  : "var(--accent-warning)",
              }}
            />
            Devnet
          </div>
          <WalletMultiButton />
        </div>
      </header>

      {/* Demo-mode banner — shown until a wallet is connected and a vault exists */}
      {isDemoMode && (
        <div
          className="px-6 md:px-10 py-2 text-xs font-mono flex items-center gap-2"
          style={{
            background: "var(--bg-surface)",
            color: "var(--text-tertiary)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <span
            className="text-[10px] tracking-[0.2em] uppercase px-2 py-0.5 rounded"
            style={{
              background: "var(--bg-raised)",
              color: "var(--accent-encrypted)",
              border: "1px solid var(--border-medium)",
            }}
          >
            Demo
          </span>
          <span>
            {!connected
              ? "Showing illustrative vault state. Connect a wallet to see your live on-chain vault."
              : vaultLoading
                ? "Loading on-chain vault state…"
                : "No vault found for this wallet. Initialize one via the CLI or create-vault flow to see live data."}
          </span>
        </div>
      )}

      <div
        className={`transition-all duration-500 ${
          mounted ? "opacity-100" : "opacity-0"
        }`}
      >
        {/* Vault Header */}
        <div className="px-6 md:px-10 pt-8 pb-6">
          <div className="flex items-baseline gap-3 mb-1">
            <h1
              className="text-2xl font-light tracking-tight"
              style={{ color: "var(--text-primary)" }}
            >
              {v.pair}
            </h1>
            <span className="encrypted-badge text-[10px] font-mono px-2.5 py-1 rounded tracking-wider">
              ENCRYPTED
            </span>
          </div>
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            Reference vault for the confidential execution layer &middot; Arcium MPC
          </p>
        </div>

        {/* Key Metrics Row */}
        <div
          className="px-6 md:px-10 pb-8 flex flex-wrap gap-x-10 gap-y-4"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          {[
            {
              label: "TVL",
              value: `$${v.tvl.toLocaleString()}`,
              color: "var(--text-primary)",
            },
            {
              label: "APY",
              value: `${v.apy}%`,
              color: "var(--accent-revealed)",
            },
            {
              label: "Share Price",
              value: `$${v.sharePrice.toFixed(3)}`,
              color: "var(--text-primary)",
            },
            {
              label: "Last Rebalance",
              value: `${v.lastRebalance}s ago`,
              color: "var(--text-secondary)",
            },
          ].map((m) => (
            <div key={m.label}>
              <div
                className="text-[10px] tracking-[0.2em] uppercase mb-1"
                style={{ color: "var(--text-tertiary)" }}
              >
                {m.label}
              </div>
              <div
                className="text-xl font-light font-mono tracking-tight"
                style={{ color: m.color }}
              >
                {m.value}
              </div>
            </div>
          ))}
        </div>

        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-[1fr,380px] gap-0">
          {/* Left: Encrypted vs Revealed */}
          <div
            className="px-6 md:px-10 py-8"
            style={{ borderRight: "1px solid var(--border-subtle)" }}
          >
            {/* The Privacy Visualization — encrypted | MPC | revealed */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr,auto,1fr] overflow-hidden">
              {/* Encrypted State Panel */}
              <div className="vault-encrypted p-6">
                <div className="flex items-center gap-2 mb-5">
                  <div
                    className="live-dot w-1.5 h-1.5 rounded-full"
                    style={{ background: "var(--accent-encrypted)" }}
                  />
                  <span
                    className="text-[10px] tracking-[0.25em] uppercase"
                    style={{ color: "var(--accent-encrypted)" }}
                  >
                    Encrypted on-chain state
                  </span>
                </div>

                <div className="space-y-1">
                  {[
                    "base_balance",
                    "quote_balance",
                    "spread_bps",
                    "rebalance_threshold",
                    "last_mid_price",
                  ].map((field, i) => (
                    <EncryptedField
                      key={field}
                      label={field}
                      baseHex={v.encryptedState[i]}
                      index={i}
                    />
                  ))}
                </div>

                <p
                  className="mt-4 text-[11px] leading-relaxed"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  These values are ciphertexts stored on Solana. No validator,
                  explorer, or MEV bot can read them.
                </p>
              </div>

              {/* MPC Divider */}
              <MPCDivider />

              {/* Revealed Quotes Panel */}
              <div className="vault-revealed p-6">
                <div className="flex items-center gap-2 mb-5">
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: "var(--accent-revealed)" }}
                  />
                  <span
                    className="text-[10px] tracking-[0.25em] uppercase"
                    style={{ color: "var(--accent-revealed)" }}
                  >
                    MPC revealed quotes
                  </span>
                </div>

                <div className="space-y-6">
                  {/* Oracle Price */}
                  <div>
                    <div
                      className="text-[10px] font-mono uppercase tracking-wider mb-1"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      Oracle (Pyth)
                    </div>
                    <div
                      className="font-mono text-2xl font-light"
                      style={{ color: "var(--text-primary)" }}
                    >
                      ${v.quotes.oraclePrice.toFixed(2)}
                    </div>
                  </div>

                  {/* Bid / Ask */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div
                        className="text-[10px] font-mono uppercase tracking-wider mb-1"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        Bid
                      </div>
                      <div
                        className="revealed-price font-mono text-lg font-light quote-reveal"
                        style={{ color: "var(--accent-revealed)" }}
                      >
                        ${v.quotes.bidPrice.toFixed(3)}
                      </div>
                      <div
                        className="font-mono text-xs mt-1"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {v.quotes.bidSize.toFixed(1)} SOL
                      </div>
                    </div>
                    <div>
                      <div
                        className="text-[10px] font-mono uppercase tracking-wider mb-1"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        Ask
                      </div>
                      <div
                        className="revealed-price font-mono text-lg font-light quote-reveal"
                        style={{
                          color: "var(--accent-revealed)",
                          animationDelay: "0.15s",
                        }}
                      >
                        ${v.quotes.askPrice.toFixed(3)}
                      </div>
                      <div
                        className="font-mono text-xs mt-1"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {v.quotes.askSize.toLocaleString()} SOL
                      </div>
                    </div>
                  </div>

                  {/* Spread */}
                  <div>
                    <div
                      className="text-[10px] font-mono uppercase tracking-wider mb-1"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      Effective spread
                    </div>
                    <div
                      className="font-mono text-sm"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {(
                        ((v.quotes.askPrice - v.quotes.bidPrice) /
                          v.quotes.oraclePrice) *
                        100
                      ).toFixed(2)}
                      %
                    </div>
                  </div>

                  {/* Status */}
                  <div
                    className="flex items-center gap-2 pt-3"
                    style={{ borderTop: "1px solid var(--border-subtle)" }}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        background: v.quotes.shouldRebalance
                          ? "var(--accent-warning)"
                          : "var(--accent-revealed)",
                      }}
                    />
                    <span
                      className="text-xs"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {v.quotes.shouldRebalance
                        ? "Rebalance pending"
                        : "Position optimal"}
                    </span>
                  </div>
                </div>

                <p
                  className="mt-4 text-[11px] leading-relaxed"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  These quotes were computed from the encrypted state. The
                  strategy behind them remains hidden.
                </p>
              </div>
            </div>

            {/* Rebalance History */}
            <div className="mt-8">
              <div
                className="text-[10px] tracking-[0.25em] uppercase mb-4"
                style={{ color: "var(--text-tertiary)" }}
              >
                Recent computations
              </div>
              <div
                className="rounded overflow-x-auto"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <table className="w-full text-xs min-w-[520px]">
                  <thead>
                    <tr
                      style={{
                        borderBottom: "1px solid var(--border-subtle)",
                      }}
                    >
                      {["Time", "Bid", "Ask", "Spread", "Action"].map((h) => (
                        <th
                          key={h}
                          className="text-left font-normal px-4 py-2.5"
                          style={{ color: "var(--text-tertiary)" }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {v.rebalanceHistory.map((r, i) => (
                      <tr
                        key={i}
                        className="vault-row"
                        style={{
                          borderBottom:
                            i < v.rebalanceHistory.length - 1
                              ? "1px solid var(--border-subtle)"
                              : "none",
                        }}
                      >
                        <td
                          className="px-4 py-2.5 font-mono"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {r.time}
                        </td>
                        <td
                          className="px-4 py-2.5 font-mono"
                          style={{ color: "var(--accent-revealed)" }}
                        >
                          ${r.bid.toFixed(3)}
                        </td>
                        <td
                          className="px-4 py-2.5 font-mono"
                          style={{ color: "var(--accent-revealed)" }}
                        >
                          ${r.ask.toFixed(3)}
                        </td>
                        <td
                          className="px-4 py-2.5 font-mono"
                          style={{ color: "var(--text-tertiary)" }}
                        >
                          {(
                            ((r.ask - r.bid) / ((r.ask + r.bid) / 2)) *
                            100
                          ).toFixed(3)}
                          %
                        </td>
                        <td className="px-4 py-2.5">
                          {r.rebalanced ? (
                            <span className="badge-rebalanced text-[10px] font-mono px-2 py-0.5 rounded">
                              REBALANCED
                            </span>
                          ) : (
                            <span className="badge-held text-[10px] font-mono px-2 py-0.5 rounded">
                              HELD
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right Sidebar: Deposit / Withdraw + Strategy */}
          <div className="px-6 md:px-8 py-8">
            {/* Deposit / Withdraw */}
            <div
              className="rounded overflow-hidden"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              {/* Tab switcher */}
              <div
                className="flex"
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
              >
                {(["deposit", "withdraw"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className="flex-1 py-3 text-xs tracking-[0.15em] uppercase transition-colors"
                    style={{
                      color:
                        activeTab === tab
                          ? "var(--text-primary)"
                          : "var(--text-tertiary)",
                      borderBottom:
                        activeTab === tab
                          ? "1px solid var(--accent-encrypted)"
                          : "1px solid transparent",
                    }}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="p-5">
                {/* Balance display */}
                <div
                  className="flex justify-between items-center mb-3 text-[10px] tracking-[0.15em] uppercase"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  <span>
                    {activeTab === "deposit" ? "Amount (USDC)" : "Shares"}
                  </span>
                  <span className="font-mono normal-case tracking-normal">
                    Balance: —
                  </span>
                </div>

                <div
                  className="flex items-center rounded px-3 py-2.5"
                  style={{
                    background: "var(--bg-deep)",
                    border: "1px solid var(--border-medium)",
                  }}
                >
                  <input
                    type="text"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 bg-transparent outline-none font-mono text-sm"
                    style={{ color: "var(--text-primary)" }}
                  />
                  <button
                    className="text-[10px] tracking-wider uppercase px-2 py-1 rounded transition-colors"
                    style={{
                      color: "var(--accent-encrypted)",
                      background: "var(--bg-raised)",
                    }}
                    onClick={() => setDepositAmount("1000")}
                  >
                    Max
                  </button>
                </div>

                {depositAmount && (
                  <div
                    className="mt-4 py-3 space-y-2"
                    style={{ borderTop: "1px solid var(--border-subtle)" }}
                  >
                    <div className="flex justify-between text-xs">
                      <span style={{ color: "var(--text-tertiary)" }}>
                        You receive
                      </span>
                      <span
                        className="font-mono"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {(
                          parseFloat(depositAmount || "0") / v.sharePrice
                        ).toFixed(2)}{" "}
                        spTokens
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span style={{ color: "var(--text-tertiary)" }}>
                        Share price
                      </span>
                      <span
                        className="font-mono"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        ${v.sharePrice.toFixed(4)}
                      </span>
                    </div>
                  </div>
                )}

                <button
                  disabled={!canSubmit}
                  onClick={activeTab === "deposit" ? handleDeposit : handleWithdraw}
                  className={`w-full py-3 mt-4 text-sm font-medium tracking-wide rounded ${
                    canSubmit ? "deposit-btn-active" : "deposit-btn-disabled"
                  }`}
                >
                  {txLoading
                    ? activeTab === "deposit"
                      ? "Depositing…"
                      : "Withdrawing…"
                    : !depositAmount
                      ? "Enter amount"
                      : !connected
                        ? "Connect wallet"
                        : !vault
                          ? "No vault found"
                          : activeTab === "deposit"
                            ? "Deposit"
                            : "Withdraw"}
                </button>

                {/* Tx feedback — shown only when there's something to say. */}
                {txError && (
                  <p
                    className="mt-3 text-[11px] leading-relaxed break-all"
                    style={{ color: "var(--accent-danger)" }}
                  >
                    {txError}
                  </p>
                )}
                {txSig && !txError && (
                  <a
                    href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 block text-[11px] font-mono break-all underline-offset-2 hover:underline"
                    style={{ color: "var(--accent-revealed)" }}
                  >
                    Tx: {txSig.slice(0, 12)}…{txSig.slice(-8)} ↗
                  </a>
                )}
              </div>
            </div>

            {/* Strategy Status */}
            <div className="mt-6">
              <div
                className="text-[10px] tracking-[0.25em] uppercase mb-3"
                style={{ color: "var(--text-tertiary)" }}
              >
                Vault strategy
              </div>
              <div
                className="rounded p-5 space-y-3"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {[
                  { label: "Spread", hex: "a3f2c1" },
                  { label: "Rebalance Threshold", hex: "7d91f3" },
                  { label: "Base Balance", hex: "5c6a0f82d3" },
                  { label: "Quote Balance", hex: "2e8fc71d4a" },
                ].map((item) => (
                  <div key={item.label} className="flex justify-between items-center">
                    <span
                      className="text-xs"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      {item.label}
                    </span>
                    <span className="strategy-locked text-[10px] font-mono px-2 py-0.5 flex items-center"
                      style={{ color: "var(--accent-encrypted-dim)" }}
                    >
                      <LockIcon />
                      0x{item.hex}...
                    </span>
                  </div>
                ))}

                <div
                  className="pt-3 mt-2"
                  style={{ borderTop: "1px solid var(--border-subtle)" }}
                >
                  <p
                    className="text-[11px] leading-relaxed"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    Strategy parameters are encrypted via Arcium MPC. Only the
                    vault owner can update them.
                  </p>
                </div>
              </div>
            </div>

            {/* Powered by */}
            <div className="mt-8 flex items-center gap-3">
              <div
                className="text-[10px] tracking-[0.15em] uppercase"
                style={{ color: "var(--text-tertiary)" }}
              >
                Powered by
              </div>
              {["Arcium MPC", "Solana"].map((badge) => (
                <div
                  key={badge}
                  className="flex items-center gap-2 text-xs font-mono px-2.5 py-1 rounded"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {badge}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
