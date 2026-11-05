/**
 * Whose code each real claim runs, and why. Keyed by the claim's fingerprint, so a claim can't pick
 * up another's label. This lives on the site rather than the blockchain so the explanation can be
 * corrected. lab/orchestrator/src/demo/real.test.ts checks these fingerprints against claims/real.
 */

export type CodeOrigin = "authors" | "rebuild";

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
  /** One line on why anyone should care. */
  whyItMatters?: string;
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
};

export const PROVENANCE: Record<string, Provenance> = {
  "53d87974c67eef8008149ef40f0448812042bff87db91a0683551e921a3b2e75": {
    name: "parkinsons-authors",
    origin: "authors",
    paperSays: { quote: "Pearson's r 0.696 (Henderson et al.)", where: "Table 2 of the ReScience C article, which quotes the original paper", href: "https://doi.org/10.1038/s41593-019-0457-5" },
    whyItMatters: "If the brain's wiring predicts where Parkinson's spreads, it gives researchers a map of what to protect.",
    notChecked: ["Whether results in mice carry over to people."],
    why: {
      heading: "Whose code is this?",
      text: "Henderson and colleagues' own R code, run on their published data with packages from the date of the code. It's a settled showcase, so there was no forecasting. The same result also came from an independent rebuild (claim 21).",
      link: { label: "See the code", href: "https://github.com/ejcorn/connectome_diffusion" },
    },
  },
  "a942a4e8eee4390f46ae932c48d15ccd0c83ebc0a39eab408c50e054088f6986": {
    name: "wildfire-water",
    origin: "authors",
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
    origin: "rebuild",
    testRunEarly: true,
    paperSays: { quote: "Pearson's r 0.696 (Henderson et al.), 0.696 (Replication)", where: "Table 2 of the ReScience C article", href: "https://doi.org/10.5281/zenodo.5379631" },
    whyItMatters: "If the brain's wiring predicts where Parkinson's spreads, it gives researchers a map of what to protect.",
    notChecked: ["Whether results in mice carry over to people."],
    why: {
      heading: "Why not the authors' own code?",
      text: "It wasn't missing. Henderson and colleagues published their code openly, in R and MATLAB, under an MIT licence. This claim runs a separate Python rebuild, written by other researchers and published in a peer-reviewed journal, because we chose it before checking the original closely. MATLAB turns out to be used only for a side analysis. We have since run the authors' R code too, in a local test with no AI: it gave 0.69605, the same as this rebuild. That test isn't on the blockchain.",
      link: { label: "See the authors' code", href: "https://github.com/ejcorn/connectome_diffusion" },
    },
  },
  "c4a9b60c770317e5f7ec3aacbac1513bd2f133958bb226d29762fa2a39ae86d1": {
    name: "budworm-timing",
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
    origin: "rebuild",
    testRunEarly: true,
    paperSays: { quote: "dennis_par = c(121.08, 204.36, 264.41, 342.473, 465.620, 599.57, 1.559)", where: "Kemp et al. 1986 Table 1, as transcribed in the replication's code", href: "https://github.com/pboesu/replication_candy_1991/blob/98329d447ef025c260879f28316015fc0b24fb08/code/03_fit_dennis_et_al_model.R" },
    whyItMatters: "The same pest model again, and a case where one value in a rebuild differs by about 9% while the overall fit still agrees.",
    why: {
      heading: "Why not the authors' own code?",
      text: "The original analyses from 1986 and 1991 were written for SAS and GLIM, older statistics software the Lab can't run. SAS is also paid. This claim runs a rebuild in R by another researcher, published in a peer-reviewed journal.",
      link: { label: "See the rebuild, which includes the original code", href: "https://github.com/pboesu/replication_candy_1991" },
    },
  },
};

export const provenanceOf = (specHash: string): Provenance | undefined => PROVENANCE[specHash];
