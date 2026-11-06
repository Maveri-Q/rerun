import json
import pizza_sums  # the writer's own package, never published

faster = pizza_sums.minutes_faster_at_night("data/pizza.csv")
print(f"{faster:.2f} minutes faster at night")
with open("results.json", "w") as f:
    json.dump({"minutes_faster": faster}, f)
