"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** The words readers ask about, in the same terms as the list on /how. */
export const HINTS = {
  receipt: "The Lab's permanent public record of what it ran and what it found.",
  margin: "How close the re-run must get. With 0.93 and a margin of 0.02, anything from 0.91 to 0.95 counts.",
  hardware: "A protected part of a computer. It proves what code is running there, and keeps data hidden, even from whoever runs the computer. Engineers call it a TEE.",
  proof: "A signed note from the chip makers, Intel and NVIDIA, saying the AI really ran on secure hardware. Engineers call it an attestation.",
  inconclusive: "The test couldn't be run fairly: the software wouldn't run, the data was missing, or an independent rebuild disagreed. None of that counts against the paper, and every share pays back half.",
  fingerprint: "A short code worked out from a file. Change one character of the file and the code changes, so anyone can tell it wasn't altered.",
} as const;

/** A word with its meaning one hover or tap away. */
export function Hint({ term, children }: { term: keyof typeof HINTS; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const box = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);

  // Keeps the note on screen when the word sits near the edge of a phone.
  useLayoutEffect(() => {
    if (!open || !tip.current) return setShift(0);
    const rect = tip.current.getBoundingClientRect();
    const gutter = 16;
    const over = rect.right - shift - (document.documentElement.clientWidth - gutter);
    setShift(over > 0 ? over : rect.left - shift < gutter ? rect.left - shift - gutter : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <span className="term" ref={box} onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)} onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}>
      <button type="button" className="term-word" aria-expanded={open} onClick={() => setOpen(true)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
        {children}
      </button>
      {open && (
        <span className="term-note" role="tooltip" ref={tip} style={{ transform: `translateX(${-shift}px)` }}>
          {HINTS[term]}
        </span>
      )}
    </span>
  );
}
