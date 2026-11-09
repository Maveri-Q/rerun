"""
Independent rebuild of one figure in Angrist and Evans (1998), "Children and Their Parents' Labor Supply:
Evidence from Exogenous Variation in Family Size", American Economic Review 88 (working paper: NBER 5778,
Table 3, continued): among married women aged 21 to 35 in the 1980 US census with two or more children,
how much more often those whose first two children were the same sex went on to have another child.

The answer is the share with more than two children when the first two are both boys or both girls, minus
the share when they are one boy and one girl. The public copy of the data (R package AER, Fertility) is
the paper's 1980 sample of married women, 254,654 of them. Unweighted, as the paper's 1980 figures are.
Standard library only.

    python rebuild.py Fertility.csv
"""

import csv
import sys


def main(path):
    had = {True: 0, False: 0}
    count = {True: 0, False: 0}
    with open(path, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            same = r["gender1"] == r["gender2"]
            count[same] += 1
            had[same] += r["morekids"] == "yes"
    share = {k: had[k] / count[k] for k in (True, False)}
    print("women", count[True] + count[False])
    print("same sex", count[True], "had another child", round(share[True], 4))
    print("one boy, one girl", count[False], "had another child", round(share[False], 4))
    print("same_sex_difference", round(share[True] - share[False], 4))


if __name__ == "__main__":
    main(sys.argv[1])
