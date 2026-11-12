/**
 * Whose code each real claim runs, and why. Keyed by the claim's fingerprint, so a claim can't pick
 * up another's label. This lives on the site rather than the blockchain so the explanation can be
 * corrected. lab/orchestrator/src/demo/real.test.ts checks these fingerprints against claims/real.
 */

export type CodeOrigin = "authors" | "rebuild" | "critics";

export interface Provenance {
  name: string;
  origin: CodeOrigin;
  /** The one claim the site leads with. It must run the authors' own code. */
  flagship?: boolean;
  why: { heading: string; text: string; link?: { label: string; href: string } };
  /** A real run happened while this claim was still open for forecasts. Shown on its page. */
  testRunEarly?: boolean;
  /** What the paper says, word for word, and where. */
  paperSays?: { quote: string; where: string; href: string };
  /** What the study said, as a sentence anyone can follow, and what its number counts. */
  plain?: { said: string; unit: string };
  /** Its place in the main list on the home page. Lower comes first. */
  order?: number;
  /** Listed lower down, under "More science". */
  science?: boolean;
  /** Stays off the lists until it's settled, because another claim already gives its answer away. */
  hideUntilFinal?: boolean;
  /** One line on why anyone should care. */
  whyItMatters?: string;
  /** The finding as a question in everyday words. */
  question?: string;
  /** The paper whose citations are counted on its pages. */
  citeDoi?: string;
  /** Numbers that only make sense side by side, each with what produced it. */
  numbers?: { value: string; label: string; detail: string }[];
  /** Outside sources for what the page says about the authors. */
  sources?: { label: string; href: string }[];
  /** A result that holds up as a number but moves a lot with honest choices. Shown as "Fragile". */
  fragile?: string;
  /** Posted with the result already known, so nobody forecast it. */
  settledShowcase?: boolean;
  /** Extra limits for this claim, added to the standard list. */
  notChecked?: string[];
}

/** True of every claim, because the Lab only reruns code. */
export const NEVER_CHECKED = [
  "Whether the sample was fair or large enough.",
  "Whether test data leaked into training or tuning.",
  "Whether the result holds on new data.",
  "Whether the study's method was the right one for its question.",
];

/** The price comes from forecasters and the verdict comes from the rerun. Neither touches the other. */
export const PRICE_RULE = "The forecast price never changes the verdict.";

export const ORIGIN_LABEL: Record<CodeOrigin, string> = {
  authors: "Authors' own code",
  rebuild: "Independent rebuild",
  critics: "Critics' code on the authors' data",
};

export const PROVENANCE: Record<string, Provenance> = {
  "53d87974c67eef8008149ef40f0448812042bff87db91a0683551e921a3b2e75": {
    name: "parkinsons-authors",
    science: true,
    plain: { said: "The study said the brain's wiring predicts where Parkinson's-like damage spreads in mice.", unit: "match score, where 1 is perfect" },
    origin: "authors",
    question: "Does the brain's wiring predict where Parkinson's spreads?",
    citeDoi: "10.1038/s41593-019-0457-5",
    settledShowcase: true,
    paperSays: { quote: "Pearson's r 0.696 (Henderson et al.)", where: "Table 2 of the ReScience C article, which quotes the original paper", href: "https://doi.org/10.1038/s41593-019-0457-5" },
    whyItMatters: "If the brain's wiring predicts where Parkinson's spreads, it gives researchers a map of what to protect.",
    notChecked: ["Whether results in mice carry over to people."],
    why: {
      heading: "Whose code is this?",
      text: "Henderson and colleagues' own R code, run on their published data with packages from the date of the code. It's a settled showcase, so there was no forecasting. The same result also came from an independent rebuild (claim 21).",
      link: { label: "See the code", href: "https://github.com/ejcorn/connectome_diffusion" },
    },
  },
  "6450bf0ac8d633cb663e2c8ebeb33fde42b6dd75dcfeee3d3ecc3333a8d6eb1b": {
    name: "card-krueger",
    order: 5,
    plain: { said: "The study said raising New Jersey's minimum wage didn't cost fast-food jobs.", unit: "jobs per store" },
    origin: "rebuild",
    question: "Does raising the minimum wage cost jobs?",
    settledShowcase: true,
    paperSays: { quote: "Change in mean FTE employment: PA -2.16, NJ 0.59, difference 2.76", where: "Table 3, row 3, page 780 of the paper", href: "https://davidcard.berkeley.edu/papers/njmin-aer.pdf" },
    whyItMatters: "This study changed how economists and lawmakers argue about raising the minimum wage.",
    notChecked: ["Whether these stores and months say anything about other places or times.", "Whether payroll records tell the same story, which later papers argued over."],
    why: {
      heading: "Whose code is this?",
      text: "Our own small program, written from the paper and the authors' codebook and run on their public survey data. It isn't the authors' code. It got 2.7536 against the paper's 2.76, inside the allowed margin of 0.05, and the store averages for both states match Table 3. It's a settled showcase, so there was no forecasting.",
      link: { label: "See the code", href: "https://github.com/Maveri-Q/rerun-rebuilds" },
    },
  },
  "fa35d7e5ffd002b0b8496bed8020579611c19cef349d5ec4658021a5b04bf3d7": {
    name: "reinhart-rogoff",
    order: 1,
    flagship: true,
    plain: { said: "The study said rich countries with very high government debt stop growing.", unit: "% growth a year" },
    origin: "critics",
    question: "Does high government debt kill growth?",
    citeDoi: "10.1257/aer.100.2.573",
    settledShowcase: true,
    paperSays: { quote: "Average 1946-2009 4.1 2.8 2.8 -0.1", where: "Summary table for advanced economies, last column is 90 percent and above, in the working paper version (NBER w15639)", href: "https://doi.org/10.3386/w15639" },
    whyItMatters: "After 2008, politicians pointed to the 90 percent line when they argued for cutting budgets.",
    numbers: [
      { value: "\u22120.1%", label: "Reproduced with the original spreadsheet error and choices", detail: "The run printed -0.06206." },
      { value: "2.2%", label: "Corrected", detail: "The run printed 2.168. This fixes the spreadsheet error and also changes which years count and how countries are weighed, as the critics argue it should." },
    ],
    sources: [
      { label: "Reuters, 22 April 2013, via Daily FT", href: "https://www.ft.lk/financial-services/influential-economists-acknowledge-errors-in-debt-paper/42-147010" },
      { label: "The Harvard Crimson, April 2013", href: "https://thecrimson.com/article/2013/4/24/rogoff-error-defense" },
    ],
    notChecked: ["Whether high debt slows growth, or slow growth raises debt.", "Whether the critics' choices about years and weights are the only fair ones."],
    why: {
      heading: "Whose code is this?",
      text: "Herndon, Ash and Pollin's R code, run on the data Reinhart and Rogoff gave them. It isn't the authors' own code, and the label says so. Reinhart and Rogoff acknowledged the spreadsheet error in 2013, and said it doesn't change their central message. It's a settled showcase, so there was no forecasting.",
      link: { label: "See the code", href: "https://github.com/michaelaoash/HAP-RR-git" },
    },
  },
  "a942a4e8eee4390f46ae932c48d15ccd0c83ebc0a39eab408c50e054088f6986": {
    name: "wildfire-water",
    science: true,
    plain: { said: "The study said temperature explains about 15% of how much water northern forests lose after a fire.", unit: "share explained" },
    origin: "authors",
    question: "Does temperature explain how much water forests lose after a wildfire?",
    citeDoi: "10.5281/zenodo.4617894",
    testRunEarly: true,
    paperSays: { quote: "Multiple R-Squared: 0.1495", where: "The author's 2008 output file, line 251, for ET ~ Tavg", href: "https://github.com/bpbond/ten-years-paper33/blob/c28b8a2e3149f7d90f2dc0179f9c976785e762b1/original/R%20output.txt#L251" },
    whyItMatters: "Wildfires are reshaping northern forests, and how much water those forests lose matters for climate models.",
    why: {
      heading: "Whose code is this?",
      text: "The lead author's original script from 2008, run unchanged on the published data. Nobody rewrote it.",
      link: { label: "See the code", href: "https://github.com/bpbond/ten-years-paper33" },
    },
  },
  "f63ef50e89f8221d51bde13cebd576b5b89b56f82842ae5fb33321418db60774": {
    name: "parkinsons-spread",
    science: true,
    hideUntilFinal: true,
    plain: { said: "The study said the brain's wiring predicts where Parkinson's-like damage spreads in mice.", unit: "match score, where 1 is perfect" },
    question: "Does the brain's wiring predict where Parkinson's spreads? A separate rebuild",
    citeDoi: "10.1038/s41593-019-0457-5",
    origin: "rebuild",
    testRunEarly: true,
    paperSays: { quote: "Pearson's r 0.696 (Henderson et al.), 0.696 (Replication)", where: "Table 2 of the ReScience C article", href: "https://doi.org/10.5281/zenodo.5379631" },
    whyItMatters: "If the brain's wiring predicts where Parkinson's spreads, it gives researchers a map of what to protect.",
    notChecked: ["Whether results in mice carry over to people."],
    why: {
      heading: "Why not the authors' own code?",
      text: "It wasn't missing. Henderson and colleagues published their code openly, in R and MATLAB, under an MIT licence. This claim runs a separate Python rebuild, written by other researchers and published in a peer-reviewed journal, because we chose it before checking the original closely. MATLAB turns out to be used only for a side analysis. We have since run the authors' R code too, with no AI: it gave 0.69605, the same as this rebuild. That's claim 24.",
      link: { label: "See the authors' code result", href: "/market/24" },
    },
  },
  "c4a9b60c770317e5f7ec3aacbac1513bd2f133958bb226d29762fa2a39ae86d1": {
    name: "budworm-timing",
    science: true,
    plain: { said: "A 1991 study gave one number for how a forest pest develops as the season warms.", unit: "model setting" },
    question: "Does a 1991 model get the timing of a forest pest right?",
    citeDoi: "10.5281/zenodo.5006005",
    origin: "rebuild",
    testRunEarly: true,
    paperSays: { quote: "Original -0.0457, logit", where: "Table 2 of the ReScience C article", href: "https://doi.org/10.5281/zenodo.5006005" },
    whyItMatters: "Spruce budworm defoliates millions of hectares of forest, so predicting its timing decides when to act.",
    why: {
      heading: "Why not the authors' own code?",
      text: "The original analyses from 1986 and 1991 were written for SAS and GLIM, older statistics software the Lab can't run. SAS is also paid. This claim runs a rebuild in R by another researcher, published in a peer-reviewed journal.",
      link: { label: "See the rebuild, which includes the original code", href: "https://github.com/pboesu/replication_candy_1991" },
    },
  },
  "19ef61085d1bfae1011de7c8c5006c243a97c56f2066c7bbea8d1179e60c8a0f": {
    name: "budworm-spread",
    science: true,
    plain: { said: "A 1986 study gave one number for how spread out a forest pest's development is.", unit: "model setting" },
    question: "Does a 1986 figure for a forest pest's timing hold up?",
    citeDoi: "10.5281/zenodo.5006005",
    origin: "rebuild",
    testRunEarly: true,
    paperSays: { quote: "dennis_par = c(\u2026, 599.57, 1.559)", where: "The last value on this line is from Kemp et al. 1986, Table 1, copied into the replication's code", href: "https://github.com/pboesu/replication_candy_1991/blob/98329d447ef025c260879f28316015fc0b24fb08/code/03_fit_dennis_et_al_model.R" },
    whyItMatters: "Spruce budworm strips forests across North America. Can a rebuild land on a number printed in a table 40 years ago?",
    why: {
      heading: "Why not the authors' own code?",
      text: "The original analyses from 1986 and 1991 were written for SAS and GLIM, older statistics software the Lab can't run. SAS is also paid. This claim runs a rebuild in R by another researcher, published in a peer-reviewed journal.",
      link: { label: "See the rebuild, which includes the original code", href: "https://github.com/pboesu/replication_candy_1991" },
    },
  },
  "6358604970557ec5362053d098a463da55a001913553b5e11490e153e155a823": {
    name: "red-cards",
    order: 2,
    plain: { said: "The study gave 29 teams the same football data, and their middle answer was that dark-skinned players get red cards at 1.31 times the odds.", unit: "times the odds" },
    origin: "rebuild",
    question: "Do referees give dark-skinned footballers more red cards?",
    citeDoi: "10.1177/2515245917747646",
    settledShowcase: true,
    fragile: "29 teams, same data, different answers: from 0.89 to 2.93 times the odds. 20 teams found an effect and 9 didn't. The Lab's retrace confirms what the teams reported, not which answer is right.",
    paperSays: { quote: "effect sizes ranged from 0.89 to 2.93 ( Mdn = 1.31) in odds-ratio units", where: "Abstract of the paper, which also says 20 teams found a significant effect and 9 did not", href: "https://doi.org/10.1177/2515245917747646" },
    whyItMatters: "Reasonable researchers can take one data set and reach different answers. This study is the clearest proof of that.",
    notChecked: ["The 29 teams' own analyses. We only recompute the summary from their published answers.", "Which team's method is the best one."],
    why: {
      heading: "Whose code is this?",
      text: "Our own small program, run on the project's published table of each team's answer. It isn't the authors' code, and it doesn't redo the 29 analyses. It got a median of 1.31, with the same range and the same 20 and 9 as the paper. It's a settled showcase, so there was no forecasting.",
      link: { label: "See the code", href: "https://github.com/Maveri-Q/rerun-rebuilds" },
    },
  },
  "2a325a5acb04febe5efd5b805632cf8c44cab27f04b1a5cad7497defedaaf8cf": {
    name: "names-on-cvs",
    order: 3,
    plain: { said: "The study said CVs with white-sounding names got 50% more callbacks than similar CVs with Black-sounding names.", unit: "times the callbacks" },
    origin: "rebuild",
    question: "Does the name on a CV change who gets a callback?",
    citeDoi: "10.1257/0002828042002561",
    settledShowcase: true,
    paperSays: { quote: "All sent resumes: 10.06%, 6.70%, ratio 1.50", where: "Table 1, first row, of the working paper (NBER 9873)", href: "https://www.nber.org/papers/w9873" },
    whyItMatters: "It's one of the best-known experiments on hiring, and it's still cited whenever people argue about anonymous CVs.",
    notChecked: ["Whether the same gap exists today, or outside Boston and Chicago in 2001 and 2002.", "Whether the names signal only race, and not also class."],
    why: {
      heading: "Whose code is this?",
      text: "Our own small program, run on a public copy of the experiment's data from OpenIntro. It isn't the authors' code. It got a ratio of 1.4968 against the paper's 1.50. The working paper's table has 2,445 CVs in each group and this data has 2,435, so the two percentages differ a little (9.65% and 6.45% here). It's a settled showcase, so there was no forecasting.",
      link: { label: "See the code", href: "https://github.com/Maveri-Q/rerun-rebuilds" },
    },
  },
  "90a002bd7f0b85c8e04421cea8fca462082b99eba380cb2ce19807bcaed030fb": {
    name: "reproducibility-project",
    order: 4,
    plain: { said: "The study repeated about 100 psychology studies, and said only 36% got a significant result again.", unit: "% significant again" },
    origin: "rebuild",
    question: "How much psychology research holds up when it's repeated?",
    citeDoi: "10.1126/science.aac4716",
    settledShowcase: true,
    paperSays: { quote: "Thirty-six percent of replications had statistically significant results", where: "Abstract of the paper. The authors' own script prints 35/97", href: "https://doi.org/10.1126/science.aac4716" },
    whyItMatters: "This is the study that made the replication crisis front-page news, and it's why a site like this exists.",
    notChecked: ["The 100 experiments themselves. We only recount the project's own results table.", "Whether statistical significance is the right test of a repeat. The paper gives other measures too."],
    why: {
      heading: "Whose code is this?",
      text: "Our own small program, run on the project's public results table. It isn't the authors' code, and it doesn't redo the experiments. It counted 35 of 97, which is 36.08%, the same count the authors' own script prints. It's a settled showcase, so there was no forecasting.",
      link: { label: "See the code", href: "https://github.com/Maveri-Q/rerun-rebuilds" },
    },
  },
  "9dec5a93332271dd854ae721e75ba32855be56a09e8781adaa1407fec5f90597": {
    name: "class-size",
    order: 6,
    plain: { said: "The study said first graders put in small classes scored about 8.6 percentile points higher.", unit: "percentile points" },
    origin: "rebuild",
    question: "Do small classes help young children learn?",
    citeDoi: "10.1162/003355399556052",
    settledShowcase: true,
    paperSays: { quote: "Small Class 8.57 (1.97)", where: "Table 6, panel B, column 1, of the working paper (NBER 6051), read from the page image", href: "https://www.nber.org/papers/w6051" },
    whyItMatters: "Tennessee's experiment is the study people reach for whenever schools argue about class sizes.",
    notChecked: ["Whether the gain lasts, or what happens in other places.", "The published journal table, which isn't free to read. We used the working paper's."],
    why: {
      heading: "Whose code is this?",
      text: "Our own small program, run on a public copy of the data, which has only reading and maths scores. It isn't the author's code, and it can't match exactly. It got 8.52 against 8.57 for first grade. The other grades are 4.93 against 4.82 in kindergarten, 5.95 against 5.93 in second grade, and 5.68 against 5.32 in third, which is outside the margin we used. We chose first grade because it's the largest gain. It's a settled showcase, so there was no forecasting.",
      link: { label: "See the code", href: "https://github.com/Maveri-Q/rerun-rebuilds" },
    },
  },
  "d0b259198cc3c2ace78fbff438c2e074547728ad977b6141efd77f63b76c31dd": {
    name: "looks-and-ratings",
    order: 7,
    plain: { said: "The study said better-looking professors get higher student ratings.", unit: "rating points per point of looks" },
    origin: "rebuild",
    question: "Do better-looking professors get better student ratings?",
    citeDoi: "10.1016/j.econedurev.2004.07.013",
    settledShowcase: true,
    paperSays: { quote: "Composite standardized beauty 0.275", where: "Table 3, column 1, of the working paper (NBER 9853)", href: "https://www.nber.org/papers/w9853" },
    whyItMatters: "Student ratings can decide who gets hired and promoted, so it matters what else they pick up.",
    notChecked: ["Whether better teaching and better looks go together for some other reason.", "Whether this holds beyond one university in the early 2000s."],
    why: {
      heading: "Whose code is this?",
      text: "Our own small program, run on a public copy of the authors' data. It isn't the authors' code. It got 0.2748 against the paper's 0.275, and the other five numbers in that column match too. It's a settled showcase, so there was no forecasting.",
      link: { label: "See the code", href: "https://github.com/Maveri-Q/rerun-rebuilds" },
    },
  },
  "3a87812133ada0a5f6a7b1cf3ad2a15907d1945b8fdbe683e392903c02a9e5c3": {
    name: "third-child",
    order: -2,
    plain: { said: "The study said parents whose first two children were both boys or both girls were 6.8 points more likely to have a third.", unit: "share of families, 0 to 1" },
    origin: "rebuild",
    question: "Do parents of two boys or two girls try for a third child more often?",
    citeDoi: "10.3386/w5778",
    paperSays: { quote: "difference (2) - (1) 0.068 (0.002)", where: "Table 3 (continued), married women, 1980 census, of the working paper (NBER 5778), read from the page image", href: "https://www.nber.org/papers/w5778" },
    whyItMatters: "Economists use this nudge to a bigger family as a natural experiment, to measure how children change their parents' working lives.",
    notChecked: ["Why parents do it. The study only counts births.", "Whether it still holds today. The data are from 1980."],
    why: {
      heading: "Whose code is this?",
      text: "Our own small program, run on a public copy of the paper's data: the same 254,654 married women. It isn't the authors' code. Nobody has run it on the real data yet, us included. It was tested only on made-up data with a known answer, and the Lab runs it once forecasting closes.",
      link: { label: "See the code", href: "https://github.com/Maveri-Q/rerun-rebuilds/tree/main/third-child-1998" },
    },
  },
  "54627c1f8e08c7254bd35014e11f39bf9026e7a455b69158bfd89b159898b95a": {
    name: "affairs",
    order: -1,
    plain: { said: "The study said people happier in their marriage had fewer affairs, by 2.28 on its scale for each step happier.", unit: "affairs scale per step of marriage happiness" },
    origin: "rebuild",
    question: "Do happier marriages mean fewer affairs?",
    citeDoi: "10.1086/260646",
    paperSays: { quote: "Marital happiness ... -2.28 -5.61", where: "Table 3, Psychology Today data, second set of estimates, read from the page image of the author's free copy", href: "https://fairmodel.econ.yale.edu/rayfair/pdf/1978A200.PDF" },
    whyItMatters: "It's one of the most reused data sets in economics teaching, so its numbers get copied into textbooks again and again.",
    notChecked: ["Whether magazine readers who answered a survey stand for everyone.", "Whether the answers were honest."],
    why: {
      heading: "Whose code is this?",
      text: "Our own small program, which fits the paper's model on a public copy of the same 601 answers. It isn't the author's code. Nobody has run it on the real data yet, us included. It was tested only on made-up data with a known answer, and the Lab runs it once forecasting closes.",
      link: { label: "See the code", href: "https://github.com/Maveri-Q/rerun-rebuilds/tree/main/affairs-1978" },
    },
  },
};

export const provenanceOf = (specHash: string): Provenance | undefined => PROVENANCE[specHash];

/** Whether a claim belongs on the lists. Demos live behind "Try it now", and tests aren't shown at all. */
export function isListed(m: { state: string; spec: { spec_hash: string; title: string } }): boolean {
  if (m.state === "Draft" || /^(\[(DEMO|TEST)\]|Demo:)/.test(m.spec.title)) return false;
  return !(provenanceOf(m.spec.spec_hash)?.hideUntilFinal && m.state !== "Final");
}

const RERUN_SAID: Record<string, string> = {
  REPRODUCED: "The Lab retraced it: \u2713 same result.",
  NOT_REPRODUCED: "The Lab retraced it: \u2717 different result.",
  BROKEN: "The Lab retraced it: the code didn't finish.",
  INVALID: "The Lab couldn't retrace it fairly, so there's no verdict.",
};

/** "The study said X. The Lab retraced it: ✓ same result." Null when we have no plain wording for the claim. */
export function resultSentence(m: { state: string; outcome?: string | null; spec: { spec_hash: string } }, posted?: string | null): string | null {
  const said = provenanceOf(m.spec.spec_hash)?.plain?.said;
  if (!said) return null;
  // A market's own outcome only appears once it's final. Until then the latest receipt has the result.
  const outcome = m.outcome ?? posted;
  const rerun = outcome ? RERUN_SAID[outcome] : null;
  if (rerun) return `${said} ${rerun}${m.outcome ? "" : " This can still be challenged."}`;
  if (m.state === "Running") return `${said} The Lab is retracing it now.`;
  if (m.state === "Proposed" || m.state === "Challenged") return `${said} The Lab has posted its result.`;
  return `${said} The Lab will retrace it when forecasting closes.`;
}

/** Just what the study said, in plain words, for lists that show the verdict beside it. */
export const studySaid = (m: { spec: { spec_hash: string } }): string | null => provenanceOf(m.spec.spec_hash)?.plain?.said ?? null;

/** A claim's name for readers: the question if it has one, otherwise its title without the label. */
export function claimName(m: { spec: { spec_hash: string; title: string } }): string {
  return provenanceOf(m.spec.spec_hash)?.question ?? plainDemoTitle(m.spec.title.replace(/^\[(DEMO|TEST)\]\s*/, ""));
}

/**
 * Demo titles on the blockchain end "Will the Lab's rerun agree?" and can't change (open claims pin their
 * hashes), so readers see the site's wording instead: "Demo: our practice dataset says X." becomes
 * "Practice data says X. Will the Lab agree?".
 */
export function plainDemoTitle(title: string): string {
  if (!title.startsWith("Demo:")) return title;
  return title
    .replace(/^Demo:\s*our practice dataset says\s*/i, "Practice data says ")
    .replace(/^Demo:\s*/, "")
    .replace(/Will the (Lab's )?re-?run agree\?$/i, "Will the Lab agree?");
}
