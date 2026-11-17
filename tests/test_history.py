"""History / pipeline logic, using fake sources and a temp data dir."""
import csv
import json

import pytest

from conftest import utc
from tracker import paths, pipeline
from tracker.build import COLUMNS, build_history
from tracker.history import load_history
from tracker.raw import list_raw


def run_day(monkeypatch, date, body, hour=12):
    """One pipeline run on `date` with a source that returns `body` (or raises)."""
    def fetch(_dests):
        if isinstance(body, Exception):
            raise body
        return body
    monkeypatch.setattr(pipeline, "SOURCES", {"open-meteo": fetch})
    return pipeline.run(now=utc(date, hour))


def read_csv():
    with open(paths.HISTORY_CSV, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def test_history_has_columns_sorted_rows_and_empty_missing_values(monkeypatch, make_body):
    body = make_body("2026-11-17", {"tokyo": {"high": None}, "bali": {}, "paris": {}})
    run_day(monkeypatch, "2026-11-17", body)
    with open(paths.HISTORY_CSV, encoding="utf-8") as f:
        assert next(csv.reader(f)) == COLUMNS
    rows = read_csv()
    assert [r["item_id"] for r in rows] == ["bali", "paris", "tokyo"]
    assert rows[2]["temp_high_f"] == ""


def test_history_is_sorted_by_date_then_item(monkeypatch, make_body):
    run_day(monkeypatch, "2026-11-18", make_body("2026-11-18", {"paris": {}, "bali": {}}))
    run_day(monkeypatch, "2026-11-17", make_body("2026-11-17", {"tokyo": {}, "paris": {}}))
    assert [(r["date"], r["item_id"]) for r in read_csv()] == [
        ("2026-11-17", "paris"), ("2026-11-17", "tokyo"),
        ("2026-11-18", "bali"), ("2026-11-18", "paris"),
    ]


def test_rebuild_from_raw_is_byte_identical(monkeypatch, make_body):
    run_day(monkeypatch, "2026-11-16", make_body("2026-11-16", {"paris": {"high": 60.0}}))
    run_day(monkeypatch, "2026-11-17", make_body("2026-11-17", {"paris": {"high": 65.0}}))
    first = paths.HISTORY_CSV.read_bytes()
    build_history()
    assert paths.HISTORY_CSV.read_bytes() == first


def test_history_is_rebuilt_only_from_raw_files(monkeypatch, make_body):
    run_day(monkeypatch, "2026-11-17", make_body("2026-11-17", {"paris": {}}))
    paths.HISTORY_CSV.write_text("garbage\n")  # hand edits must not survive a rebuild
    build_history()
    assert [r["item_id"] for r in read_csv()] == ["paris"]


def test_second_run_same_day_replaces_that_days_rows(monkeypatch, make_body):
    run_day(monkeypatch, "2026-11-17", make_body("2026-11-17", {"paris": {"high": 60.0}, "tokyo": {"high": 50.0}}), hour=6)
    assert len(read_csv()) == 2

    run_day(monkeypatch, "2026-11-17", make_body("2026-11-17", {"paris": {"high": 64.0}}), hour=18)

    rows = read_csv()
    assert [(r["item_id"], r["temp_high_f"]) for r in rows] == [("paris", "64.0")]  # no duplicates, tokyo gone
    assert len(list(list_raw())) == 1  # one raw file for the day, replaced


def test_second_run_does_not_touch_other_days(monkeypatch, make_body):
    run_day(monkeypatch, "2026-11-16", make_body("2026-11-16", {"paris": {"high": 55.0}}))
    run_day(monkeypatch, "2026-11-17", make_body("2026-11-17", {"paris": {"high": 60.0}}))
    run_day(monkeypatch, "2026-11-17", make_body("2026-11-17", {"paris": {"high": 61.0}}))
    assert [(r["date"], r["temp_high_f"]) for r in load_history()] == [
        ("2026-11-16", 55.0), ("2026-11-17", 61.0)]


def test_raw_file_is_gzipped_original_response(monkeypatch, make_body):
    import gzip
    body = make_body("2026-11-17", {"paris": {}})
    run_day(monkeypatch, "2026-11-17", body)
    path = paths.RAW_DIR / "2026-11-17" / "open-meteo.json.gz"
    assert gzip.decompress(path.read_bytes()) == body


def test_failed_source_is_recorded_and_does_not_stop_the_run(monkeypatch, make_body):
    status = run_day(monkeypatch, "2026-11-17", RuntimeError("boom"))
    assert status["sources"] == [{"name": "open-meteo", "ok": False, "count": 0}]
    assert status["items"] == 0
    assert json.loads(paths.STATUS_JSON.read_text())["sources"][0]["ok"] is False
    assert paths.HISTORY_CSV.exists()


def test_one_failing_source_does_not_block_another(monkeypatch, make_body):
    body = make_body("2026-11-17", {"paris": {}})
    monkeypatch.setattr(pipeline, "SOURCES", {
        "broken": lambda d: (_ for _ in ()).throw(RuntimeError("down")),
        "open-meteo": lambda d: body,
    })
    monkeypatch.setitem(pipeline.PARSERS, "broken", lambda *a: [])
    status = pipeline.run(now=utc("2026-11-17"))
    assert [(s["name"], s["ok"]) for s in status["sources"]] == [("broken", False), ("open-meteo", True)]
    assert [r["item_id"] for r in read_csv()] == ["paris"]


def test_failure_keeps_the_days_earlier_good_raw_file(monkeypatch, make_body):
    run_day(monkeypatch, "2026-11-17", make_body("2026-11-17", {"paris": {"high": 60.0}}), hour=6)
    run_day(monkeypatch, "2026-11-17", ValueError("bad"), hour=18)
    assert [r["temp_high_f"] for r in read_csv()] == ["60.0"]


def test_invalid_json_response_is_a_failure_and_is_not_saved(monkeypatch):
    status = run_day(monkeypatch, "2026-11-17", b"<html>rate limited</html>")
    assert status["sources"][0]["ok"] is False
    assert list(list_raw()) == []


def test_status_fields(monkeypatch, make_body):
    status = run_day(monkeypatch, "2026-11-17", make_body("2026-11-17", {"paris": {}, "tokyo": {}}))
    assert status["run_time"] == "2026-11-17T12:00:00Z"
    assert status["first_run_date"] == "2026-11-17"
    assert status["days_with_success"] == 1
    assert status["items"] == 2
    assert status["sources"] == [{"name": "open-meteo", "ok": True, "count": 2}]


def test_status_new_and_gone_destinations(monkeypatch, make_body):
    run_day(monkeypatch, "2026-11-16", make_body("2026-11-16", {"paris": {}, "tokyo": {}, "bali": {}}))
    status = run_day(monkeypatch, "2026-11-17", make_body("2026-11-17", {"tokyo": {}, "bali": {}, "dubai": {}}))
    assert status["new_today"] == ["dubai"]
    assert status["gone_today"] == ["paris"]
    assert status["days_with_success"] == 2
    assert status["first_run_date"] == "2026-11-16"


def test_first_day_has_no_new_or_gone(monkeypatch, make_body):
    status = run_day(monkeypatch, "2026-11-17", make_body("2026-11-17", {"paris": {}}))
    assert status["new_today"] == [] and status["gone_today"] == []


def test_destination_seen_on_an_earlier_day_is_not_new_again(monkeypatch, make_body):
    run_day(monkeypatch, "2026-11-15", make_body("2026-11-15", {"paris": {}, "tokyo": {}}))
    run_day(monkeypatch, "2026-11-16", make_body("2026-11-16", {"tokyo": {}}))
    status = run_day(monkeypatch, "2026-11-17", make_body("2026-11-17", {"paris": {}, "tokyo": {}}))
    assert status["new_today"] == []  # paris was seen on the 15th


def test_status_file_uses_lf_line_endings(monkeypatch, make_body):
    run_day(monkeypatch, "2026-11-17", make_body("2026-11-17", {"paris": {}}))
    assert b"\r" not in paths.STATUS_JSON.read_bytes()
    assert b"\r" not in paths.HISTORY_CSV.read_bytes()


@pytest.mark.parametrize("bad", [b"[]", b"{}"])
def test_empty_but_valid_responses_produce_header_only_history(monkeypatch, bad):
    run_day(monkeypatch, "2026-11-17", bad)
    assert read_csv() == []
