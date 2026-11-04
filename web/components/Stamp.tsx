import type { Outcome } from "@/lib/market";

const TEXT: Record<Outcome, string> = {
  REPRODUCED: "REPRODUCED",
  NOT_REPRODUCED: "NOT REPRODUCED",
  BROKEN: "BROKEN",
  INVALID: "INVALID",
};

/** The verdict, as a rubber stamp. `reveal` plays the thud; only use it when the viewer just watched it happen. */
export function Stamp({ outcome, size, reveal }: { outcome: Outcome; size?: "sm" | "xl"; reveal?: boolean }) {
  const classes = ["stamp", `stamp--${outcome}`, size ? `stamp--${size}` : "", reveal ? "stamp--reveal" : ""].filter(Boolean).join(" ");
  return <span className={classes}>{TEXT[outcome]}</span>;
}
