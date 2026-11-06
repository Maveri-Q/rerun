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
  /** The claim as a sentence anyone can follow, and what its number counts. */
  plain?: { claim: string; unit: string };
  /** A well-known finding, listed first. */
  famous?: boolean;
  /** Needs background to follow, so it's listed behind "more technical papers". */
  technical?: boolean;
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
  /** Posted with the result already known, so nobody forecast it. */
  settledShowcase?: boolean;
  /** Extra limits for this claim, added to the standard list. */
  notChecked?: string[];
}

/** True of every claim, because the Lab only re-runs code. */
export const NEVER_CHECKED = [
  "Whether the sample was fair or large enough.",
  "Whether test data leaked into training or tuning.",
  "Whether the result holds on new data.",
  "Whether the study's method was the right one for its question.",
];

/** The price comes from forecasters and the verdict comes from the re-run. Neither touches the other. */
export const PRICE_RULE = "The forecast price never changes the verdict.";

export const ORIGIN_LABEL: Record<CodeOrigin, string> = {
  authors: "Authors' own code",
  rebuild: "Independent rebuild",
  critics: "Critics' code on the authors' data",
};

export const PROVENANCE: Record<string, Provenance> = {
  "53d87974c67eef8008149ef40f0448812042bff87db91a0683551e921a3b2e75": {
    name: "parkinsons-authors",
    plain: { claim: "A model of the brain's wiring predicted where Parkinson's-like damage spreads in mice, with a match score of 0.696, where 1 would be perfect.", unit: "match score" },
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
    famous: true,
    plain: { claim: "After New Jersey raised its minimum wage, its fast-food stores gained about 2.76 jobs each, compared with stores next door in Pennsylvania.", unit: "jobs per store" },
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
    famous: true,
    plain: { claim: "Rich countries with government debt above 90% of their economy grew by -0.1% a year on average, the paper said.", unit: "% growth a year" },
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
    plain: { claim: "After wildfires, temperature explains about 15% of the year-to-year change in how much water northern forests lose. That's 0.1495 as a share.", unit: "share explained" },
    origin: "authors",
    question: "Does temperature explain how much water forests lose after a wildfire?",
    citeDoi: "10.5281/zenodo.4617894",
    flagship: true,
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
    plain: { claim: "A model of the brain's wiring predicted where Parkinson's-like damage spreads in mice, with a match score of 0.696, where 1 would be perfect.", unit: "match score" },
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
    technical: true,
    plain: { claim: "A 1991 model of when a forest pest develops gives this value for one of its settings.", unit: "model setting" },
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
    technical: true,
    plain: { claim: "A table from 1986 gives this value for how spread out a forest pest's development is over the season.", unit: "model setting" },
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
};

export const provenanceOf = (specHash: string): Provenance | undefined => PROVENANCE[specHash];

/** A claim's name for readers: the question if it has one, otherwise its title without the label. */
export function claimName(m: { spec: { spec_hash: string; title: string } }): string {
  return provenanceOf(m.spec.spec_hash)?.question ?? m.spec.title.replace(/^\[(DEMO|TEST)\]\s*/, "");
}
