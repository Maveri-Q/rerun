Scripted reply used only with MOCK_LLM=1.

```python
import json

import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split

df = pd.read_csv("data/trials.csv")
X_train, X_test, y_train, y_test = train_test_split(df[["age", "dose", "biomarker"]], df["response"], test_size=0.25, random_state=42)
value = LogisticRegression(max_iter=1000).fit(X_train, y_train).score(X_test, y_test)
json.dump({"value": value}, open("reimplementation_result.json", "w"))
```
