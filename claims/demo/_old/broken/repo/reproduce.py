import json
import pandas as pd
import labtools_internal as lt  # the lab's private package; never published

df = pd.read_csv("data/trials.csv")
accuracy = lt.fit_and_score(df, target="response", seed=42)
print(f"accuracy={accuracy}")
with open("results.json", "w") as f:
    json.dump({"accuracy": accuracy}, f)
