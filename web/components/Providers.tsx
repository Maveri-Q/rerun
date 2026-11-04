"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// The wallet connector needs `window`, so it never renders on the server.
const WalletProvider = dynamic(() => import("@/lib/wallet").then((m) => m.WalletProvider), { ssr: false });

export function Providers({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
