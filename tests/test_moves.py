"""Move rule: biggest absolute change in temp_high_f since the previous run."""
from tracker.moves import top_movers


def row(date, item_id, high):
    return {"date": date, "item_id": item_id, "item": item_id.title(), "temp_high_f": high}


def test_ranks_by_absolute_change_and_reports_old_and_new():
    rows = [
        row("2026-11-16", "a", 70.0), row("2026-11-17", "a", 73.0),   # +3
        row("2026-11-16", "b", 60.0), row("2026-11-17", "b", 50.0),   # -10
        row("2026-11-16", "c", 80.0), row("2026-11-17", "c", 81.5),   # +1.5
    ]
    movers = top_movers(rows, "2026-11-17")
    assert [m["item_id"] for m in movers] == ["b", "a", "c"]
    assert (movers[0]["old"], movers[0]["new"], movers[0]["change"]) == (60.0, 50.0, -10.0)


def test_returns_only_top_five():
    rows = []
    for i in range(8):
        rows += [row("2026-11-16", f"i{i}", 50.0), row("2026-11-17", f"i{i}", 50.0 + i + 1)]
    movers = top_movers(rows, "2026-11-17")
    assert [m["item_id"] for m in movers] == ["i7", "i6", "i5", "i4", "i3"]


def test_ties_are_broken_by_item_id():
    rows = [
        row("2026-11-16", "zed", 50.0), row("2026-11-17", "zed", 55.0),
        row("2026-11-16", "abe", 50.0), row("2026-11-17", "abe", 45.0),
    ]
    assert [m["item_id"] for m in top_movers(rows, "2026-11-17")] == ["abe", "zed"]


def test_unchanged_items_are_not_movers():
    rows = [row("2026-11-16", "a", 70.0), row("2026-11-17", "a", 70.0)]
    assert top_movers(rows, "2026-11-17") == []


def test_float_noise_is_rounded_away():
    rows = [row("2026-11-16", "a", 70.1), row("2026-11-17", "a", 70.4)]
    assert top_movers(rows, "2026-11-17")[0]["change"] == 0.3  # not 0.30000000000000004


def test_first_day_has_nothing_to_compare():
    assert top_movers([row("2026-11-17", "a", 70.0)], "2026-11-17") == []


def test_missing_values_are_skipped():
    rows = [
        row("2026-11-16", "a", None), row("2026-11-17", "a", 80.0),   # nothing before
        row("2026-11-16", "b", 70.0), row("2026-11-17", "b", None),   # nothing today
    ]
    assert top_movers(rows, "2026-11-17") == []


def test_compares_with_the_latest_earlier_value_when_a_day_was_missed():
    rows = [
        row("2026-11-14", "a", 40.0),
        row("2026-11-15", "a", 60.0),
        row("2026-11-17", "a", 65.0),  # nothing on the 16th
    ]
    (m,) = top_movers(rows, "2026-11-17")
    assert (m["old"], m["new"], m["previous_date"]) == (60.0, 65.0, "2026-11-15")


def test_ignores_later_dates():
    rows = [row("2026-11-16", "a", 50.0), row("2026-11-17", "a", 60.0), row("2026-11-18", "a", 99.0)]
    (m,) = top_movers(rows, "2026-11-17")
    assert (m["old"], m["new"]) == (50.0, 60.0)
