"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

const VERDICTS = [
  { word: "\u2713 NUMBERS CHECK OUT", who: "YES wins", text: "The code ran and got a number inside the claim's range. That doesn't prove the study's method is right." },
  { word: "\u2717 DOESN'T HOLD UP", who: "NO wins", text: "The code ran, but the number came out outside the range, or it ran past its time limit." },
  { word: "\u26A0 INCONCLUSIVE", who: "Half back", text: "The software wouldn't run, the data was missing, or an independent rebuild disagreed. None of that counts against the paper, and every share pays back half." },
];

const SOURCES = [
  { who: "Famous papers we picked", text: "Well-known results, re-run from public data, like the minimum wage study and the debt paper that shaped budget cuts." },
  { who: "The scout", text: "An AI agent reads new research twice a day, checks that it can be re-run, and drafts a claim. It finds the paper's number, and a second AI must find the same one." },
  { who: "Anyone", text: "Suggest a paper, or fill in a claim yourself with the code, the data and the number." },
];

/** Three ways in, and one gate: nothing opens without a person's approval or the creator's deposit. */
export function ClaimSources() {
  return (
    <>
      <ul className="sources">
        {SOURCES.map((s) => (
          <li key={s.who}>
            <h3>{s.who}</h3>
            <p>{s.text}</p>
          </li>
        ))}
      </ul>
      <p className="hint">
        Every claim points to one exact version of the code and fingerprints its data, so nobody can swap them later. <Link href="/scout">See what the scout found</Link> or <Link href="/create">suggest a paper</Link>.
      </p>
    </>
  );
}

const JOBS = [
  { who: "People", jobs: ["Pick and approve claims", "Set the odds by forecasting", "Challenge a verdict they doubt"], never: "Can't change a verdict" },
  { who: "The AI", jobs: ["Fix setup problems when code won't run", "Write the short report", "Run the extra checks on each receipt"], never: "Can't touch data or model code, and never decides" },
  { who: "Plain code", jobs: ["Read the number from the output", "Compare it with the allowed margin", "Pay out on the blockchain"], never: "Does the same thing every time" },
];

/** Three columns: the point is that the verdict sits with the one column that can't have an opinion. */
export function WhoDoesWhat() {
  const reduce = useReducedMotion();
  return (
    <ul className="jobs">
      {JOBS.map((j, i) => (
        <motion.li key={j.who} initial={reduce ? false : { opacity: 0, y: 26 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.4 }} transition={{ duration: 0.45, delay: i * 0.15, ease: "easeOut" }}>
          <h3>{j.who}</h3>
          <ul>
            {j.jobs.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <p>{j.never}</p>
        </motion.li>
      ))}
    </ul>
  );
}

const WINDOW_STEPS = [
  { title: "The verdict posts", text: "Nothing pays out yet." },
  { title: "The window opens", text: "On claims open for forecasts, anyone has 24 hours. Say what looks wrong and put down a deposit." },
  { title: "A second run", text: "The Lab runs it again with a different AI model." },
];

/** The challenge path as a fork, with a real example of each ending. */
export function ChallengeStory() {
  return (
    <div className="story">
      <ol className="story-steps">
        {WINDOW_STEPS.map((s) => (
          <li key={s.title}>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </li>
        ))}
      </ol>
      <div className="story-fork">
        <div>
          <h3>Both runs agree</h3>
          <p>The verdict stands, and the challenger loses the deposit.</p>
          <Link href="/market/16">See it happen on claim 16</Link>
        </div>
        <div>
          <h3>The runs disagree</h3>
          <p>There&apos;s no verdict, every share pays back half, and the challenger gets the deposit back plus a reward.</p>
          <Link href="/market/18">See it happen on claim 18</Link>
        </div>
      </div>
      <p className="hint">If nobody challenges, anyone can make the verdict final once the time is up, and winners collect. Both examples are test claims, and their windows were only minutes long so we could run them through quickly.</p>
    </div>
  );
}

const CHECKS = [
  { title: "Open any receipt", text: "Your browser re-checks it there and then: the write-up against its fingerprint, the verdict against the numbers, and the AI's proof of secure hardware." },
  { title: "Read the blockchain", text: "Every claim, forecast and verdict is public on NEAR. This site only reads it." },
  { title: "Run it yourself", text: "Each claim lists the exact code version, commands and data fingerprints, so anyone can repeat the run." },
];

/** What a sceptic can do, and what isn't finished yet. */
export function SelfCheck() {
  return (
    <>
      <ul className="sources">
        {CHECKS.map((c) => (
          <li key={c.title}>
            <h3>{c.title}</h3>
            <p>{c.text}</p>
          </li>
        ))}
      </ul>
      <p className="notice" style={{ marginTop: 20, maxWidth: "66ch" }}>
        Where it stands today: everything runs on NEAR&apos;s test network with free points. The AI already runs on secure hardware. The Lab itself runs on an ordinary computer for now, and each receipt says so.
      </p>
    </>
  );
}

/** The possible verdicts, as receipts you can spread out and lift. */
export function VerdictFan() {
  return (
    <ul className="fan">
      {VERDICTS.map((v, i) => (
        <motion.li
          key={v.word}
          className="fan-card"
          style={{ zIndex: i }}
          initial={{ rotate: 0, x: 0, opacity: 0 }}
          whileInView={{ rotate: (i - 1) * 4, opacity: 1 }}
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
  { word: "Challenge", text: "If you think a result is wrong, you put down a deposit and the Lab must run it again with a different AI. You have a limited time, 24 hours on claims open for forecasts." },
  { word: "Points", text: "Free play money for forecasting without risk. Everyone can claim 1,000." },
  { word: "Test USDC", text: "A test token with no real value (tUSDC), used here to try real-money forecasting safely." },
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
        <div className="words-feed" aria-live="polite">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={word.word} className="words-paper" initial={{ clipPath: "inset(0 100% 0 0)" }} animate={{ clipPath: "inset(0 0% 0 0)" }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: "easeOut" }}>
              <strong>{word.word}</strong>
              <p>{word.text}</p>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
