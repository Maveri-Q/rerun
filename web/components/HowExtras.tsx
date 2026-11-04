"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

const VERDICTS = [
  { word: "HELD UP", who: "YES wins", text: "The code ran and got a number inside the claim's range." },
  { word: "DID NOT HOLD UP", who: "NO wins", text: "The code ran, but the number came out outside the range." },
  { word: "CODE BROKEN", who: "NO wins", text: "The code can't run, even after fixing setup problems." },
  { word: "NO VERDICT", who: "Half back", text: "The test wasn't fair, for example because the data changed. Everyone gets half their shares' value back." },
];

/** The four possible verdicts, as four receipts you can spread out and lift. */
export function VerdictFan() {
  return (
    <ul className="fan">
      {VERDICTS.map((v, i) => (
        <motion.li
          key={v.word}
          className="fan-card"
          style={{ zIndex: i }}
          initial={{ rotate: 0, x: 0, opacity: 0 }}
          whileInView={{ rotate: (i - 1.5) * 4, opacity: 1 }}
          whileHover={{ y: -26, rotate: 0, scale: 1.04, zIndex: 9 }}
          whileFocus={{ y: -26, rotate: 0, scale: 1.04, zIndex: 9 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ type: "spring", stiffness: 260, damping: 22, delay: 0 }}
          tabIndex={0}
        >
          <span className="fan-who">{v.who}</span>
          <strong>{v.word}</strong>
          <p>{v.text}</p>
        </motion.li>
      ))}
    </ul>
  );
}

const WORDS = [
  { word: "Claim", text: "A research result being tested, such as \"this model is 93% accurate\"." },
  { word: "Allowed margin", text: "How close the re-run must get. With 0.93 and a margin of 0.02, anything from 0.91 to 0.95 counts." },
  { word: "Forecast", text: "Your prediction. Buying YES means you expect the claim to hold up, and buying NO means you don't." },
  { word: "Shares", text: "What a forecast buys. A winning share pays 1 point or 1 tUSDC, and a losing share pays nothing." },
  { word: "Chance", text: "The price of a YES share, which is what forecasters collectively think is likely. It moves as people buy." },
  { word: "Locks", text: "The moment forecasting stops and the Lab starts its work." },
  { word: "Receipt", text: "The Lab's permanent public record of what it ran and what it found." },
  { word: "Challenge", text: "If you think a result is wrong, you post a deposit and the Lab must run it again with a different AI." },
  { word: "Points", text: "Free play money for forecasting without risk. Everyone can claim 1,000." },
  { word: "tUSDC", text: "A test token with no real value, used here to try real-money forecasting safely." },
  { word: "Secure hardware", text: "A protected part of a computer. It produces proof of what code is running there, and keeps data hidden, even from whoever runs the computer." },
];

/** Pick a word and its meaning prints out. */
export function WordPrinter() {
  const [picked, setPicked] = useState(0);
  const word = WORDS[picked]!;
  return (
    <div className="words">
      <div className="words-list" role="group" aria-label="Choose a word">
        {WORDS.map((w, i) => (
          <button key={w.word} aria-pressed={i === picked} onClick={() => setPicked(i)} onMouseEnter={() => setPicked(i)}>
            {w.word}
          </button>
        ))}
      </div>
      <div className="words-printer">
        <div className="receipt-slot" aria-hidden="true" />
        <div className="words-feed" aria-live="polite">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={word.word} className="words-paper" initial={{ y: "-100%" }} animate={{ y: 0 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 300, damping: 30 }}>
              <strong>{word.word}</strong>
              <p>{word.text}</p>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
