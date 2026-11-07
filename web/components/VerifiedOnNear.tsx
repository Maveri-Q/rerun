import { accountLink, CONTRACT, txLink } from "@/lib/config";

/**
 * The link anyone can follow to check something on the public explorer. A transaction when the page knows
 * it, otherwise the account whose full history holds it: past verdicts aren't indexed by claim.
 */
export function VerifiedOnNear({ hash, account = CONTRACT, label }: { hash?: string; account?: string; label?: string }) {
  return (
    <p className="verified-on-near">
      {"\u2713"} Verified on NEAR.{" "}
      <a href={hash ? txLink(hash) : accountLink(account)} target="_blank" rel="noreferrer">
        {label ?? (hash ? "See this transaction" : "See the contract's history")}
      </a>
    </p>
  );
}
