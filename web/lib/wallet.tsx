"use client";

import { Account, JsonRpcProvider, type KeyPairString } from "near-api-js";
import { NearProvider, useNearWallet } from "near-connect-hooks";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CONTRACT, NETWORK, RPC } from "./config";

export interface CallOptions {
  /** yoctoNEAR, as a string. */
  deposit?: string;
  tgas?: number;
  contractId?: string;
}

export interface Wallet {
  accountId: string;
  loading: boolean;
  signIn: () => void;
  signOut: () => void;
  call: (method: string, args: Record<string, unknown>, opts?: CallOptions) => Promise<void>;
}

const WalletContext = createContext<Wallet | null>(null);

export const useWallet = (): Wallet => {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error("useWallet needs WalletProvider");
  return wallet;
};

/**
 * Automated browser tests cannot click through a wallet's own window, so on a local dev server
 * they set this flag and sign with the throwaway testnet key from /api/dev-test-wallet.
 * The check compiles out of production builds.
 */
async function testAccount(): Promise<Account | null> {
  if (process.env.NODE_ENV === "production" || window.localStorage.getItem("rerun.test-wallet") !== "1") return null;
  const res = await fetch("/api/dev-test-wallet");
  if (!res.ok) return null;
  const { accountId, privateKey } = (await res.json()) as { accountId: string; privateKey: string };
  return new Account(accountId, new JsonRpcProvider({ url: RPC }), privateKey as KeyPairString);
}

function Inner({ children }: { children: ReactNode }) {
  const near = useNearWallet();
  const [test, setTest] = useState<Account | null>(null);
  useEffect(() => void testAccount().then(setTest), []);

  const call = useCallback<Wallet["call"]>(
    async (method, args, opts = {}) => {
      const contractId = opts.contractId ?? CONTRACT;
      const gas = BigInt(opts.tgas ?? 100) * 10n ** 12n;
      if (test) {
        await test.callFunction({ contractId, methodName: method, args, deposit: BigInt(opts.deposit ?? "0"), gas });
        return;
      }
      await near.callFunction({ contractId, method, args, deposit: opts.deposit ?? "0", gas: gas.toString() });
    },
    [near, test],
  );

  const value = useMemo<Wallet>(
    () => ({
      accountId: test?.accountId ?? near.signedAccountId,
      loading: near.loading,
      signIn: () => void near.signIn(),
      signOut: () => void near.signOut(),
      call,
    }),
    [near, test, call],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <NearProvider config={{ network: NETWORK }}>
      <Inner>{children}</Inner>
    </NearProvider>
  );
}

/** Turns wallet and contract failures into a sentence someone can act on. */
export function explainError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  const panic = /Smart contract panicked: ([^"\\]+)/.exec(text);
  if (panic) return panic[1]!;
  if (/reject|cancel|denied|closed/i.test(text)) return "You cancelled this in your wallet. Nothing was sent.";
  if (/fetch|network/i.test(text)) return "The network did not answer. Check your connection and try again.";
  return text.slice(0, 220);
}
