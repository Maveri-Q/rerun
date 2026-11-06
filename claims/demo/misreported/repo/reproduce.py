import csv
import json

totals = {"sunny": [], "cloudy": []}
with open("data/ice_cream.csv", newline="") as f:
    for row in csv.DictReader(f):
        totals[row["weather"]].append(int(row["cups_sold"]))

sunny = sum(totals["sunny"]) / len(totals["sunny"])
cloudy = sum(totals["cloudy"]) / len(totals["cloudy"])
more = 100 * (sunny / cloudy - 1)
print(f"Sunny days sold {more:.2f}% more ice cream")
with open("results.txt", "w") as f:
    print(f"percent more: {more}", file=f)
