"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { lab } from "@/lib/lab";

/** Opens a short demo claim, or the one already open, so a visitor can follow it from start to finish. */
export function TryItNow() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      router.push(`/market/${await lab.tryNow()}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <button className="btn" disabled={busy} onClick={() => void start()}>
        {busy ? "Opening a demo claim…" : "Try it now"}
      </button>
      {error && <p className="notice notice--error try-error" role="status">{error}</p>}
    </>
  );
}
