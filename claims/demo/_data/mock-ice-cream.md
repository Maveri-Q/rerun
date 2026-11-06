Scripted reply used only with MOCK_LLM=1.

```python
import csv
import json

groups = {}
with open("data/ice_cream.csv", newline="") as f:
    for row in csv.DictReader(f):
        groups.setdefault(row["weather"], []).append(int(row["cups_sold"]))
high = sum(groups["sunny"]) / len(groups["sunny"])
low = sum(groups["cloudy"]) / len(groups["cloudy"])
json.dump({"value": 100 * (high / low - 1)}, open("reimplementation_result.json", "w"))
```
