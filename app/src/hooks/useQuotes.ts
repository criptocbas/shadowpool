"use client";

import { useState, useEffect, useRef } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { BN } from "@coral-xyz/anchor";
import { getProgram } from "@/lib/program";

export interface QuotesData {
  bidPrice: BN;
  bidSize: BN;
  askPrice: BN;
  askSize: BN;
  shouldRebalance: number;
  /** Timestamp when this event was received client-side */
  receivedAt: number;
}

// The typed IDL guarantees the event shape at compile time, but Anchor's
// event listener hands us a `Record<string, unknown>` at runtime — a stale
// listener or IDL drift could still deliver malformed payloads. Validate
// before trusting the fields downstream.
function isValidQuotesEvent(event: Record<string, unknown>): boolean {
  return (
    BN.isBN(event.bidPrice) &&
    BN.isBN(event.bidSize) &&
    BN.isBN(event.askPrice) &&
    BN.isBN(event.askSize) &&
    typeof event.shouldRebalance === "number"
  );
}

export function useQuotes() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [quotes, setQuotes] = useState<QuotesData | null>(null);
  const listenerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!wallet || !connection) return;

    const program = getProgram(connection, wallet);

    listenerRef.current = program.addEventListener(
      "quotesComputedEvent",
      (event: Record<string, unknown>) => {
        if (!isValidQuotesEvent(event)) {
          console.warn("Discarding malformed quotesComputedEvent", event);
          return;
        }
        setQuotes({
          bidPrice: event.bidPrice as BN,
          bidSize: event.bidSize as BN,
          askPrice: event.askPrice as BN,
          askSize: event.askSize as BN,
          shouldRebalance: event.shouldRebalance as number,
          receivedAt: Date.now(),
        });
      }
    );

    return () => {
      if (listenerRef.current !== null) {
        program.removeEventListener(listenerRef.current);
        listenerRef.current = null;
      }
    };
  }, [wallet, connection]);

  return { quotes };
}
