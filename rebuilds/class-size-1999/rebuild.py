"""
Independent rebuild of the first column of Krueger (1999), "Experimental Estimates of Education
Production Functions", Quarterly Journal of Economics 114 (working paper: NBER 6051, Table 6): how many
percentile points children in small classes gained in Tennessee's STAR experiment.

Each child's reading and maths scores become percentile ranks among children in normal-size classes,
with and without an aide, and are averaged. The answer is the small-class average minus the normal-class
average. This public copy of the data (R package AER, STAR) has only reading and maths scores, and its
child counts differ a little from the paper's, so it can't match exactly. Every grade is printed, next to
the paper's figure. Standard library only.

    python rebuild.py STAR.csv
"""

import bisect
import csv
import sys

NORMAL = ("regular", "regular+aide")
PAPER = {"k": "4.82", "1": "8.57", "2": "5.93", "3": "5.32"}


def number(text):
    return None if text in ("", "NA") else float(text)


def rank(ordered, value):
    """Percent of normal-class children below this score, counting ties as half."""
    below = bisect.bisect_left(ordered, value)
    through = bisect.bisect_right(ordered, value)
    return 100 * (below + through) / (2 * len(ordered))


def gap(rows, grade):
    children = []
    for r in rows:
        kind = r["star" + grade]
        scores = (number(r["read" + grade]), number(r["math" + grade]))
        if kind not in ("", "NA") and None not in scores:
            children.append((kind, scores))
    normal = [sorted(c[1][test] for c in children if c[0] in NORMAL) for test in (0, 1)]
    groups = {}
    for kind, scores in children:
        groups.setdefault(kind, []).append((rank(normal[0], scores[0]) + rank(normal[1], scores[1])) / 2)
    average = {kind: sum(v) / len(v) for kind, v in groups.items()}
    return average["small"] - average["regular"], len(children)


def main(path):
    with open(path, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    for grade, paper in PAPER.items():
        value, children = gap(rows, grade)
        print("grade", grade, "children", children, "paper", paper, "rebuild", round(value, 2))
    print("first_grade_gap", round(gap(rows, "1")[0], 4))


if __name__ == "__main__":
    main(sys.argv[1])
