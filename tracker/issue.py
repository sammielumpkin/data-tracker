"""Open (or update) the daily GitHub Issue and close earlier daily Issues.

Usage: python -m tracker issue [--repo OWNER/REPO] [--dry-run]

Needs GITHUB_TOKEN (and GITHUB_REPOSITORY=owner/repo, or --repo). The Issue title
is the UTC date of the latest run, e.g. "2026-11-17".
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

from . import paths
from .history import load_history
from .moves import top_movers

API = "https://api.github.com"
DATE_TITLE = re.compile(r"\d{4}-\d{2}-\d{2}")
MAX_PAGES = 20  # 2000 issues is far more than a daily tracker will ever have


# ---------- content ----------

def _names(ids, names):
    return ", ".join(f"{names.get(i, i)} (`{i}`)" for i in ids) or "none"


def render_body(status, movers, names):
    date = status["run_time"][:10]
    lines = [f"## Weather movers for {date}", ""]
    lines.append("Top 5 changes in daily high temperature (°F) since the previous run:")
    lines.append("")
    if movers:
        lines += ["| # | Destination | Old | New | Change |", "|---|---|---|---|---|"]
        for i, m in enumerate(movers, 1):
            lines.append(f"| {i} | {m['item']} | {m['old']:.1f} | {m['new']:.1f} | {m['change']:+.1f} |")
    else:
        lines.append("_No movers today: no change in highs, or no earlier data to compare with._")
    lines += [
        "",
        f"**New destinations:** {_names(status['new_today'], names)}",
        f"**Gone destinations:** {_names(status['gone_today'], names)}",
        "",
        "**Sources:** " + ", ".join(
            f"{s['name']} {'ok' if s['ok'] else 'FAILED'} ({s['count']})" for s in status["sources"]),
        f"**Destinations reporting today:** {status['items']}",
        f"_Last updated {status['run_time']}_",
    ]
    return "\n".join(lines) + "\n"


def build_issue(status, rows):
    date = status["run_time"][:10]
    movers = top_movers(rows, date, 5)
    names = {r["item_id"]: r["item"] for r in rows}
    return date, render_body(status, movers, names)


# ---------- GitHub API ----------

class GitHub:
    def __init__(self, repo, token):
        self.repo, self.token = repo, token

    def _request(self, method, path, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(f"{API}/repos/{self.repo}{path}", data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "data-tracker-class-project",
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"GitHub {method} {path} -> {e.code}: {e.read().decode(errors='replace')}") from e

    def list_issues(self, state):
        """Yield issues (not pull requests), newest first."""
        for page in range(1, MAX_PAGES + 1):
            batch = self._request("GET", f"/issues?state={state}&per_page=100&page={page}")
            for issue in batch:
                if "pull_request" not in issue:
                    yield issue
            if len(batch) < 100:
                return

    def create_issue(self, title, body):
        return self._request("POST", "/issues", {"title": title, "body": body})

    def update_issue(self, number, **fields):
        return self._request("PATCH", f"/issues/{number}", fields)


def sync_issue(client, date, body):
    """Create or update the Issue titled `date`, then close earlier daily Issues.

    Returns (action, number, closed_numbers).
    """
    existing = next((i for i in client.list_issues("all") if i["title"] == date), None)
    if existing:
        client.update_issue(existing["number"], body=body)
        action, number = "updated", existing["number"]
    else:
        number = client.create_issue(date, body)["number"]
        action = "created"

    # Today's Issue is safely in place; now close any older daily Issues still open.
    closed = []
    for issue in list(client.list_issues("open")):
        title = issue["title"]
        if DATE_TITLE.fullmatch(title) and title < date:
            client.update_issue(issue["number"], state="closed")
            closed.append(issue["number"])
    return action, number, closed


# ---------- command ----------

def main(argv):
    ap = argparse.ArgumentParser(prog="python -m tracker issue")
    ap.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY"), help="owner/repo")
    ap.add_argument("--dry-run", action="store_true", help="print the Issue instead of sending it")
    args = ap.parse_args(argv)

    with open(paths.STATUS_JSON, encoding="utf-8") as f:
        status = json.load(f)
    date, body = build_issue(status, load_history())

    if args.dry_run:
        print(f"Title: {date}\n\n{body}")
        return 0

    token = os.environ.get("GITHUB_TOKEN")
    if not token or not args.repo:
        print("GITHUB_TOKEN and a repo (GITHUB_REPOSITORY or --repo) are required.", file=sys.stderr)
        return 1
    action, number, closed = sync_issue(GitHub(args.repo, token), date, body)
    print(f"Issue #{number} {action} ({date}); closed: {closed or 'none'}")
    return 0
