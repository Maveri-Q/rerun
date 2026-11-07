"""
Independent rebuild of the summary in Silberzahn et al. (2018), "Many Analysts, One Data Set",
Advances in Methods and Practices in Psychological Science 1(3): 29 teams answered one question from
one data set: do referees give dark-skinned football players more red cards?

It reads the project's published table of each team's answer, unchanged, and works out the median, the
range, and how many teams found an effect. It doesn't redo the 29 analyses. Standard library only.

    python rebuild.py or.csv
"""

import csv
import statistics
import sys


def main(path):
    with open(path, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 29, "the paper says 29 teams"
    answers = [float(r["OR"]) for r in rows]
    found = sum(float(r["OR_lo"]) > 1 for r in rows)
    print("teams", len(rows))
    print("lowest", round(min(answers), 2), "highest", round(max(answers), 2))
    print("found_an_effect", found, "did_not", len(rows) - found)
    print("median_odds_ratio", round(statistics.median(answers), 4))


if __name__ == "__main__":
    main(sys.argv[1])
