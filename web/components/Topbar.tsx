"use client";

import { APP_NAME } from "@rerun/shared/browser";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Logo } from "./Logo";
import { useWallet } from "@/lib/wallet";

const LINKS = [
  { href: "/", label: "Claims" },
  { href: "/how", label: "How it works" },
  { href: "/facts", label: "Verified facts" },
  { href: "/check", label: "Check a paper" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/lab", label: "The Lab" },
  { href: "/create", label: "Suggest a paper" },
];

export function Topbar() {
  const pathname = usePathname();
  const wallet = useWallet();
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const strip = nav.current;
    const link = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (strip && link) strip.scrollLeft = link.offsetLeft - strip.offsetLeft - (strip.clientWidth - link.offsetWidth) / 2;
  }, [pathname]);
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <Logo />
        {APP_NAME}
      </Link>
      <nav ref={nav} className="nav" aria-label="Main">
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
            Connect wallet
          </button>
        )}
      </div>
    </header>
  );
}
