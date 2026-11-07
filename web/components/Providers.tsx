"use client";

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { NO_WALLET, WalletContext } from "@/lib/wallet";

const WalletConnector = dynamic(() => import("@/lib/wallet-connector").then((m) => m.WalletConnector), { ssr: false });

export function Providers({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState(NO_WALLET);
  return (
    <WalletContext.Provider value={wallet}>
      {children}
      <WalletConnector onChange={setWallet} />
    </WalletContext.Provider>
  );
}
