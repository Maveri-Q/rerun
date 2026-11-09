"""
Independent rebuild of one coefficient in Fair (1978), "A Theory of Extramarital Affairs", Journal of
Political Economy 86 (Table 3, Psychology Today data, second set of estimates): how the number of affairs
in the past year moves with a person's own rating of their marriage, from 1 (very unhappy) to 5 (very happy).

The paper fits a tobit model, because most people report none: affairs on a constant, occupation, marriage
rating, age, years married and religiousness, left-censored at zero. This fits the same model by maximum
likelihood on the public copy of the data (R package AER, Affairs), which is the paper's 601 readers.

    python rebuild.py Affairs.csv
"""

import csv
import sys

import numpy as np
from scipy.optimize import minimize
from scipy.stats import norm

COLUMNS = ["occupation", "rating", "age", "yearsmarried", "religiousness"]


def load(path):
    with open(path, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    y = np.array([float(r["affairs"]) for r in rows])
    x = np.column_stack([np.ones(len(rows))] + [[float(r[c]) for r in rows] for c in COLUMNS])
    return y, x


def negative_log_likelihood(params, y, x):
    beta, log_sigma = params[:-1], params[-1]
    sigma = np.exp(log_sigma)
    fitted = x @ beta
    zero = y <= 0
    ll = norm.logcdf(-fitted[zero] / sigma).sum()
    ll += (norm.logpdf((y[~zero] - fitted[~zero]) / sigma) - log_sigma).sum()
    return -ll


def main(path):
    y, x = load(path)
    start_beta = np.linalg.lstsq(x, y, rcond=None)[0]
    start = np.append(start_beta, np.log(y.std() + 1e-9))
    fit = minimize(negative_log_likelihood, start, args=(y, x), method="BFGS", options={"gtol": 1e-8, "maxiter": 10000})
    if not fit.success and fit.status != 2:
        raise SystemExit("the tobit fit did not converge: " + fit.message)
    names = ["constant"] + COLUMNS
    print("people", len(y), "with any affair", int((y > 0).sum()))
    for name, value in zip(names, fit.x[:-1]):
        print(name, round(float(value), 4))
    print("sigma", round(float(np.exp(fit.x[-1])), 4))
    print("marriage_rating_coefficient", round(float(fit.x[2]), 4))


if __name__ == "__main__":
    main(sys.argv[1])
