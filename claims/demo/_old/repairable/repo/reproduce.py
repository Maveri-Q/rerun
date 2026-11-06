import json
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split

# Runs fine on the author's laptop; that path does not exist anywhere else.
df = pd.read_csv("/home/drsmith/project/data/trials.csv")
X = df[["age", "dose", "biomarker"]]
y = df["response"]
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=42)
model = LogisticRegression(max_iter=1000).fit(X_train, y_train)
accuracy = model.score(X_test, y_test)
print(f"accuracy={accuracy}")
with open("results.json", "w") as f:
    json.dump({"accuracy": accuracy}, f)
