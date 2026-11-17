"""Daily Issue content and create/update/close behavior (GitHub API is faked)."""
from tracker.issue import build_issue, sync_issue


class FakeGitHub:
    def __init__(self, issues=()):
        self.issues = [dict(i) for i in issues]
        self.calls = []

    def list_issues(self, state):
        return [i for i in self.issues if state == "all" or i["state"] == state]

    def create_issue(self, title, body):
        issue = {"number": len(self.issues) + 1, "title": title, "body": body, "state": "open"}
        self.issues.append(issue)
        self.calls.append(("create", title))
        return issue

    def update_issue(self, number, **fields):
        next(i for i in self.issues if i["number"] == number).update(fields)
        self.calls.append(("update", number, tuple(fields)))


def issue(number, title, state="open"):
    return {"number": number, "title": title, "state": state, "body": ""}


def status(**kw):
    base = {"run_time": "2026-11-17T12:00:00Z", "items": 2, "new_today": [], "gone_today": [],
            "sources": [{"name": "open-meteo", "ok": True, "count": 2}]}
    return {**base, **kw}


def row(date, item_id, high):
    return {"date": date, "item_id": item_id, "item": item_id.title(), "temp_high_f": high}


def test_title_is_the_utc_date_and_body_lists_movers_with_old_and_new():
    rows = [row("2026-11-16", "paris", 60.0), row("2026-11-17", "paris", 52.5),
            row("2026-11-16", "tokyo", 50.0), row("2026-11-17", "tokyo", 51.0)]
    title, body = build_issue(status(), rows)
    assert title == "2026-11-17"
    assert "| 1 | Paris | 60.0 | 52.5 | -7.5 |" in body
    assert "| 2 | Tokyo | 50.0 | 51.0 | +1.0 |" in body


def test_body_lists_new_and_gone_destinations_by_name():
    rows = [row("2026-11-17", "paris", 60.0), row("2026-11-16", "tokyo", 50.0)]
    _, body = build_issue(status(new_today=["paris"], gone_today=["tokyo"]), rows)
    assert "**New destinations:** Paris (`paris`)" in body
    assert "**Gone destinations:** Tokyo (`tokyo`)" in body


def test_body_is_still_written_when_nothing_changed():
    rows = [row("2026-11-16", "paris", 60.0), row("2026-11-17", "paris", 60.0)]
    title, body = build_issue(status(), rows)
    assert title == "2026-11-17"
    assert "No movers today" in body
    assert "**New destinations:** none" in body and "**Gone destinations:** none" in body


def test_body_shows_failed_sources():
    _, body = build_issue(status(items=0, sources=[{"name": "open-meteo", "ok": False, "count": 0}]), [])
    assert "open-meteo FAILED (0)" in body


def test_creates_the_days_issue_when_none_exists():
    gh = FakeGitHub()
    action, number, closed = sync_issue(gh, "2026-11-17", "body")
    assert (action, closed) == ("created", [])
    assert gh.issues[0]["title"] == "2026-11-17" and gh.issues[0]["body"] == "body"


def test_second_run_same_day_updates_instead_of_creating():
    gh = FakeGitHub()
    sync_issue(gh, "2026-11-17", "first")
    action, number, _ = sync_issue(gh, "2026-11-17", "second")
    assert action == "updated"
    assert len(gh.issues) == 1
    assert gh.issues[0]["body"] == "second"
    assert [c[0] for c in gh.calls].count("create") == 1


def test_closes_the_previous_days_issue():
    gh = FakeGitHub([issue(1, "2026-11-16")])
    _, number, closed = sync_issue(gh, "2026-11-17", "body")
    assert closed == [1]
    assert gh.issues[0]["state"] == "closed"
    assert next(i for i in gh.issues if i["number"] == number)["state"] == "open"


def test_does_not_close_todays_issue_unrelated_issues_or_future_ones():
    gh = FakeGitHub([issue(1, "Fix the chart"), issue(2, "2026-11-18")])
    sync_issue(gh, "2026-11-17", "body")
    sync_issue(gh, "2026-11-17", "body again")
    assert all(i["state"] == "open" for i in gh.issues)


def test_already_closed_issue_is_not_touched_again():
    gh = FakeGitHub([issue(1, "2026-11-16", state="closed")])
    sync_issue(gh, "2026-11-17", "body")
    assert ("update", 1, ("state",)) not in gh.calls
