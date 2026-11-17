import json
from datetime import datetime, timezone

import pytest

from tracker import paths
from tracker.config import load_destinations

DEFAULTS = {"high": 70.0, "low": 60.0, "precip": 0.1, "uv": 5.0, "wind": 10.0, "sun_s": 36000}


def utc(date, hour=12):
    y, m, d = map(int, date.split("-"))
    return datetime(y, m, d, hour, tzinfo=timezone.utc)


@pytest.fixture
def dests():
    return load_destinations()


@pytest.fixture(autouse=True)
def tmp_data(tmp_path, monkeypatch):
    """Point every data path at a temp dir so tests never touch real data/."""
    data = tmp_path / "data"
    monkeypatch.setattr(paths, "DATA_DIR", data)
    monkeypatch.setattr(paths, "RAW_DIR", data / "raw")
    monkeypatch.setattr(paths, "HISTORY_CSV", data / "history.csv")
    monkeypatch.setattr(paths, "STATUS_JSON", data / "status.json")
    return data


@pytest.fixture
def make_body(dests):
    """Build an Open-Meteo style response (bytes).

    items maps item_id -> overrides of DEFAULTS (use None for a missing value).
    Locations appear in the order of `items`, with coordinates nudged the way
    Open-Meteo snaps them to its grid.
    """
    by_id = {d["item_id"]: d for d in dests}

    def build(date, items):
        locations = []
        for item_id, overrides in items.items():
            d, v = by_id[item_id], {**DEFAULTS, **overrides}
            locations.append({
                "latitude": d["lat"] + 0.05, "longitude": d["lon"] - 0.04,
                "daily": {
                    "time": [date],
                    "temperature_2m_max": [v["high"]], "temperature_2m_min": [v["low"]],
                    "precipitation_sum": [v["precip"]], "uv_index_max": [v["uv"]],
                    "wind_speed_10m_max": [v["wind"]], "sunshine_duration": [v["sun_s"]],
                },
            })
        return json.dumps(locations).encode()

    return build
