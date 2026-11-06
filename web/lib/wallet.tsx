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

type WalletWait = null | "connect" | "sign";

/**
 * A browser wallet works in a separate window, and the connector's own dialog just waits for it, so a
 * blocked or buried window looks like the site has frozen. This says what's going on and what to do.
 */
function WalletHelp({ wait, blocked, onClose }: { wait: WalletWait; blocked: boolean; onClose: () => void }) {
  if (!wait) return null;
  return (
    <aside className="wallet-help" role="status">
      {blocked ? (
        <>
          <b>Your browser blocked the wallet&apos;s window.</b>
          <p>Allow pop-ups for this site, usually from the icon at the right of the address bar. Then close this dialog and try again.</p>
        </>
      ) : (
        <>
          <b>{wait === "connect" ? "Your wallet opens in its own window." : "Approve this in your wallet's window."}</b>
          <p>
            Can&apos;t see it? It may be behind this one, or your browser may have blocked it.
            {wait === "connect" && " This site uses NEAR's test network, so your wallet needs a testnet account. They're free, but your everyday NEAR account won't show up."}
          </p>
        </>
      )}
      <button className="quiet btn--small" onClick={onClose}>
        Hide this
      </button>
    </aside>
  );
}

function Inner({ children }: { children: ReactNode }) {
  const near = useNearWallet();
  const [test, setTest] = useState<Account | null>(null);
  const [wait, setWait] = useState<WalletWait>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => void testAccount().then(setTest), []);

  // The wallet code runs in a sandbox and asks this page to open its window, so this is where a block shows.
  useEffect(() => {
    const open = window.open;
    window.open = function (...args: Parameters<typeof window.open>) {
      const opened = open.apply(window, args);
      setBlocked(!opened);
      setWait((now) => now ?? "connect");
      return opened;
    };
    return () => {
      window.open = open;
    };
  }, []);

  // The help goes away with the connector's dialog, or as soon as an account is connected.
  useEffect(() => {
    if (wait !== "connect") return;
    if (near.signedAccountId) return setWait(null);
    // The connector swaps one dialog for another when a wallet is picked, so a short gap doesn't mean it closed.
    let seen = false;
    let gone = 0;
    const id = window.setInterval(() => {
      const showing = document.querySelector(".hot-connector-popup") !== null;
      gone = showing ? 0 : gone + 1;
      if (showing) seen = true;
      else if (seen && gone >= 12) setWait(null);
    }, 400);
    return () => window.clearInterval(id);
  }, [wait, near.signedAccountId]);

  const call = useCallback<Wallet["call"]>(
    async (method, args, opts = {}) => {
      const contractId = opts.contractId ?? CONTRACT;
      const gas = BigInt(opts.tgas ?? 100) * 10n ** 12n;
      if (test) {
        await test.callFunction({ contractId, methodName: method, args, deposit: BigInt(opts.deposit ?? "0"), gas });
        return;
      }
      setBlocked(false);
      setWait("sign");
      try {
        await near.callFunction({ contractId, method, args, deposit: opts.deposit ?? "0", gas: gas.toString() });
      } finally {
        setWait(null);
      }
    },
    [near, test],
  );

  const value = useMemo<Wallet>(
    () => ({
      accountId: test?.accountId ?? near.signedAccountId,
      loading: near.loading,
      signIn: () => {
        setBlocked(false);
        setWait("connect");
        void near.signIn();
      },
      signOut: () => void near.signOut(),
      call,
    }),
    [near, test, call],
  );
  return (
    <WalletContext.Provider value={value}>
      {children}
      <WalletHelp wait={wait} blocked={blocked} onClose={() => setWait(null)} />
    </WalletContext.Provider>
  );
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
