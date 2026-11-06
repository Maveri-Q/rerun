import csv
import json

# This folder only exists on the writer's laptop.
DATA = "/home/sam/laptop/dog_walks.csv"

steps = {"yes": [], "no": []}
with open(DATA, newline="") as f:
    for row in csv.DictReader(f):
        steps[row["has_dog"]].append(int(row["steps"]))

with_dog = sum(steps["yes"]) / len(steps["yes"])
without = sum(steps["no"]) / len(steps["no"])
more = 100 * (with_dog / without - 1)
print(f"Dog owners walked {more:.2f}% more")
with open("results.json", "w") as f:
    json.dump({"percent_more": more}, f)
