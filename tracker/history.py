"""Read data/history.csv back into rows with numbers as floats (empty -> None)."""
import csv

from . import paths

NUMERIC = [
    "temp_high_f", "temp_low_f", "precip_in", "uv_index",
    "wind_max_mph", "sunshine_hours",
]


def load_history(path=None):
    path = path or paths.HISTORY_CSV
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            for key in NUMERIC:
                row[key] = float(row[key]) if row[key] != "" else None
            rows.append(row)
    return rows
