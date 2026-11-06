import csv
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

# The hospital data is never published; the Lab receives it encrypted and decrypts it inside the TEE.
df = pd.read_csv("private/readmissions.csv")
X = df[["age", "prior_admissions", "length_of_stay", "comorbidities"]]
y = df["readmitted_30d"]
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=7)
model = LogisticRegression(max_iter=1000).fit(X_train, y_train)
auc = roc_auc_score(y_test, model.predict_proba(X_test)[:, 1])
with open("results.csv", "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["metric", "value"])
    writer.writerow(["auc", auc])
