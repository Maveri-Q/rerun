"""
Independent rebuild of the headline in Bertrand and Mullainathan (2004), "Are Emily and Greg More
Employable Than Lakisha and Jamal?", American Economic Review 94(4): how many more callbacks CVs with
white-sounding names got than otherwise matching CVs with Black-sounding names.

It reads a public copy of the experiment's data (OpenIntro's resume.csv), unchanged. Standard library only.

    python rebuild.py resume.csv
"""

import csv
import sys


def main(path):
    with open(path, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 4870, "the published study has 4,870 CVs"
    rate = {}
    for race in ("white", "black"):
        group = [r for r in rows if r["race"] == race]
        rate[race] = sum(r["received_callback"] == "1" for r in group) / len(group)
        print(race, "cvs", len(group), "called_back_percent", round(100 * rate[race], 2))
    print("callback_ratio", round(rate["white"] / rate["black"], 4))


if __name__ == "__main__":
    main(sys.argv[1])
