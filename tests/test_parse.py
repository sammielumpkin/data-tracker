"""Open-Meteo raw response -> common columns."""
import json

from tracker.build import COLUMNS, parse_open_meteo


def parse(body, dests):
    return parse_open_meteo(body, dests, "open-meteo")


def test_converts_to_common_columns(make_body, dests):
    body = make_body("2026-11-17", {"paris": {
        "high": 62.9, "low": 54.3, "precip": 0.909, "uv": 2.0, "wind": 16.8, "sun_s": 14400}})
    (row,) = parse(body, dests)
    assert row == {
        "date": "2026-11-17", "item_id": "paris", "item": "Paris", "source": "open-meteo",
        "country": "France", "region": "Europe", "vibe": "city",
        "temp_high_f": 62.9, "temp_low_f": 54.3, "precip_in": 0.909,
        "uv_index": 2.0, "wind_max_mph": 16.8, "sunshine_hours": 4.0,
    }
    assert set(row) == set(COLUMNS)


def test_sunshine_seconds_become_hours_rounded(make_body, dests):
    (row,) = parse(make_body("2026-11-17", {"bali": {"sun_s": 43000}}), dests)
    assert row["sunshine_hours"] == 11.94  # 43000 / 3600 = 11.944...


def test_missing_values_stay_none(make_body, dests):
    (row,) = parse(make_body("2026-11-17", {"tokyo": {"high": None, "sun_s": None}}), dests)
    assert row["temp_high_f"] is None
    assert row["sunshine_hours"] is None
    assert row["temp_low_f"] == 60.0


def test_matches_by_lat_lon_not_position(make_body, dests):
    forward = parse(make_body("2026-11-17", {"paris": {"high": 1.0}, "tokyo": {"high": 2.0}}), dests)
    flipped = parse(make_body("2026-11-17", {"tokyo": {"high": 2.0}, "paris": {"high": 1.0}}), dests)
    assert {r["item_id"]: r["temp_high_f"] for r in forward} == {"paris": 1.0, "tokyo": 2.0}
    assert {r["item_id"]: r["temp_high_f"] for r in flipped} == {"paris": 1.0, "tokyo": 2.0}


def test_old_raw_file_still_parses_after_destinations_are_added(make_body, dests):
    body = make_body("2026-11-17", {"paris": {}, "nassau": {}})
    extra = {"item_id": "new", "name": "New", "country": "X", "region": "X",
             "vibe": "city", "lat": 0.0, "lon": 0.0}
    assert [r["item_id"] for r in parse(body, [extra] + dests)] == ["paris", "nassau"]


def test_location_matching_no_destination_is_skipped(make_body, dests):
    body = make_body("2026-11-17", {"paris": {}, "tokyo": {}})
    without_tokyo = [d for d in dests if d["item_id"] != "tokyo"]
    assert [r["item_id"] for r in parse(body, without_tokyo)] == ["paris"]


def test_single_location_response_is_a_dict(make_body, dests):
    (loc,) = json.loads(make_body("2026-11-17", {"maui": {}}))
    (row,) = parse(json.dumps(loc).encode(), dests)
    assert row["item_id"] == "maui"


def test_date_comes_from_the_response(make_body, dests):
    (row,) = parse(make_body("2030-01-02", {"dubai": {}}), dests)
    assert row["date"] == "2030-01-02"
