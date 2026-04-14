"use client";

import { useState, useEffect, useRef } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import type { BN } from "@coral-xyz/anchor";
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

export function useQuotes() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [quotes, setQuotes] = useState<QuotesData | null>(null);
  const listenerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!wallet) return;

    const program = getProgram(connection, wallet);

    listenerRef.current = program.addEventListener(
      "quotesComputedEvent",
      (event: Record<string, unknown>) => {
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
