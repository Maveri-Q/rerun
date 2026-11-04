"use client";

import { APP_NAME } from "@rerun/shared/browser";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";

/** The sign-off: the name rolls into place like the digits on a counter whenever it scrolls into view. */
export function BigFoot() {
  const reduce = useReducedMotion();
  return (
    <footer className="bigfoot">
      <div className="bigfoot-links">
        <span>Testnet demo. Points and tUSDC have no real value.</span>
        <Link href="/how">How it works</Link>
        <Link href="/check">Check a paper</Link>
        <Link href="/lab">The Lab</Link>
      </div>
      {/* The trigger is the row itself: a letter rolled out of its slot is clipped, so it could never report being in view. */}
      <motion.div className="bigfoot-word" role="img" aria-label={APP_NAME} initial={reduce ? false : "out"} whileInView="in" viewport={{ amount: 0.2 }}>
        {[...APP_NAME].map((ch, i) => (
          <span key={i} className="bigfoot-slot" aria-hidden="true">
            <motion.span variants={{ out: { y: i % 2 ? "-105%" : "105%" }, in: { y: 0 } }} transition={{ type: "spring", stiffness: 120, damping: 18, delay: i * 0.05 }}>
              {ch}
            </motion.span>
          </span>
        ))}
      </motion.div>
    </footer>
  );
}
