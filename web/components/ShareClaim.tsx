"use client";

import { BRAND } from "@rerun/shared/browser";
import { useState } from "react";

/** A link to one claim, to send to a friend. Nothing is posted unless the person does it themselves. */
export function ShareClaim({ path, question }: { path: string; question: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${BRAND.siteUrl}${path}`;
  const text = `${question} See what people forecast, and what happened when it was rerun.`;
  const copy = async () => {
    const native = typeof navigator !== "undefined" && "share" in navigator;
    try {
      if (native) await navigator.share({ title: question, text, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      // Closing the share sheet isn't an error, and there's nothing to tell the person.
    }
  };
  return (
    <div className="share-row">
      <button className="quiet btn--small" onClick={() => void copy()}>
        {copied ? "Link copied" : "Share with a friend"}
      </button>
      <a className="btn quiet btn--small" href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">
        Post on X
      </a>
    </div>
  );
}
