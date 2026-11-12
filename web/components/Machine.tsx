"use client";

import { APP_NAME } from "@rerun/shared/browser";
import { animate, AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import Link from "next/link";
import { memo, useEffect, useRef, useState } from "react";

const STEPS = [
  { short: "Claim", title: "A claim goes in.", text: "Someone picks a published result, like “93% accurate”. They point to the exact code and data, and set how close the Lab's number must get." },
  { short: "Forecast", title: "People weigh in.", text: "You forecast YES if you think it will hold up, NO if you don’t. Each forecast tips the scale, and that sets the chance everyone can see. It has no effect on the verdict." },
  { short: "Run", title: "The Lab seals itself in.", text: "The internet is cut and the code runs again. An AI may fix setup problems, like a wrong file path. It can’t touch the science, and plain code reads the final number." },
  { short: "Receipt", title: "A receipt comes out.", text: "The result goes on the blockchain, where nobody can change it. Anyone who disagrees then has 24 hours to challenge it, and a different AI runs it again." },
  { short: "Collect", title: "Right forecasts get paid.", text: "When the time is up, right forecasts pay out and wrong ones pay nothing. If the test couldn’t be run fairly, everyone gets half back." },
];

const N = STEPS.length;
// On a touch screen the finger already moves smoothly, so extra smoothing would only feel like lag.
const TOUCH = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
const BELT = 520;

type T = MotionValue<number>;

function useStation(p: T, i: number): T {
  return useTransform(p, [i / N + 0.008, (i + 1) / N - 0.03], [0, 1]);
}

/** Fades something in over one stretch of its station. */
function useIn(t: T, a: number, b: number) {
  return useTransform(t, [a, b], [0, 1]);
}

/* The claim itself. It stays with the camera the whole way, big at first, then small on the belt. */
const Claim = memo(function Claim({ p, t }: { p: T; t: T }) {
  const y = useTransform(p, [0, 0.135, 0.17], [0, 0, 200]);
  const scale = useTransform(p, [0, 0.135, 0.17], [1, 1, 0.2]);
  const opacity = useTransform(p, [0.41, 0.42], [1, 0]);
  const big = 1;
  const margin = useIn(t, 0.3, 0.42);
  const code = useIn(t, 0.46, 0.56);
  const codeX = useTransform(code, [0, 1], [-260, 0]);
  const data = useIn(t, 0.56, 0.66);
  const dataX = useTransform(data, [0, 1], [260, 0]);
  const lock = useIn(t, 0.68, 0.76);
  return (
    <g className="machine-drop">
    <motion.g style={{ y, scale, opacity }}>
      <rect x={0} y={-20} width={1000} height={620} fill="none" />
      <rect x={330} y={40} width={340} height={480} fill="var(--paper)" />
      <rect x={365} y={88} width={190} height={11} fill="var(--paper-ink)" />
      <rect x={365} y={110} width={260} height={6} fill="#c9c9c2" />
      <rect x={365} y={124} width={230} height={6} fill="#c9c9c2" />
      <motion.g style={{ opacity: big }}>
        <text x={365} y={232} fill="var(--paper-ink)" fontSize={96} fontWeight={500} fontFamily="var(--font-funnel-display)" letterSpacing={-3}>
          93%
        </text>
        <text x={368} y={266} fill="var(--paper-ink-2)" fontSize={24} fontFamily="var(--font-funnel-sans)">
          accurate, says the paper
        </text>
      </motion.g>
      <motion.g style={{ opacity: margin }}>
        <rect x={365} y={294} width={270} height={48} rx={24} fill="var(--paper-ink)" />
        <text x={500} y={325} fill="var(--mint)" fontSize={22} textAnchor="middle" fontFamily="var(--font-geist-mono)">
          counts if 91 to 95
        </text>
      </motion.g>
      <motion.g style={{ opacity: code, x: codeX }}>
        <rect x={365} y={366} width={126} height={52} rx={8} fill="none" stroke="var(--paper-ink)" strokeWidth={2} />
        <text x={428} y={400} fill="var(--paper-ink)" fontSize={22} textAnchor="middle" fontFamily="var(--font-geist-mono)">
          code
        </text>
      </motion.g>
      <motion.g style={{ opacity: data, x: dataX }}>
        <rect x={509} y={366} width={126} height={52} rx={8} fill="none" stroke="var(--paper-ink)" strokeWidth={2} />
        <text x={572} y={400} fill="var(--paper-ink)" fontSize={22} textAnchor="middle" fontFamily="var(--font-geist-mono)">
          data
        </text>
      </motion.g>
      <motion.g style={{ opacity: lock }}>
        <path d="M385 470v-14a16 16 0 0 1 32 0v14" fill="none" stroke="var(--paper-ink)" strokeWidth={3} />
        <rect x={377} y={468} width={48} height={34} rx={6} fill="var(--paper-ink)" />
        <text x={440} y={494} fill="var(--paper-ink)" fontSize={22} fontFamily="var(--font-funnel-sans)">
          Locked to this version
        </text>
      </motion.g>
    </motion.g>
    </g>
  );
});

const TOKENS = (() => {
  // A fixed order, so the scale wobbles the same way every time you scrub through it.
  const sides = "YYNYYNYYYNYNYYNYYNYYYNYY";
  let yes = 0;
  let no = 0;
  return [...sides].map((s, i) => {
    const side = s === "Y" ? 0 : 1;
    const n = side === 0 ? yes++ : no++;
    return { side, x: (side === 0 ? 280 : 720) + ((n % 5) - 2) * 30, stack: Math.floor(n / 5), start: 0.08 + (i / sides.length) * 0.72 };
  });
})();

function Token({ t, spec, offset }: { t: T; spec: (typeof TOKENS)[number]; offset: T }) {
  const land = 326 - spec.stack * 26;
  const cy = useTransform([t, offset], ([v, o]: number[]) => {
    const f = Math.min(Math.max((v! - spec.start) / 0.09, 0), 1);
    return -80 + f * f * (land + o! + 80);
  });
  const fill = spec.side === 0 ? "var(--mint)" : "var(--black)";
  return <motion.circle cx={spec.x} cy={cy} r={13} fill={fill} stroke={spec.side === 0 ? "var(--mint)" : "var(--ink)"} strokeWidth={2} />;
}

const Scale = memo(function Scale({ t }: { t: T }) {
  const weights = (v: number) => {
    let yes = 0;
    let no = 0;
    for (const s of TOKENS) {
      const f = Math.min(Math.max((v - s.start) / 0.09, 0), 1);
      if (s.side === 0) yes += f;
      else no += f;
    }
    return { yes, no };
  };
  const tilt = useTransform(t, (v) => {
    const { yes, no } = weights(v);
    return Math.max(Math.min((yes - no) * 1.4, 13), -13);
  });
  const rotate = useTransform(tilt, (d) => -d);
  const left = useTransform(tilt, (d) => Math.sin((d * Math.PI) / 180) * 220);
  const right = useTransform(left, (v) => -v);
  const chance = useTransform(t, (v) => {
    const { yes, no } = weights(v);
    return `${((100 * (yes + 8)) / (yes + no + 16)).toFixed(0)}%`;
  });
  const locked = useIn(t, 0.88, 0.95);
  return (
    <g>
      <text x={500} y={46} fill="var(--ink-3)" fontSize={22} textAnchor="middle" fontFamily="var(--font-funnel-sans)">
        Chance it holds up
      </text>
      <motion.text x={500} y={118} fill="var(--ink)" fontSize={72} textAnchor="middle" fontWeight={500} fontFamily="var(--font-funnel-display)">
        {chance}
      </motion.text>
      <rect x={496} y={150} width={8} height={330} fill="var(--line-strong)" />
      <rect x={440} y={BELT - 44} width={120} height={8} fill="var(--line-strong)" />
      <motion.g style={{ rotate }}>
        <rect x={270} y={146} width={460} height={8} rx={4} fill="var(--ink)" />
      </motion.g>
      <circle cx={500} cy={150} r={11} fill="var(--mint)" />
      {[
        { x: 280, off: left, label: "YES" },
        { x: 720, off: right, label: "NO" },
      ].map((pan) => (
        <motion.g key={pan.label} style={{ y: pan.off }}>
          <path d={`M${pan.x} 150L${pan.x - 90} 340M${pan.x} 150L${pan.x + 90} 340`} stroke="var(--line-strong)" strokeWidth={2} />
          <path d={`M${pan.x - 100} 340h200a100 34 0 0 1-200 0z`} fill="var(--surface-2)" stroke="var(--ink-2)" strokeWidth={2} />
          <text x={pan.x} y={368} fill="var(--ink)" fontSize={22} textAnchor="middle" fontWeight={600} fontFamily="var(--font-funnel-sans)">
            {pan.label}
          </text>
        </motion.g>
      ))}
      {TOKENS.map((s, i) => (
        <Token key={i} t={t} spec={s} offset={s.side === 0 ? left : right} />
      ))}
      <motion.g style={{ opacity: locked }}>
        <rect x={395} y={BELT - 120} width={210} height={42} rx={21} fill="var(--ink)" />
        <text x={500} y={BELT - 92} fill="var(--black)" fontSize={20} textAnchor="middle" fontFamily="var(--font-funnel-sans)" fontWeight={600}>
          Forecasting locked
        </text>
      </motion.g>
    </g>
  );
});

const CODE = ["model = LogisticRegression()", "X, y = load_trials(path)", "X_train, X_test = split(X, y)", "model.fit(X_train, y_train)", "score = model.score(X_test)", "print(score)", "# seed 42, no changes to the method"];

const Chamber = memo(function Chamber({ t }: { t: T }) {
  const doorY = useTransform(t, [0.04, 0.1], [-420, 0]);
  const plugY = useTransform(t, [0.14, 0.22], [0, -70]);
  const plugFade = useIn(t, 0.16, 0.24);
  const scroll = useTransform(t, [0.26, 0.9], [0, -70]);
  const bad = useTransform(t, [0.3, 0.36, 0.46, 0.5], [0, 1, 1, 0]);
  const good = useIn(t, 0.48, 0.52);
  const badge = useTransform(t, [0.36, 0.42, 0.56, 0.6], [0, 1, 1, 0]);
  const value = useTransform(t, [0.56, 0.82, 0.87, 0.91], [0.8, 0.965, 0.92, 0.93]);
  const needle = useTransform(value, [0.8, 1], [270, 730]);
  const reading = useTransform(value, (v) => v.toFixed(2));
  const done = useIn(t, 0.91, 0.95);
  return (
    <g>
      <motion.g style={{ y: plugY }}>
        <path d="M640 -60V34" stroke="var(--ink-2)" strokeWidth={4} fill="none" />
        <rect x={622} y={30} width={36} height={26} rx={3} fill="var(--ink-2)" />
      </motion.g>
      <motion.text x={688} y={46} fill="var(--mint)" fontSize={24} fontFamily="var(--font-funnel-sans)" style={{ opacity: plugFade }}>
        Internet off
      </motion.text>
      <rect x={220} y={60} width={560} height={BELT - 60} rx={10} fill="var(--surface)" stroke="var(--ink-2)" strokeWidth={3} />
      <clipPath id="machine-door">
        <rect x={223} y={63} width={554} height={BELT - 66} />
      </clipPath>
      <g clipPath="url(#machine-door)">
        <motion.g style={{ y: doorY }}>
          <rect x={223} y={63} width={554} height={BELT - 66} fill="var(--surface-2)" />
          <clipPath id="machine-screen">
            <rect x={256} y={92} width={488} height={196} />
          </clipPath>
          <rect x={256} y={92} width={488} height={196} rx={6} fill="var(--black)" />
          <g clipPath="url(#machine-screen)">
            <motion.g style={{ y: scroll }}>
              {CODE.map((line, i) => (
                <text key={line} x={276} y={128 + i * 34} fill="var(--ink-2)" fontSize={21} fontFamily="var(--font-geist-mono)">
                  {line}
                </text>
              ))}
              <motion.g style={{ opacity: bad }}>
                <rect x={268} y={140} width={466} height={32} fill="#3a1d18" />
                <text x={276} y={162} fill="var(--alert)" fontSize={21} fontFamily="var(--font-geist-mono)">
                  path = &quot;C:/my-laptop/trials.csv&quot;
                </text>
              </motion.g>
              <motion.g style={{ opacity: good }}>
                <rect x={268} y={140} width={466} height={32} fill="#16291e" />
                <text x={276} y={162} fill="var(--mint)" fontSize={21} fontFamily="var(--font-geist-mono)">
                  path = &quot;trials.csv&quot;
                </text>
              </motion.g>
            </motion.g>
          </g>
          <motion.g style={{ opacity: badge }}>
            <rect x={354} y={232} width={292} height={42} rx={21} fill="var(--mint)" />
            <text x={500} y={260} fill="var(--black)" fontSize={21} textAnchor="middle" fontWeight={600} fontFamily="var(--font-funnel-sans)">
              AI fixes the file path
            </text>
          </motion.g>

          <rect x={270} y={420} width={460} height={8} rx={4} fill="var(--line-strong)" />
          <rect x={poleX(0.91)} y={410} width={poleX(0.95) - poleX(0.91)} height={28} rx={4} fill="var(--mint)" opacity={0.85} />
          <text x={poleX(0.91)} y={470} fill="var(--ink-2)" fontSize={20} textAnchor="middle" fontFamily="var(--font-geist-mono)">
            0.91
          </text>
          <text x={poleX(0.95)} y={470} fill="var(--ink-2)" fontSize={20} textAnchor="middle" fontFamily="var(--font-geist-mono)">
            0.95
          </text>
          <motion.rect x={needle} y={398} width={4} height={52} fill="var(--ink)" />
          <motion.text x={500} y={378} fill="var(--ink)" fontSize={64} textAnchor="middle" fontWeight={500} fontFamily="var(--font-funnel-display)">
            {reading}
          </motion.text>
          <motion.text x={740} y={378} fill="var(--mint)" fontSize={22} textAnchor="end" fontFamily="var(--font-funnel-sans)" style={{ opacity: done }}>
            In range
          </motion.text>
          <text x={260} y={378} fill="var(--ink-3)" fontSize={20} fontFamily="var(--font-funnel-sans)">
            Lab got
          </text>
        </motion.g>
      </g>
    </g>
  );
});

function poleX(v: number) {
  return 270 + ((v - 0.8) / 0.2) * 460;
}

const BARS = [3, 1, 2, 4, 1, 1, 3, 2, 1, 4, 2, 1, 1, 3, 1, 2, 4, 1, 2, 1, 3, 1, 1, 2, 3, 1, 4, 2];

const Printer = memo(function Printer({ t }: { t: T }) {
  const paperY = useTransform(t, [0.05, 0.42], [-360, 0]);
  const fly = useIn(t, 0.46, 0.6);
  const flyX = useTransform(fly, [0, 1], [610, 767]);
  const flyY = useTransform(fly, [0, 0.5, 1], [320, 170, 240]);
  const flyOpacity = useTransform(fly, [0, 0.05, 0.95, 1], [0, 1, 1, 0]);
  const block = useIn(t, 0.58, 0.62);
  const chainText = useIn(t, 0.6, 0.66);
  const ringDraw = useTransform(t, [0.66, 0.96], [0, 1]);
  const ringText = useIn(t, 0.64, 0.7);
  let x = 408;
  return (
    <g>
      <rect x={300} y={56} width={400} height={56} rx={8} fill="var(--surface-2)" stroke="var(--ink-2)" strokeWidth={3} />
      <rect x={350} y={100} width={300} height={6} fill="var(--black)" />
      <circle cx={666} cy={78} r={6} fill="var(--mint)" />
      <clipPath id="machine-feed">
        <rect x={340} y={106} width={320} height={BELT - 106} />
      </clipPath>
      <g clipPath="url(#machine-feed)">
        <motion.g style={{ y: paperY }}>
          <path d="M376 106h248v344l-12.4 12-12.4-12-12.4 12-12.4-12-12.4 12-12.4-12-12.4 12-12.4-12-12.4 12-12.4-12-12.4 12-12.4-12-12.4 12-12.4-12-12.4 12-12.4-12-12.4 12-12.4-12-12.4 12-12.4-12z" fill="var(--paper)" />
          <text x={396} y={146} fill="var(--paper-ink)" fontSize={20} fontWeight={700} fontFamily="var(--font-geist-mono)">
            {APP_NAME}
          </text>
          <text x={604} y={146} fill="var(--paper-ink-2)" fontSize={18} textAnchor="end" fontFamily="var(--font-geist-mono)">
            CLAIM 0019
          </text>
          <path d="M396 162h208" stroke="var(--paper-ink)" strokeDasharray="4 4" />
          {[
            ["Paper says", "0.93"],
            ["Needs", "0.91 to 0.95"],
            ["Lab got", "0.93"],
          ].map(([a, b], i) => (
            <g key={a}>
              <text x={396} y={194 + i * 28} fill="var(--paper-ink-2)" fontSize={18} fontFamily="var(--font-geist-mono)">
                {a}
              </text>
              <text x={604} y={194 + i * 28} fill="var(--paper-ink)" fontSize={18} textAnchor="end" fontFamily="var(--font-geist-mono)">
                {b}
              </text>
            </g>
          ))}
          <path d="M396 262h208" stroke="var(--paper-ink)" strokeDasharray="4 4" />
          <text x={396} y={324} fill="var(--paper-ink)" fontSize={50} fontWeight={600} letterSpacing={-1.5} fontFamily="var(--font-funnel-display)">
            HELD UP
          </text>
          <path d="M396 346h208" stroke="var(--paper-ink)" strokeDasharray="4 4" />
          {BARS.map((w) => {
            const at = x;
            x += w * 2 + 3.2;
            return <rect key={`${at}`} x={at - 12} y={362} width={w * 2} height={64} fill="var(--paper-ink)" />;
          })}
        </motion.g>
      </g>

      <motion.rect x={flyX} y={flyY} width={22} height={22} rx={3} fill="var(--mint)" style={{ opacity: flyOpacity }} />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={645 + i * 62} y={224} width={46} height={46} rx={6} fill="none" stroke={i === 2 ? "transparent" : "var(--ink-3)"} strokeWidth={2} />
          {i < 2 && <path d={`M${691 + i * 62} 247h16`} stroke="var(--ink-3)" strokeWidth={2} />}
        </g>
      ))}
      <motion.g style={{ opacity: block }}>
        <rect x={769} y={224} width={46} height={46} rx={6} fill="var(--mint)" />
      </motion.g>
      <motion.text x={645} y={306} fill="var(--ink)" fontSize={21} fontFamily="var(--font-funnel-sans)" style={{ opacity: chainText }}>
        On the blockchain
      </motion.text>
      <motion.g style={{ opacity: ringText }}>
        <circle cx={270} cy={246} r={54} fill="none" stroke="var(--line-strong)" strokeWidth={6} />
        <motion.circle cx={270} cy={246} r={54} fill="none" stroke="var(--mint)" strokeWidth={6} strokeLinecap="round" transform="rotate(-90 270 246)" style={{ pathLength: ringDraw }} />
        <text x={270} y={332} fill="var(--ink)" fontSize={21} textAnchor="middle" fontFamily="var(--font-funnel-sans)">
          Time to challenge
        </text>
      </motion.g>
    </g>
  );
});

const COINS = Array.from({ length: 18 }, (_, i) => ({ i, start: 0.08 + (i / 18) * 0.62, row: i % 6, col: Math.floor(i / 6) }));

function Coin({ t, c }: { t: T; c: (typeof COINS)[number] }) {
  const f = useTransform(t, [c.start, c.start + 0.12], [0, 1]);
  const toX = 212 + c.col * 62;
  const toY = 500 - c.row * 18;
  const cx = useTransform(f, (v) => 500 + (toX - 500) * v);
  const cy = useTransform(f, (v) => 340 + (toY - 340) * v - Math.sin(v * Math.PI) * 150);
  const opacity = useTransform(f, [0, 0.03], [0, 1]);
  return <motion.ellipse cx={cx} cy={cy} rx={24} ry={9} fill="var(--mint)" stroke="var(--black)" strokeWidth={2} style={{ opacity }} />;
}

const Collect = memo(function Collect({ t }: { t: T }) {
  const total = useTransform(t, [0.08, 0.82], [0, 100]);
  const paid = useTransform(total, (v) => `+${v.toFixed(0)}`);
  const lost = useTransform(t, [0.12, 0.7], [1, 0]);
  const sink = useTransform(t, [0.12, 0.7], [0, 46]);
  return (
    <g>
      <rect x={410} y={300} width={180} height={220} fill="var(--paper)" />
      <text x={500} y={352} fill="var(--paper-ink-2)" fontSize={18} textAnchor="middle" fontFamily="var(--font-geist-mono)">
        Verdict
      </text>
      <text x={500} y={408} fill="var(--paper-ink)" fontSize={34} textAnchor="middle" fontWeight={600} fontFamily="var(--font-funnel-display)">
        HELD UP
      </text>
      <rect x={436} y={440} width={128} height={40} fill="var(--paper-ink)" />
      {COINS.map((c) => (
        <Coin key={c.i} t={t} c={c} />
      ))}
      <motion.text x={285} y={232} fill="var(--mint)" fontSize={72} textAnchor="middle" fontWeight={500} fontFamily="var(--font-funnel-display)">
        {paid}
      </motion.text>
      <text x={285} y={272} fill="var(--ink-2)" fontSize={21} textAnchor="middle" fontFamily="var(--font-funnel-sans)">
        YES forecasts paid
      </text>
      <motion.g style={{ opacity: lost, y: sink }}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <circle key={i} cx={650 + (i % 4) * 34} cy={490 - Math.floor(i / 4) * 30} r={14} fill="var(--black)" stroke="var(--ink)" strokeWidth={2} />
        ))}
      </motion.g>
      <text x={710} y={272} fill="var(--ink-2)" fontSize={20} textAnchor="middle" fontFamily="var(--font-funnel-sans)">
        NO shares pay nothing
      </text>
    </g>
  );
});

function Bar({ p, i, onJump, label, current }: { p: T; i: number; onJump: () => void; label: string; current: boolean }) {
  const scaleX = useTransform(p, [i / N, (i + 1) / N], [0, 1]);
  return (
    <button className="machine-bar" aria-current={current ? "step" : undefined} onClick={onJump}>
      <span className="machine-bar-track">
        <motion.i style={{ scaleX }} />
      </span>
      {label}
    </button>
  );
}

/** One claim's whole journey, as a single machine you scrub through by scrolling. */
export function Machine() {
  const reduce = useReducedMotion();
  const box = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: box, offset: ["start start", "end end"] });
  const p = useSpring(scrollYProgress, TOUCH ? { stiffness: 900, damping: 80 } : { stiffness: 140, damping: 30, mass: 0.4 });
  const cam = useTransform(p, [0, 0.165, 0.2, 0.365, 0.4, 0.565, 0.6, 0.765, 0.8, 1], [0, 0, -1000, -1000, -2000, -2000, -3000, -3000, -4000, -4000]);
  const beltTicks = useTransform(cam, (v) => -v);
  const camShift = useTransform(cam, (v) => `${v / 10}%`);
  const [step, setStep] = useState(0);
  const [intro, setIntro] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const player = useRef<ReturnType<typeof animate> | null>(null);

  const t0 = useStation(p, 0);
  const t1 = useStation(p, 1);
  const t2 = useStation(p, 2);
  const t3 = useStation(p, 3);
  const t4 = useStation(p, 4);

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    setStep(Math.min(Math.floor(v * N), N - 1));
    setIntro(v < 0.012);
  });

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const stop = () => {
    player.current?.stop();
    player.current = null;
    setPlaying(false);
  };

  useEffect(() => {
    if (!playing) return;
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", stop);
    return () => {
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [playing]);

  const span = () => {
    const el = box.current!;
    const top = el.getBoundingClientRect().top + window.scrollY;
    return { top, end: top + el.offsetHeight - window.innerHeight };
  };

  const play = () => {
    if (playing) return stop();
    const { top, end } = span();
    const from = window.scrollY >= end - 4 || window.scrollY < top ? top : window.scrollY;
    setPlaying(true);
    player.current = animate(from, end, {
      duration: 34 * ((end - from) / Math.max(end - top, 1)),
      ease: "linear",
      onUpdate: (v) => window.scrollTo(0, v),
      onComplete: () => setPlaying(false),
    });
  };

  const jump = (i: number) => {
    stop();
    const { top, end } = span();
    window.scrollTo({ top: top + (end - top) * ((i + 0.02) / N), behavior: "smooth" });
  };

  const viewBox = narrow ? "170 20 660 560" : "0 0 1000 620";

  const list = (
    <ol className={reduce ? "how-steps" : "sr-only"}>
      {STEPS.map((s) => (
        <li key={s.short}>
          <h3>{s.title}</h3>
          <p>{s.text}</p>
        </li>
      ))}
    </ol>
  );

  if (reduce) return list;

  return (
    <section ref={box} className="machine" aria-label={`How a claim moves through ${APP_NAME}`}>
      {list}
      <div className="machine-stage">
        {/* Each station is its own layer, so moving the camera doesn't redraw anything. */}
        <div className="machine-svg" aria-hidden="true">
          <svg viewBox={viewBox}>
            <path d={`M-1400 ${BELT}H2400`} stroke="var(--ink-2)" strokeWidth={3} />
            <motion.path d={`M-1400 ${BELT + 14}H2400`} stroke="var(--line-strong)" strokeWidth={10} strokeDasharray="3 37" style={{ strokeDashoffset: beltTicks }} />
          </svg>
          <motion.div className="machine-cam" style={{ x: camShift }}>
            {[
              <Scale key="scale" t={t1} />,
              <Chamber key="chamber" t={t2} />,
              <Printer key="printer" t={t3} />,
              <Collect key="collect" t={t4} />,
            ].map((station, i) => (
              <div key={i} className="machine-station" style={{ left: `${(i + 1) * 100}%`, display: Math.abs(step - (i + 1)) <= 1 ? undefined : "none" }}>
                <svg viewBox={viewBox}>{station}</svg>
              </div>
            ))}
          </motion.div>
          <svg viewBox={viewBox} style={{ display: step <= 2 ? undefined : "none" }}>
            <Claim p={p} t={t0} />
          </svg>
        </div>
        <div className="machine-copy">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={intro ? "intro" : step} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.18 }}>
              {intro ? (
                <>
                  <h1>One claim goes in. A receipt comes out.</h1>
                  <p>Many published results don&apos;t hold up, but checking takes months and nobody is paid to do it. So we built a machine that does. Scroll, and follow one claim all the way through. <span className="machine-hint" aria-hidden="true">↓</span></p>
                </>
              ) : (
                <>
                  <h2>{STEPS[step]!.title}</h2>
                  <p>{STEPS[step]!.text}</p>
                </>
              )}
            </motion.div>
          </AnimatePresence>
          <div className="machine-actions">
            <button className="quiet btn--small" onClick={play}>
              {playing ? "Pause" : step === N - 1 ? "Run it again" : "Play it for me"}
            </button>
            {step === N - 1 && (
              <Link className="btn btn--small" href="/#claims">
                See the claims
              </Link>
            )}
          </div>
        </div>
        <nav className="machine-bars" aria-label="Steps">
          {STEPS.map((s, i) => (
            <Bar key={s.short} p={scrollYProgress} i={i} label={s.short} current={i === step} onJump={() => jump(i)} />
          ))}
        </nav>
      </div>
    </section>
  );
}
