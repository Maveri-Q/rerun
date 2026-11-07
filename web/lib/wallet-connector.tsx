"use client";

import { Account, JsonRpcProvider, type KeyPairString } from "near-api-js";
import { NearProvider, useNearWallet } from "near-connect-hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONTRACT, NETWORK, RPC, txLink } from "./config";
import type { Wallet } from "./wallet";

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

/** What a wallet returns differs a little from one wallet to the next, so this reads it carefully. */
interface SentTransaction {
  transaction?: { hash?: string };
  transaction_outcome?: { id?: string };
  status?: { Failure?: unknown };
}

function hashOf(sent: SentTransaction | undefined): string {
  if (sent?.status?.Failure) throw new Error(JSON.stringify(sent.status.Failure));
  return sent?.transaction?.hash ?? sent?.transaction_outcome?.id ?? "";
}

/** After anything someone signs: the real transaction, on the public explorer. */
function TransactionProof({ hash, onClose }: { hash: string; onClose: () => void }) {
  if (!hash) return null;
  return (
    <aside className="wallet-help tx-proof" role="status">
      <span>
        <b>{"\u2713"} Verified on NEAR.</b> <a href={txLink(hash)} target="_blank" rel="noreferrer">See this transaction</a>
      </span>
      <button className="quiet btn--small" onClick={onClose}>
        Hide this
      </button>
    </aside>
  );
}

function Inner({ onChange }: { onChange: (wallet: Wallet) => void }) {
  const near = useNearWallet();
  const latest = useRef(near);
  latest.current = near;
  const [test, setTest] = useState<Account | null>(null);
  const [wait, setWait] = useState<WalletWait>(null);
  const [blocked, setBlocked] = useState(false);
  const [lastTx, setLastTx] = useState("");
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
      setLastTx("");
      if (test) {
        setLastTx(hashOf((await test.callFunctionRaw({ contractId, methodName: method, args, deposit: BigInt(opts.deposit ?? "0"), gas })) as SentTransaction));
        return;
      }
      setBlocked(false);
      setWait("sign");
      try {
        setLastTx(hashOf((await latest.current.callFunctionRaw({ contractId, method, args, deposit: opts.deposit ?? "0", gas: gas.toString() })) as SentTransaction));
      } finally {
        setWait(null);
      }
    },
    [test],
  );

  const value = useMemo<Wallet>(
    () => ({
      accountId: test?.accountId ?? near.signedAccountId,
      loading: near.loading,
      signIn: () => {
        setBlocked(false);
        setWait("connect");
        void latest.current.signIn();
      },
      signOut: () => void latest.current.signOut(),
      call,
    }),
    [test?.accountId, near.signedAccountId, near.loading, call],
  );
  useEffect(() => onChange(value), [value, onChange]);
  return (
    <>
      <WalletHelp wait={wait} blocked={blocked} onClose={() => setWait(null)} />
      {!wait && <TransactionProof hash={lastTx} onClose={() => setLastTx("")} />}
    </>
  );
}

/**
 * The wallet connector needs `window`, so it loads only in the browser. It sits beside the pages rather
 * than around them, so the pages themselves still render on the server, and tells them who's connected.
 */
export function WalletConnector({ onChange }: { onChange: (wallet: Wallet) => void }) {
  return (
    <NearProvider config={{ network: NETWORK }}>
      <Inner onChange={onChange} />
    </NearProvider>
  );
}

