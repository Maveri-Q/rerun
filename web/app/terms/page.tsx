import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta("Terms", "The short terms for forecasting on RERUN, with points or with money.", "/terms");

export default function TermsPage() {
  return (
    <div className="prose-page">
      <h1 className="page-title">Terms</h1>
      <p className="lede">The short version: this is a hackathon beta. Points are free and worth nothing. Use money only if you can afford to lose it.</p>

      <h2>Points</h2>
      <p>Points are free, can&apos;t be bought or transferred, and have no value.</p>

      <h2>Money mode</h2>
      <ul>
        <li>Money mode is in beta. You use real funds at your own risk, and only small amounts: at most 5 USDC a prediction and 50 USDC in a claim.</li>
        <li>You can lose everything you put into a forecast.</li>
        <li>The smart contracts are new and haven&apos;t been audited. A bug could lose funds.</li>
        <li>Don&apos;t use money mode if forecasting markets aren&apos;t allowed where you live, or if you&apos;re under 18. Checking that is up to you.</li>
      </ul>

      <h2>How results are decided</h2>
      <p>The rule set when a claim is posted decides its result, by comparing the rerun&apos;s number with the allowed margin. Anyone can challenge a result during the challenge window. Once it&apos;s final, the contract has no way to change it, even for us. We can pause new forecasts, but a pause can&apos;t stop you collecting.</p>

      <h2>What this isn&apos;t</h2>
      <p>Nothing here is financial, legal or scientific advice. A result says whether one number came out the same when the code and data were rerun. It doesn&apos;t say whether a study is right, or that its authors did anything wrong.</p>

      <h2>No warranty</h2>
      <p>RERUN is provided as it is, with no warranty. As far as the law allows, we aren&apos;t liable for losses from using it.</p>
    </div>
  );
}
