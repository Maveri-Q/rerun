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
}

export const ORIGIN_LABEL: Record<CodeOrigin, string> = {
  authors: "Authors' own code",
  rebuild: "Independent rebuild",
};

export const PROVENANCE: Record<string, Provenance> = {
  "a942a4e8eee4390f46ae932c48d15ccd0c83ebc0a39eab408c50e054088f6986": {
    name: "wildfire-water",
    origin: "authors",
    flagship: true,
    why: {
      heading: "Whose code is this?",
      text: "The lead author's original script from 2008, run unchanged on the published data. Nobody rewrote it.",
      link: { label: "See the code", href: "https://github.com/bpbond/ten-years-paper33" },
    },
  },
  "f63ef50e89f8221d51bde13cebd576b5b89b56f82842ae5fb33321418db60774": {
    name: "parkinsons-spread",
    origin: "rebuild",
    why: {
      heading: "Why not the authors' own code?",
      text: "It wasn't missing. Henderson and colleagues published their code openly, in R and MATLAB, under an MIT licence. This claim runs a separate Python rebuild, written by other researchers and published in a peer-reviewed journal, because we chose it before checking the original closely. We have since read the original: MATLAB is only used for a side analysis, not this number, so the authors' R code looks runnable. We haven't run it yet. The rebuild itself runs with no AI and no code changes once its packages are installed as they were on the date of its code.",
      link: { label: "See the authors' code", href: "https://github.com/ejcorn/connectome_diffusion" },
    },
  },
  "c4a9b60c770317e5f7ec3aacbac1513bd2f133958bb226d29762fa2a39ae86d1": {
    name: "budworm-timing",
    origin: "rebuild",
    why: {
      heading: "Why not the authors' own code?",
      text: "The original analyses from 1986 and 1991 were written for SAS and GLIM, older statistics software the Lab can't run. SAS is also paid. This claim runs a rebuild in R by another researcher, published in a peer-reviewed journal.",
      link: { label: "See the rebuild, which includes the original code", href: "https://github.com/pboesu/replication_candy_1991" },
    },
  },
  "19ef61085d1bfae1011de7c8c5006c243a97c56f2066c7bbea8d1179e60c8a0f": {
    name: "budworm-spread",
    origin: "rebuild",
    why: {
      heading: "Why not the authors' own code?",
      text: "The original analyses from 1986 and 1991 were written for SAS and GLIM, older statistics software the Lab can't run. SAS is also paid. This claim runs a rebuild in R by another researcher, published in a peer-reviewed journal.",
      link: { label: "See the rebuild, which includes the original code", href: "https://github.com/pboesu/replication_candy_1991" },
    },
  },
};

export const provenanceOf = (specHash: string): Provenance | undefined => PROVENANCE[specHash];
