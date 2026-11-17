// Sunny Escapes: shared code for every page. All calculations happen in the browser.
"use strict";

const HISTORY_URL = "data/history.csv";
const STATUS_URL = "data/status.json";
const NUMERIC = ["temp_high_f", "temp_low_f", "precip_in", "uv_index", "wind_max_mph", "sunshine_hours"];

const PAGES = [
  { id: "today", href: "index.html", label: "Today" },
  { id: "browse", href: "browse.html", label: "Browse" },
  { id: "trends", href: "trends.html", label: "Trends" },
];

const PLACE_EMOJI = {
  paris: "🗼", santorini: "🏛️", amalfi: "🍋", dubai: "🏙️", maldives: "🏝️", bali: "🛕",
  tokyo: "🗾", "bora-bora": "🐠", maui: "🌺", cabo: "🌵", tulum: "🌴", nassau: "⛵",
};

// ---------- tiny DOM helper (text is always set as text, never as HTML) ----------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

// ---------- shared page chrome: hero, nav bar, footer ----------

function renderChrome() {
  const page = document.body.dataset.page;
  const title = document.body.dataset.title || "";
  const subtitle = document.body.dataset.subtitle || "";

  const links = PAGES.map(p => h("a", { href: p.href, "aria-current": p.id === page ? "page" : null }, p.label));
  const hero = h("header", { class: "hero" },
    h("div", { class: "hero-scene", "aria-hidden": "true" },
      h("img", { class: "hero-sun", src: "images/sun.svg", alt: "" }),
      h("img", { class: "palm palm-left", src: "images/palm.svg", alt: "" }),
      h("img", { class: "palm palm-right", src: "images/palm.svg", alt: "" })),
    h("nav", { class: "nav", "aria-label": "Main" },
      h("a", { class: "brand script", href: "index.html" }, "Sunny Escapes"),
      h("div", { class: "nav-links" }, links)),
    h("div", { class: "hero-text" },
      h("h1", { class: "script" }, title),
      subtitle && h("p", null, subtitle)),
    h("div", { class: "waves", "aria-hidden": "true" },
      h("div", { class: "wave wave-1" }), h("div", { class: "wave wave-2" }), h("div", { class: "wave wave-3" })));

  const footer = h("footer", { class: "site-footer" },
    h("img", { src: "images/starfish.svg", alt: "" }),
    h("p", null, "Daily weather for dream beach getaways."),
    h("p", null, "Weather data from ", h("a", { href: "https://open-meteo.com/" }, "Open-Meteo"), "."));

  document.body.prepend(hero);
  document.body.append(footer);
}

// ---------- data loading ----------

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseHistory(text) {
  const [header, ...body] = parseCSV(text);
  return body.map(cells => {
    const r = {};
    header.forEach((name, i) => {
      const v = (cells[i] ?? "").trim();
      r[name] = NUMERIC.includes(name) ? (v === "" || isNaN(Number(v)) ? null : Number(v)) : v;
    });
    return r;
  });
}

async function fetchOrThrow(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

async function loadData() {
  const [csv, status] = await Promise.all([
    fetchOrThrow(HISTORY_URL).then(r => r.text()),
    fetchOrThrow(STATUS_URL).then(r => r.json()),
  ]);
  return { rows: parseHistory(csv), status };
}

// ---------- the move rule (same as tracker/moves.py) ----------

const FIELD = "temp_high_f";

// Each item's most recent earlier row (before `date`) that has a high recorded.
function previousRows(rows, date) {
  const earlier = new Map();
  for (const r of rows) {
    if (r[FIELD] === null || !(r.date < date)) continue;
    const best = earlier.get(r.item_id);
    if (!best || r.date > best.date) earlier.set(r.item_id, r);
  }
  return earlier;
}

const round2 = x => Math.round(x * 100) / 100;

// Rank items by |change| in daily high between `date` and their previous value.
// Items with no value today, no earlier value, or no change are left out.
// Ties are broken by item_id.
function topMovers(rows, date, n = 5) {
  const today = new Map();
  for (const r of rows) if (r[FIELD] !== null && r.date === date) today.set(r.item_id, r);
  const earlier = previousRows(rows, date);

  const movers = [];
  for (const [itemId, now] of today) {
    const old = earlier.get(itemId);
    if (!old) continue;
    const change = round2(now[FIELD] - old[FIELD]);
    if (change === 0) continue;
    movers.push({ item_id: itemId, item: now.item, old: old[FIELD], new: now[FIELD], change, previous_date: old.date });
  }
  movers.sort((a, b) => (Math.abs(b.change) - Math.abs(a.change)) || (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0));
  return movers.slice(0, n);
}

// ---------- formatting and look ----------

const fmt = (v, digits = 1) => (v === null || v === undefined ? "–" : v.toFixed(digits));
const signed = (v, digits = 1) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(digits);

function placeEmoji(itemId) { return PLACE_EMOJI[itemId] || "📍"; }

// Rain if it is wet, sun if it is very sunny, otherwise partly cloudy.
function weatherIcon(r) {
  if (r.precip_in !== null && r.precip_in >= 0.1) return { icon: "🌧️", label: "Rainy" };
  if (r.sunshine_hours !== null && r.sunshine_hours >= 8) return { icon: "☀️", label: "Sunny" };
  return { icon: "⛅", label: "Partly cloudy" };
}

// Cool aqua (50°F) -> golden -> hot coral (95°F).
function tempColor(f) {
  if (f === null) return "#e8eef2";
  const stops = [[46, 196, 182], [255, 209, 102], [255, 107, 107]];
  const t = Math.min(1, Math.max(0, (f - 50) / 45)) * 2;
  const i = Math.min(1, Math.floor(t)), k = t - i;
  const [a, b] = [stops[i], stops[i + 1]];
  return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * k)).join(",")})`;
}

function formatRunTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return { local: iso, utc: "" };
  return {
    local: d.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" }),
    utc: iso.replace("T", " ").replace(/:\d\dZ$/, " UTC"),
  };
}

const divider = () => h("div", { class: "divider", "aria-hidden": "true" });

// ---------- Today page ----------

function statBox(label, value, extra, cls) {
  return h("div", { class: "stat" },
    h("div", { class: "stat-value " + (cls || "") }, value),
    h("div", { class: "stat-label" }, label),
    extra && h("div", { class: "stat-names" }, extra));
}

function renderStatus(status, names, dataDate, hasPrevious) {
  const run = formatRunTime(status.run_time);
  const nameList = ids => ids.map(i => names.get(i) || i).join(", ");
  const sources = status.sources || [];

  const box = h("section", { class: "status glass", "aria-label": "Latest run" },
    h("p", { class: "last-run" }, "Last run: ", h("strong", null, run.local), run.utc && h("small", null, run.utc)),
    h("div", { class: "stats" },
      statBox("Destinations", String(status.items)),
      statBox("Days with success", String(status.days_with_success)),
      statBox("First run", status.first_run_date || "–", null, "date"),
      statBox("New today", String(status.new_today.length), nameList(status.new_today)),
      statBox("Gone today", String(status.gone_today.length), nameList(status.gone_today))),
    h("ul", { class: "sources", "aria-label": "Sources" },
      sources.length
        ? sources.map(s => h("li", { class: "source" + (s.ok ? "" : " failed") },
            (s.ok ? "✅ " : "❌ ") + s.name + ": " + (s.ok ? "ok" : "failed"), h("span", null, ` (${s.count})`)))
        : h("li", { class: "source failed" }, "No sources reported")));

  if (dataDate && dataDate !== status.run_time.slice(0, 10)) {
    box.append(h("p", { class: "notice" }, `Today's run has no data yet, so these are the latest values, from ${dataDate}.`));
  }
  if (!hasPrevious) {
    box.append(h("p", { class: "notice" }, "🌅 First day on the sand! Changes will show up once there are two days of data."));
  }
  return box;
}

function renderMoves(movers, hasPrevious) {
  if (!movers.length) {
    return h("p", { class: "empty glass" }, hasPrevious
      ? "🌊 Calm seas: no destination changed its daily high since the previous day."
      : "🌊 No moves yet. We need a previous day to compare with, so check back tomorrow.");
  }
  return h("ol", { class: "moves" }, movers.map((m, i) => {
    const up = m.change > 0;
    return h("li", { class: "move glass lift " + (up ? "up" : "down") },
      h("span", { class: "move-rank" }, "#" + (i + 1)),
      h("div", { class: "move-name" }, placeEmoji(m.item_id) + " " + m.item),
      h("div", { class: "move-arrow" }, up ? "↑ " : "↓ ", signed(m.change).replace(/^[+−]/, ""), h("small", null, "°F")),
      h("div", { class: "move-detail" }, `${fmt(m.old)}° → ${fmt(m.new)}°`),
      h("div", { class: "move-detail" }, up ? "Warmer" : "Cooler", " than ", m.previous_date));
  }));
}

function changeLine(r, prev) {
  if (r[FIELD] === null) return h("div", { class: "change none" }, "No high recorded");
  if (!prev) return h("div", { class: "change none" }, "✨ First day, no change yet");
  const d = round2(r[FIELD] - prev[FIELD]);
  const since = `since ${prev.date}`;
  if (d === 0) return h("div", { class: "change flat" }, `→ No change ${since}`);
  return h("div", { class: "change " + (d > 0 ? "up" : "down") }, `${d > 0 ? "↑" : "↓"} ${signed(d)}°F ${since}`);
}

function renderCard(r, prev) {
  const w = weatherIcon(r);
  const high = r[FIELD];
  return h("li", { class: "card glass lift" },
    h("div", { class: "card-top" },
      h("div", { class: "place-icon", "aria-hidden": "true" }, placeEmoji(r.item_id)),
      h("div", null,
        h("div", { class: "place-name" }, r.item),
        h("div", { class: "place-where" }, [r.country, r.region].filter(Boolean).join(" · "),
          r.vibe && h("span", { class: "tag" }, r.vibe))),
      h("div", { class: "weather-icon", role: "img", "aria-label": w.label, title: w.label }, w.icon)),
    h("div", { class: "card-main" },
      h("div", { class: "temp-badge", style: `background:${tempColor(high)}`, title: "Daily high" },
        high === null ? "–" : Math.round(high), h("span", { class: "unit" }, "°F")),
      h("div", null,
        h("div", { class: "temp-extra" }, `High ${fmt(high)}° · Low ${fmt(r.temp_low_f)}°`),
        changeLine(r, prev))),
    h("dl", { class: "facts" },
      h("div", null, h("dt", null, "🌧️ Rain"), h("dd", null, fmt(r.precip_in, 2) + (r.precip_in === null ? "" : " in"))),
      h("div", null, h("dt", null, "☀️ Sun"), h("dd", null, fmt(r.sunshine_hours) + (r.sunshine_hours === null ? "" : " h"))),
      h("div", null, h("dt", null, "🕶️ UV"), h("dd", null, fmt(r.uv_index))),
      h("div", null, h("dt", null, "💨 Wind"), h("dd", null, fmt(r.wind_max_mph) + (r.wind_max_mph === null ? "" : " mph")))));
}

async function initToday(main) {
  const { rows, status } = await loadData();
  const names = new Map(rows.map(r => [r.item_id, r.item]));
  const dates = rows.map(r => r.date).sort();
  const runDate = (status.run_time || "").slice(0, 10);
  const dataDate = dates.length ? dates[dates.length - 1] : null;

  const todayRows = rows.filter(r => r.date === dataDate).sort((a, b) => (a.item < b.item ? -1 : a.item > b.item ? 1 : 0));
  const earlier = dataDate ? previousRows(rows, dataDate) : new Map();
  const hasPrevious = dates.some(d => d < dataDate);
  const movers = dataDate ? topMovers(rows, dataDate, 5) : [];

  main.replaceChildren(
    renderStatus(status, names, dataDate || runDate, hasPrevious),
    divider(),
    h("section", { "aria-labelledby": "moves-h" },
      h("h2", { class: "section-title script", id: "moves-h" }, "Biggest moves"),
      h("p", { class: "section-note" }, "Top 5 changes in the daily high (°F) since each place's previous day."),
      renderMoves(movers, hasPrevious)),
    divider(),
    h("section", { "aria-labelledby": "dest-h" },
      h("h2", { class: "section-title script", id: "dest-h" }, "Destinations"),
      h("p", { class: "section-note" }, dataDate ? `Latest values, ${dataDate}.` : "No data yet."),
      todayRows.length
        ? h("ul", { class: "cards" }, todayRows.map(r => renderCard(r, earlier.get(r.item_id))))
        : h("p", { class: "empty glass" }, "No destinations have reported yet.")));
}

// ---------- start-up ----------

document.addEventListener("DOMContentLoaded", async () => {
  renderChrome();
  const main = document.getElementById("app");
  if (!main) return;
  main.append(h("p", { class: "empty glass" }, "🌊 Loading the latest waves…"));
  try {
    if (document.body.dataset.page === "today") await initToday(main);
  } catch (err) {
    console.error(err);
    main.replaceChildren(h("p", { class: "empty glass" },
      "😕 Couldn't load the data files. If you opened this page straight from disk, serve the folder instead (python -m http.server). ",
      h("small", null, String(err.message || err))));
  }
});
