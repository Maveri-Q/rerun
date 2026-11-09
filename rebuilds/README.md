# RERUN rebuilds

Small programs that recompute one published number from the authors' public data. Each one is an
independent rebuild: it is not the authors' code, and it says so wherever its result appears.

No data lives here. Each claim fetches the data from its original home and checks a fixed fingerprint.

## card-krueger-1994

Recomputes the 2.76 in Table 3 of Card and Krueger (1994), "Minimum Wages and Employment", from the
survey data on David Card's site.

    python card-krueger-1994/rebuild.py njmin.zip

Printed, against row 1, 2 and 3 of the paper's Table 3:

| | Rebuild | Table 3 |
| --- | --- | --- |
| Pennsylvania, before | 23.33 | 23.33 |
| Pennsylvania, after | 21.17 | 21.17 |
| Pennsylvania, change | -2.17 | -2.16 |
| New Jersey, before | 20.44 | 20.44 |
| New Jersey, after | 21.03 | 21.03 |
| New Jersey, change | 0.59 | 0.59 |
| New Jersey minus Pennsylvania | 2.7536 | 2.76 |

The last row rounds to 2.75, one hundredth below the paper's 2.76. The table's own rounded changes also
subtract to 2.75 (0.59 minus -2.16). The allowed margin on the claim is 0.05.

## red-cards-2018

Recomputes the summary of Silberzahn et al. (2018), "Many Analysts, One Data Set", from the project's
table of each team's answer. It doesn't redo the 29 analyses. Prints a median odds ratio of 1.31, a range
of 0.89 to 2.93, and 20 teams finding an effect against 9 not. The paper's abstract gives the same figures.

    python red-cards-2018/rebuild.py or.csv

## names-on-cvs-2004

Recomputes the callback ratio in Bertrand and Mullainathan (2004) from OpenIntro's copy of the data.
Prints 9.65% for white-sounding names, 6.45% for Black-sounding names, and a ratio of 1.4968. Table 1 of the
working paper (NBER 9873) gives 10.06%, 6.70% and 1.50 on 2,445 CVs per group. The data here has 2,435 per group.

    python names-on-cvs-2004/rebuild.py resume.csv

## reproducibility-project-2015

Recounts the headline of Open Science Collaboration (2015) from the project's results table. It doesn't redo
the experiments. Prints 35 of 97, or 36.0825%. The paper says 36%, and the authors' own script prints 35/97.

    python reproducibility-project-2015/rebuild.py rpp_data.csv

## looks-and-ratings-2005

Recomputes column 1 of Table 3 in Hamermesh and Parker (working paper NBER 9853) from a public copy of the data.

| | Rebuild | Table 3 |
| --- | --- | --- |
| Looks | 0.2748 | 0.275 |
| Female | -0.239 | -0.239 |
| Minority | -0.249 | -0.249 |
| Non-native English | -0.253 | -0.253 |
| Tenure track | -0.136 | -0.136 |
| Lower division | -0.046 | -0.046 |

    python looks-and-ratings-2005/rebuild.py TeachingRatings.csv

## class-size-1999

Recomputes column 1 of Table 6 in Krueger (working paper NBER 6051) from a public copy of the STAR data, which
has only reading and maths scores. It can't match exactly, and the third grade is the furthest off.

| Grade | Rebuild | Table 6 | Children, rebuild | Children, paper |
| --- | --- | --- | --- | --- |
| Kindergarten | 4.93 | 4.82 | 5,786 | 5,861 |
| First | 8.52 | 8.57 | 6,379 | 6,452 |
| Second | 5.95 | 5.93 | 6,049 | 5,950 |
| Third | 5.68 | 5.32 | 5,967 | 6,109 |

    python class-size-1999/rebuild.py STAR.csv

## third-child-1998

Recomputes one figure in Table 3 (continued) of Angrist and Evans (1998), "Children and Their Parents'
Labor Supply": among married women in the 1980 US census with two or more children, how much more often
those whose first two children were the same sex had another child. The paper's figure is 0.068. Data:
R package AER, Fertility, the paper's 254,654 married women.

    python third-child-1998/rebuild.py Fertility.csv

This is an open claim: nobody, us included, has run it on the real data. The Lab runs it when forecasting
closes. It was tested only on made-up data with a known answer.

## affairs-1978

Refits one model in Table 3 of Fair (1978), "A Theory of Extramarital Affairs": a tobit of the number of
affairs in the past year on occupation, marriage rating, age, years married and religiousness, for the
Psychology Today sample. The paper's marriage rating coefficient is -2.28. Data: R package AER, Affairs,
the paper's 601 readers.

    python affairs-1978/rebuild.py Affairs.csv

Also an open claim, never run on the real data by us, and tested only on made-up data with a known answer.
