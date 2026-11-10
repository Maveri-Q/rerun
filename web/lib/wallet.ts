"use client";

import { createContext, useContext } from "react";

export interface CallOptions {
  /** yoctoNEAR, as a string. */
  deposit?: string;
  tgas?: number;
  contractId?: string;
  /** Points-mode calls RERUN's relayer may pay for. Falls back to an ordinary signed call when it can't. */
  gasFree?: boolean;
}

export interface Wallet {
  accountId: string;
  loading: boolean;
  signIn: () => void;
  signOut: () => void;
  call: (method: string, args: Record<string, unknown>, opts?: CallOptions) => Promise<void>;
}

/** What pages see on the server, and in the browser until the connector has loaded. */
export const NO_WALLET: Wallet = {
  accountId: "",
  loading: true,
  signIn: () => {},
  signOut: () => {},
  call: () => Promise.reject(new Error("Your wallet is still loading. Try again in a moment.")),
};

export const WalletContext = createContext<Wallet>(NO_WALLET);

export const useWallet = (): Wallet => useContext(WalletContext);

/** Turns wallet and contract failures into a sentence someone can act on. */
export function explainError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  const panic = /Smart contract panicked: ([^"\\]+)/.exec(text);
  if (panic) return panic[1]!;
  if (/reject|cancel|denied|closed/i.test(text)) return "You cancelled this in your wallet. Nothing was sent.";
  if (/fetch|network/i.test(text)) return "The network did not answer. Check your connection and try again.";
  return text.slice(0, 220);
}
