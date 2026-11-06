import csv

# The records are never published. The Lab receives them sealed and opens them inside its locked box.
months = {"yes": [], "no": []}
with open("private/gym.csv", newline="") as f:
    for row in csv.DictReader(f):
        months[row["weekly_visitor"]].append(int(row["months_stayed"]))

weekly = sum(months["yes"]) / len(months["yes"])
others = sum(months["no"]) / len(months["no"])
with open("results.csv", "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["metric", "value"])
    writer.writerow(["percent_longer", 100 * (weekly / others - 1)])
