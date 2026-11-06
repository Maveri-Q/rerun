"""
Independent rebuild of one number from Card and Krueger (1994), "Minimum Wages and Employment",
American Economic Review 84(4): the change in full-time-equivalent jobs per store in New Jersey
relative to Pennsylvania (Table 3, row 3, column iii; the paper's text gives it as 2.76).

Written from the paper's description and the authors' codebook, not from the authors' SAS program.
It reads the authors' public survey data, unchanged, using only Python's standard library.

    python rebuild.py njmin.zip
"""

import sys
import zipfile

# (name, first column, last column) from the authors' codebook. Columns count from 1.
COLUMNS = {
    "state": (9, 9),
    "empft": (26, 30),
    "emppt": (32, 36),
    "nmgrs": (38, 42),
    "status2": (110, 110),
    "empft2": (122, 126),
    "emppt2": (128, 132),
    "nmgrs2": (134, 138),
}

# The codebook's second-interview status: 3 means the store closed for good. The paper's Table 3
# counts those stores as zero jobs.
CLOSED_FOR_GOOD = 3


def field(line, name):
    start, end = COLUMNS[name]
    text = line[start - 1 : end].strip()
    return None if text in ("", ".") else float(text)


def fte(full, part, managers):
    """Each part-time worker counts as half a full-time worker. Managers count as full-time."""
    if full is None or part is None or managers is None:
        return None
    return full + managers + 0.5 * part


def mean(values):
    present = [v for v in values if v is not None]
    return sum(present) / len(present)


def main(path):
    with zipfile.ZipFile(path) as archive:
        lines = archive.read("public.dat").decode("ascii").splitlines()
    assert len(lines) == 410, "the codebook says there are 410 stores"

    before = {0: [], 1: []}
    after = {0: [], 1: []}
    for line in lines:
        state = int(field(line, "state"))
        before[state].append(fte(field(line, "empft"), field(line, "emppt"), field(line, "nmgrs")))
        if field(line, "status2") == CLOSED_FOR_GOOD:
            after[state].append(0.0)
        else:
            after[state].append(fte(field(line, "empft2"), field(line, "emppt2"), field(line, "nmgrs2")))

    change_nj = mean(after[1]) - mean(before[1])
    change_pa = mean(after[0]) - mean(before[0])
    print("PA before", round(mean(before[0]), 2), "after", round(mean(after[0]), 2), "change", round(change_pa, 2))
    print("NJ before", round(mean(before[1]), 2), "after", round(mean(after[1]), 2), "change", round(change_nj, 2))
    print("nj_minus_pa", round(change_nj - change_pa, 4))


if __name__ == "__main__":
    main(sys.argv[1])
