# Sources

Every real claim in `claims/real/`, where it comes from, and what licence allows us to use it.
Demo claims in `claims/demo/` are made up, labelled as demos, and aren't listed here.

Where the code isn't by the original authors, the claim says so. In those cases a verdict tests the
replication's code against the number the original paper published.

| Claim | Published result | Code run by the Lab | Licence | Pinned commit |
| --- | --- | --- | --- | --- |
| `wildfire-water` | Bond-Lamberty, Peckham, Gower, Ewers, "Effects of fire on regional evapotranspiration in the central Canadian boreal forest", *Global Change Biology* 15(5), 2009. Re-examined in ReScience C, [10.5281/zenodo.4617894](https://doi.org/10.5281/zenodo.4617894). | The author's original script: [bpbond/ten-years-paper33](https://github.com/bpbond/ten-years-paper33) | MIT | `c28b8a2e` |
| `parkinsons-spread` | Henderson et al., "Spread of alpha-synuclein pathology through the brain connectome is modulated by selective vulnerability and predicted by network analysis", *Nature Neuroscience* 22(8), 2019, [10.1038/s41593-019-0457-5](https://doi.org/10.1038/s41593-019-0457-5). | Independent replication by Bourdenx and Paul, ReScience C, [10.5281/zenodo.5379631](https://doi.org/10.5281/zenodo.5379631): [MathieuBo/PathoSpreading](https://github.com/MathieuBo/PathoSpreading) | MIT | `3031496c` |
| `budworm-timing` | Candy, "Modeling Insect Phenology Using Ordinal Regression and Continuation Ratio Models", *Environmental Entomology* 20(1), 1991. | Independent replication by Boersch-Supan, ReScience C, [10.5281/zenodo.5006005](https://doi.org/10.5281/zenodo.5006005): [pboesu/replication_candy_1991](https://github.com/pboesu/replication_candy_1991) | CC-BY-4.0 | `98329d44` |
| `budworm-spread` | Dennis, Kemp, Beckwith, "Stochastic Model of Insect Phenology: Estimation and Testing", *Environmental Entomology* 15(3), 1986, and the parameter table in Kemp, Dennis, Beckwith, 1986. | Same replication as above | CC-BY-4.0 | `98329d44` |

## Where each reported number comes from

- `wildfire-water`: R-squared 0.1495 for ET on Tavg, line 251 of `original/R output.txt`, the author's 2008 output file, archived in the repository. That paper's fit statistics are on its p. 1247.
- `parkinsons-spread`: correlation 0.696, the 3-month value in the "Henderson et al." column of Table 2 of the ReScience article.
- `budworm-timing`: slope -0.0457, the "Original" logit row of Table 2 of the ReScience article.
- `budworm-spread`: 1.559, transcribed from Kemp et al. 1986 Table 1 in the replication's `code/03_fit_dennis_et_al_model.R`. The replication's author reports a difference of about 9% for this value and good overall agreement.

## Setup changes

Nothing in any author's code is edited. Two claims needed a change to how the code is launched, and both are in the claim's public spec:

- `parkinsons-spread`: the code is from 2021 and uses `Index._index_data`, a private pandas feature that newer versions removed. The article's pandas 1.1.5 has no build for Python 3.11, so the command restores that one attribute (it returns the index's values) before running `Pipeline.py` unchanged. It also skips the script's optional robustness controls (150 shuffled repeats, over 15 minutes on 2 CPUs), which run after the correlation is printed and don't change it. The Lab's own stress test still repeats the run.
- `budworm-spread`: the command runs the script's own lines up to the model fit and skips the table formatting after it, because that needs `kableExtra`, which wouldn't install in the sandbox. It doesn't affect the fit.

The posted `parkinsons-spread` claim keeps its launch fix. A later test with no such fix, installing packages as of the commit date instead, gave the same 0.69605.

## Margins

Each margin was set before any run: 0.0005 for `wildfire-water` and 0.005 for `parkinsons-spread`,
both small next to the size of the number, 1% for `budworm-timing`, which matches the "<1%"
differences its author calls close, and 5% for `budworm-spread`. These are our judgment calls, not
values from the papers.

Note that `budworm-spread` was picked knowing the replication's author had already reported a 9%
difference, so that the site shows what a real mismatch looks like. It is not a blind test.

## Checked but not used yet

- Barnett, "Estimating trends and seasonality in coronary heart disease" (ReScience C): the replication runs in SAS, which is paid software the Lab doesn't have.
- CORE-Bench (Princeton): its capsules aren't git repositories, and we didn't confirm the dataset's licence.
