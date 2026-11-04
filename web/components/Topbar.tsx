"use client";

import { APP_NAME } from "@rerun/shared/browser";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NETWORK } from "@/lib/config";
import { useWallet } from "@/lib/wallet";

const LINKS = [
  { href: "/", label: "Claims" },
  { href: "/how", label: "How it works" },
  { href: "/check", label: "Check a paper" },
  { href: "/create", label: "New claim" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/lab", label: "The Lab" },
];

export function Topbar() {
  const pathname = usePathname();
  const wallet = useWallet();
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        {APP_NAME}
      </Link>
      <nav className="nav" aria-label="Main">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="connect">
        {wallet.accountId ? (
          <button className="quiet" onClick={wallet.signOut} title={`Disconnect ${wallet.accountId}`}>
            {wallet.accountId.length > 24 ? `${wallet.accountId.slice(0, 21)}…` : wallet.accountId}
          </button>
        ) : (
          <button onClick={wallet.signIn} disabled={wallet.loading}>
            Connect {NETWORK} wallet
          </button>
        )}
      </div>
    </header>
  );
}
