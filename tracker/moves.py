"""Move rule: biggest absolute change in temp_high_f since the previous run."""

FIELD = "temp_high_f"


def top_movers(rows, date, n=5):
    """Rank items by |change| in daily high between `date` and their previous value.

    "Previous" is the item's most recent earlier date that has a high recorded, so a
    missed day doesn't break the comparison. Items with no value today, no earlier
    value, or no change are left out. Ties are broken by item_id.
    """
    today = {}
    earlier = {}  # item_id -> (date, row) of the latest earlier row with a value
    for r in rows:
        if r[FIELD] is None:
            continue
        if r["date"] == date:
            today[r["item_id"]] = r
        elif r["date"] < date:
            best = earlier.get(r["item_id"])
            if best is None or r["date"] > best["date"]:
                earlier[r["item_id"]] = r

    movers = []
    for item_id, new in today.items():
        old = earlier.get(item_id)
        if old is None:
            continue
        change = round(new[FIELD] - old[FIELD], 2)
        if change == 0:
            continue
        movers.append({
            "item_id": item_id, "item": new["item"],
            "old": old[FIELD], "new": new[FIELD], "change": change,
            "previous_date": old["date"],
        })
    movers.sort(key=lambda m: (-abs(m["change"]), m["item_id"]))
    return movers[:n]
