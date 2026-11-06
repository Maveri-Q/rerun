import csv
import json

orders = {"yes": [], "no": []}
with open("data/coffee.csv", newline="") as f:
    for row in csv.DictReader(f):
        orders[row["monday"]].append(int(row["orders"]))

monday = sum(orders["yes"]) / len(orders["yes"])
other = sum(orders["no"]) / len(orders["no"])
more = 100 * (monday / other - 1)
print(f"Mondays had {more:.2f}% more orders")
with open("results.json", "w") as f:
    json.dump({"percent_more": more}, f)
