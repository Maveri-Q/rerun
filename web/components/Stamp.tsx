import type { Outcome } from "@/lib/market";

const TEXT: Record<Outcome, string> = {
  REPRODUCED: "Held up",
  NOT_REPRODUCED: "Did not hold up",
  BROKEN: "Code broken",
  INVALID: "No verdict",
};

/** A small verdict chip for lists. The full verdict is the printed receipt. */
export function Stamp({ outcome }: { outcome: Outcome }) {
  return <span className={`chip chip--${outcome}`}>{TEXT[outcome]}</span>;
}
