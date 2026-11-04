import Link from "next/link";

const VERDICTS = [
  { name: "Reproduced", text: "The code ran and got a number inside the claim's range. YES wins." },
  { name: "Not reproduced", text: "The code ran, but the number came out outside the range. NO wins." },
  { name: "Broken", text: "The code can't run, even after fixing setup problems. NO wins." },
  { name: "Invalid", text: "The test wasn't fair, for example because the data changed. Everyone gets half their shares' value back." },
];

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
  { word: "Secure hardware (TEE)", text: "A protected part of a computer. It produces proof of what code is running there, and keeps data hidden, even from whoever runs the computer." },
];

export default function HowPage() {
  return (
    <div className="prose">
      <h1 style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>How it works</h1>
      <p className="lede">
        Scientists publish results like &quot;our model is 93% accurate&quot;. Many results don&apos;t hold up when someone checks, but checking takes months and nobody is paid to do it, so it rarely happens.
      </p>
      <p>Here, people predict whether a result will hold up, and an AI lab tests it by re-running the authors&apos; own code and data. Everything the Lab did is recorded publicly, so nobody has to take its word for it.</p>

      <section className="section">
        <div className="section-head">
          <h2>What happens to a claim</h2>
        </div>
        <ol className="how-steps">
          <li>
            <h3>Someone opens a claim</h3>
            <p>They pick a result, link the exact code and data, and set how close a re-run must get.</p>
          </li>
          <li>
            <h3>People make forecasts</h3>
            <p>You buy YES or NO with free points or test money. The chance moves as people trade.</p>
          </li>
          <li>
            <h3>The Lab re-runs it</h3>
            <p>When the claim locks, the Lab runs the code with the internet cut off. An AI may fix setup problems, like a wrong file path. It can&apos;t touch the science, and plain code reads the final number.</p>
          </li>
          <li>
            <h3>The verdict is posted</h3>
            <p>A receipt goes on the blockchain. Anyone who disagrees can challenge it for a limited time.</p>
          </li>
          <li>
            <h3>Winners collect</h3>
            <p>Once the time is up, winning shares pay out. Go to the claim and select Collect, or find it in your Portfolio.</p>
          </li>
        </ol>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>What the verdicts mean</h2>
        </div>
        <dl className="defs" style={{ gridTemplateColumns: "150px minmax(0, 1fr)" }}>
          {VERDICTS.map((v) => (
            <div key={v.name} style={{ display: "contents" }}>
              <dt>{v.name}</dt>
              <dd>{v.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>What this can and can&apos;t tell you</h2>
        </div>
        <p>A verdict tells you whether the authors&apos; code and data produce the number they published. That doesn&apos;t prove the science is true: a study can reproduce and still reach a wrong conclusion. It also can&apos;t re-run physical experiments, like a drug trial, though it can re-check their analysis when the data and code are available.</p>
        <p>
          So each receipt also shows extra evidence: a stress test for luck, and an experimental rebuild from the paper&apos;s description. You can also <Link href="/check">check a paper&apos;s printed numbers</Link> with no code at all.
        </p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Words you&apos;ll see</h2>
        </div>
        <dl className="defs" style={{ gridTemplateColumns: "170px minmax(0, 1fr)" }}>
          {WORDS.map((w) => (
            <div key={w.word} style={{ display: "contents" }}>
              <dt>{w.word}</dt>
              <dd>{w.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p style={{ marginTop: 32 }}>
        <Link className="btn" href="/">
          See the claims
        </Link>
      </p>
    </div>
  );
}
