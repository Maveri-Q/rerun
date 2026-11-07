"""
Independent rebuild of the headline in Open Science Collaboration (2015), "Estimating the
Reproducibility of Psychological Science", Science 349: the share of repeated psychology studies that
got a statistically significant result again.

It reads the project's public results table, unchanged, and counts, using the table's own yes-or-no
columns for whether each original and each repeat was significant. It doesn't redo the 100 experiments.
Standard library only.

    python rebuild.py rpp_data.csv
"""

import csv
import sys

# The studies are the first 167 rows of the file.
STUDY_ROWS = 167


def main(path):
    with open(path, encoding="latin-1", newline="") as f:
        rows = list(csv.DictReader(f))[:STUDY_ROWS]
    pairs = [(r["T_sign_O"], r["T_sign_R"]) for r in rows if r["T_sign_O"] in ("0", "1") and r["T_sign_R"] in ("0", "1")]
    originals = [p for p in pairs if p[0] == "1"]
    again = [p for p in originals if p[1] == "1"]
    print("significant_originals", len(originals))
    print("significant_again", len(again))
    print("percent_significant_again", round(100 * len(again) / len(originals), 4))


if __name__ == "__main__":
    main(sys.argv[1])
