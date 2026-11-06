Scripted reply used only with MOCK_LLM=1.

```python
import csv
import json

groups = {}
with open("data/dog_walks.csv", newline="") as f:
    for row in csv.DictReader(f):
        groups.setdefault(row["has_dog"], []).append(int(row["steps"]))
high = sum(groups["yes"]) / len(groups["yes"])
low = sum(groups["no"]) / len(groups["no"])
json.dump({"value": 100 * (high / low - 1)}, open("reimplementation_result.json", "w"))
```
