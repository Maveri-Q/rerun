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
