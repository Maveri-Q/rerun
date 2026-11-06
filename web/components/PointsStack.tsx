"use client";

import { motion, useReducedMotion } from "motion/react";

const COINS = 10;

/** What every new account starts with: ten coins of 100 points drop onto a pile. */
export function PointsStack() {
  const reduce = useReducedMotion();
  return (
    <div className="stack" role="img" aria-label="1,000 free points">
      <div className="stack-coins">
        {Array.from({ length: COINS }, (_, i) => (
          <motion.i key={i} style={{ bottom: i * 15, left: `calc(50% + ${((i * 37) % 9) - 4}px)` }} initial={reduce ? false : { y: -260, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 17, delay: 0.25 + i * 0.13 }} />
        ))}
      </div>
      <motion.b initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + COINS * 0.13 + 0.15 }}>
        1,000 free points
      </motion.b>
      <span>Yours when you connect. No money involved.</span>
    </div>
  );
}
