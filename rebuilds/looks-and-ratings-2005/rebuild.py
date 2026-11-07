"""
Independent rebuild of one number from Hamermesh and Parker (2005), "Beauty in the Classroom",
Economics of Education Review 24 (working paper: NBER 9853, Table 3, column 1): how much a professor's
rated looks move students' course ratings, with sex, minority, non-native English, tenure track, lower
division and one-credit courses held equal, each course weighted by the students who filled in the form.

It reads a public copy of the authors' data (R package AER, TeachingRatings), unchanged. Standard library only.

    python rebuild.py TeachingRatings.csv
"""

import csv
import sys

NAMES = ["constant", "looks", "female", "minority", "non_native", "tenure_track", "lower_division", "one_credit"]


def solve(a, b):
    n = len(a)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        pivot = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[pivot] = m[pivot], m[c]
        for r in range(n):
            if r != c:
                factor = m[r][c] / m[c][c]
                for k in range(c, n + 1):
                    m[r][k] -= factor * m[c][k]
    return [m[i][n] / m[i][i] for i in range(n)]


def weighted_least_squares(x, y, w):
    k = len(x[0])
    a = [[sum(wi * row[i] * row[j] for row, wi in zip(x, w)) for j in range(k)] for i in range(k)]
    b = [sum(wi * row[i] * yi for row, yi, wi in zip(x, y, w)) for i in range(k)]
    return solve(a, b)


def main(path):
    with open(path, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 463, "the paper says 463 courses"
    x = [
        [
            1.0,
            float(r["beauty"]),
            float(r["gender"] == "female"),
            float(r["minority"] == "yes"),
            float(r["native"] == "no"),
            float(r["tenure"] == "yes"),
            float(r["division"] == "lower"),
            float(r["credits"] == "single"),
        ]
        for r in rows
    ]
    y = [float(r["eval"]) for r in rows]
    w = [float(r["students"]) for r in rows]
    result = weighted_least_squares(x, y, w)
    for name, value in list(zip(NAMES, result))[2:]:
        print(name, round(value, 3))
    print("looks_effect", round(result[1], 4))


if __name__ == "__main__":
    main(sys.argv[1])
