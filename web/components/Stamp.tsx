import { verdictWords, type Outcome } from "@/lib/market";

/** A small verdict chip for lists. The full verdict is the printed receipt. */
export function Stamp({ outcome, reason }: { outcome: Outcome; reason?: string | null }) {
  const v = verdictWords(outcome, reason)!;
  return (
    <span className={`chip chip--${v.tone}`}>
      {v.mark} {v.words}
    </span>
  );
}
