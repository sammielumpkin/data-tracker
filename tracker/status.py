"""Compute and write data/status.json."""
import json
import os

from .paths import STATUS_JSON
from .raw import list_raw


def build_status(run_time, today, source_results, rows):
    raw_dates = sorted({d for d, _s, _p in list_raw()})
    ids_by_date = {}
    for r in rows:
        ids_by_date.setdefault(r["date"], set()).add(r["item_id"])

    today_ids = ids_by_date.get(today, set())
    earlier = sorted(d for d in ids_by_date if d < today)
    seen_before = set().union(*(ids_by_date[d] for d in earlier)) if earlier else set()
    prev_ids = ids_by_date[earlier[-1]] if earlier else set()

    # If nothing came back today, we can't say what is new or gone.
    # On the very first day there is nothing to compare against, so both are empty.
    if today_ids and earlier:
        new_today = sorted(today_ids - seen_before)
        gone_today = sorted(prev_ids - today_ids)
    else:
        new_today, gone_today = [], []

    return {
        "run_time": run_time,
        "first_run_date": raw_dates[0] if raw_dates else None,
        "days_with_success": len(raw_dates),
        "items": len(today_ids),
        "new_today": new_today,
        "gone_today": gone_today,
        "sources": source_results,
    }


def write_status(status):
    STATUS_JSON.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATUS_JSON.with_suffix(".tmp")
    tmp.write_text(json.dumps(status, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, STATUS_JSON)
