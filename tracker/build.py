"""Rebuild data/history.csv purely from the raw files (+ the destinations config)."""
import csv
import json
import os
import sys

from .config import load_destinations
from .paths import HISTORY_CSV
from .raw import list_raw, read_raw

COLUMNS = [
    "date", "item_id", "item", "source", "country", "region", "vibe",
    "temp_high_f", "temp_low_f", "precip_in", "uv_index", "wind_max_mph",
    "sunshine_hours",
]


def _first(daily, key):
    vals = daily.get(key) or []
    return vals[0] if vals else None


def parse_open_meteo(body, destinations, source):
    """Open-Meteo returns a list (one object per requested location, same order)."""
    data = json.loads(body)
    locations = data if isinstance(data, list) else [data]
    if len(locations) != len(destinations):
        raise ValueError(f"{len(locations)} locations in response, {len(destinations)} in config")
    rows = []
    for dest, loc in zip(destinations, locations):
        daily = loc.get("daily") or {}
        date = _first(daily, "time")
        if not date:
            continue
        sun = _first(daily, "sunshine_duration")
        rows.append({
            "date": date, "item_id": dest["item_id"], "item": dest["name"],
            "source": source, "country": dest["country"], "region": dest["region"],
            "vibe": dest["vibe"],
            "temp_high_f": _first(daily, "temperature_2m_max"),
            "temp_low_f": _first(daily, "temperature_2m_min"),
            "precip_in": _first(daily, "precipitation_sum"),
            "uv_index": _first(daily, "uv_index_max"),
            "wind_max_mph": _first(daily, "wind_speed_10m_max"),
            "sunshine_hours": None if sun is None else round(sun / 3600, 2),
        })
    return rows


PARSERS = {"open-meteo": parse_open_meteo}


def build_rows(destinations):
    by_key = {}
    for _day, source, path in list_raw():
        parser = PARSERS.get(source)
        if parser is None:
            print(f"build: no parser for source '{source}', skipping {path}", file=sys.stderr)
            continue
        try:
            rows = parser(read_raw(path), destinations, source)
        except Exception as e:  # a bad raw file must not block the rest
            print(f"build: skipping {path}: {e}", file=sys.stderr)
            continue
        for r in rows:  # later raw files win for the same (date, item, source)
            by_key[(r["date"], r["item_id"], r["source"])] = r
    return sorted(by_key.values(), key=lambda r: (r["date"], r["item_id"], r["source"]))


def build_history(destinations=None):
    destinations = destinations or load_destinations()
    rows = build_rows(destinations)
    HISTORY_CSV.parent.mkdir(parents=True, exist_ok=True)
    tmp = HISTORY_CSV.with_suffix(".tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({k: "" if r[k] is None else r[k] for k in COLUMNS})
    os.replace(tmp, HISTORY_CSV)
    return rows
