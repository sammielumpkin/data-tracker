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

// ---------- Browse page ----------

const SHORTLIST_KEY = "sunny-escapes-shortlist";

const BROWSE_COLUMNS = [
  { key: "temp_high_f", label: "High °F", digits: 1 },
  { key: "temp_low_f", label: "Low °F", digits: 1 },
  { key: "precip_in", label: "Rain in", digits: 2 },
  { key: "uv_index", label: "UV", digits: 1 },
  { key: "wind_max_mph", label: "Wind mph", digits: 1 },
  { key: "sunshine_hours", label: "Sun h", digits: 1 },
];

function loadShortlist() {
  try {
    const v = JSON.parse(localStorage.getItem(SHORTLIST_KEY) || "[]");
    return new Set(Array.isArray(v) ? v.filter(x => typeof x === "string") : []);
  } catch (e) { return new Set(); }
}

function saveShortlist(set) {
  try { localStorage.setItem(SHORTLIST_KEY, JSON.stringify([...set])); } catch (e) { /* storage unavailable */ }
}

// Each destination's most recent row.
function latestRows(rows) {
  const latest = new Map();
  for (const r of rows) {
    const best = latest.get(r.item_id);
    if (!best || r.date > best.date) latest.set(r.item_id, r);
  }
  return [...latest.values()];
}

const uniqueSorted = vals => [...new Set(vals.filter(Boolean))].sort((a, b) => a.localeCompare(b));

async function initBrowse(main) {
  const { rows } = await loadData();
  const all = latestRows(rows);
  const shortlist = loadShortlist();
  const state = { region: "", vibe: "", search: "", only: false, sort: "item", dir: 1 };

  const option = (v, t) => h("option", { value: v }, t);
  const regionSel = h("select", { id: "f-region" }, option("", "All regions"), uniqueSorted(all.map(r => r.region)).map(v => option(v, v)));
  const vibeSel = h("select", { id: "f-vibe" }, option("", "All vibes"), uniqueSorted(all.map(r => r.vibe)).map(v => option(v, v)));
  const searchBox = h("input", { id: "f-search", type: "search", placeholder: "Search destinations…", autocomplete: "off" });
  const onlyBox = h("input", { id: "f-only", type: "checkbox" });

  const field = (id, label, control) => h("label", { class: "field", for: id }, h("span", null, label), control);
  const filters = h("section", { class: "filters glass", "aria-label": "Filters" },
    field("f-search", "Search", searchBox),
    field("f-region", "Region", regionSel),
    field("f-vibe", "Vibe", vibeSel),
    h("label", { class: "toggle", for: "f-only" }, onlyBox, h("span", null, "⭐ Show shortlist only")));

  const count = h("p", { class: "section-note", role: "status", "aria-live": "polite" });
  const tableWrap = h("div", { class: "table-wrap glass" });

  function sortHeader(key, label, numeric) {
    const active = state.sort === key;
    return h("th", { scope: "col", class: numeric ? "num" : "", "aria-sort": active ? (state.dir === 1 ? "ascending" : "descending") : "none" },
      h("button", { type: "button", class: "sort-btn" + (active ? " active" : ""), "data-sort": key, title: `Sort by ${label}` },
        label, h("span", { class: "arrow", "aria-hidden": "true" }, active ? (state.dir === 1 ? "▲" : "▼") : "↕")));
  }

  function visibleRows() {
    const q = state.search.trim().toLowerCase();
    const list = all.filter(r =>
      (!state.region || r.region === state.region) &&
      (!state.vibe || r.vibe === state.vibe) &&
      (!q || r.item.toLowerCase().includes(q)) &&
      (!state.only || shortlist.has(r.item_id)));
    const k = state.sort;
    list.sort((a, b) => {
      if (k === "item") return state.dir * a.item.localeCompare(b.item);
      const x = a[k], y = b[k];
      if (x === null && y === null) return a.item.localeCompare(b.item);
      if (x === null) return 1; // missing values always last
      if (y === null) return -1;
      return (x - y) * state.dir || a.item.localeCompare(b.item);
    });
    return list;
  }

  function render() {
    const list = visibleRows();
    count.textContent = `Showing ${list.length} of ${all.length} destinations · ⭐ ${shortlist.size} on your shortlist`;
    if (!list.length) {
      tableWrap.replaceChildren(h("p", { class: "empty" }, state.only && !shortlist.size
        ? "⭐ Your shortlist is empty. Tap a star to add a destination."
        : "🐚 No destinations match those filters."));
      return;
    }
    const table = h("table", { class: "browse-table" },
      h("thead", null, h("tr", null,
        h("th", { scope: "col", class: "star-col" }, h("span", { class: "sr-only" }, "Shortlist")),
        sortHeader("item", "Destination", false),
        ...BROWSE_COLUMNS.map(c => sortHeader(c.key, c.label, true)))),
      h("tbody", null, list.map(r => {
        const on = shortlist.has(r.item_id);
        return h("tr", null,
          h("td", { class: "star-col" },
            h("button", { type: "button", class: "star" + (on ? " on" : ""), "data-star": r.item_id,
              "aria-pressed": on ? "true" : "false",
              "aria-label": (on ? "Remove " : "Add ") + r.item + (on ? " from" : " to") + " shortlist" }, on ? "★" : "☆")),
          h("th", { scope: "row", class: "dest" },
            h("span", { class: "dest-name" }, placeEmoji(r.item_id) + " " + r.item),
            h("span", { class: "place-where" }, [r.country, r.region].filter(Boolean).join(" · "),
              r.vibe && h("span", { class: "tag" }, r.vibe))),
          ...BROWSE_COLUMNS.map(c => h("td", { class: "num" },
            c.key === "temp_high_f" && r[c.key] !== null
              ? h("span", { class: "temp-pill", style: `background:${tempColor(r[c.key])}` }, fmt(r[c.key], c.digits))
              : fmt(r[c.key], c.digits))));
      })));
    tableWrap.replaceChildren(table);
  }

  searchBox.addEventListener("input", () => { state.search = searchBox.value; render(); });
  regionSel.addEventListener("change", () => { state.region = regionSel.value; render(); });
  vibeSel.addEventListener("change", () => { state.vibe = vibeSel.value; render(); });
  onlyBox.addEventListener("change", () => { state.only = onlyBox.checked; render(); });

  tableWrap.addEventListener("click", e => {
    const sortBtn = e.target.closest("[data-sort]");
    if (sortBtn) {
      const key = sortBtn.dataset.sort;
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === "item" ? 1 : -1; }
      render();
      const again = tableWrap.querySelector(`[data-sort="${key}"]`);
      if (again) again.focus();
      return;
    }
    const star = e.target.closest("[data-star]");
    if (star) {
      const id = star.dataset.star;
      if (shortlist.has(id)) shortlist.delete(id); else shortlist.add(id);
      saveShortlist(shortlist);
      render();
      const again = tableWrap.querySelector(`[data-star="${id}"]`);
      if (again) again.focus();
    }
  });

  main.replaceChildren(
    filters,
    h("section", { "aria-labelledby": "browse-h" },
      h("h2", { class: "section-title script", id: "browse-h" }, "All destinations"),
      count,
      tableWrap));
  render();
}


// ---------- trends page ----------

const METRICS = [
  { key: "temp_high_f", label: "High temperature (°F)", unit: "°F" },
  { key: "temp_low_f", label: "Low temperature (°F)", unit: "°F" },
  { key: "precip_in", label: "Rain (inches)", unit: " in" },
  { key: "uv_index", label: "UV index", unit: "" },
  { key: "wind_max_mph", label: "Top wind (mph)", unit: " mph" },
  { key: "sunshine_hours", label: "Sunshine (hours)", unit: " h" },
];

// Beach palette, one colour per destination (dashed once the palette repeats).
const BEACH = ["#FF6B6B", "#0077B6", "#2EC4B6", "#F5A623", "#12324A", "#E8618C", "#5AA9E6", "#139E90", "#C8553D", "#7B6CD9", "#8AB17D", "#B08968"];
const seriesColor = i => BEACH[i % BEACH.length];

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const niceDate = d => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

function styleChartDefaults() {
  Chart.defaults.font.family = '"Poppins", system-ui, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = "#4A6275";
  Chart.defaults.borderColor = "rgba(0, 119, 182, 0.14)";
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.tooltip.backgroundColor = "#12324A";
  Chart.defaults.plugins.tooltip.cornerRadius = 10;
  Chart.defaults.plugins.tooltip.padding = 10;
}

function chartBox(label, tall) {
  const canvas = h("canvas", { role: "img", "aria-label": label });
  return { box: h("div", { class: "chart-box" + (tall ? " tall" : "") }, canvas), canvas };
}

const needsDays = (what, have, need) => h("p", { class: "needs-days" },
  `🏝️ We need more days for this one. ${what} needs at least ${plural(need, "day")} of history and we have ${have} so far. Check back tomorrow!`);

function finding(title, explain, body) {
  return h("section", { class: "finding glass" }, h("h2", null, title), h("p", { class: "explain" }, explain), body);
}

// Rows grouped by destination, oldest first, skipping rows with no value for `key`.
function seriesByItem(rows, key) {
  const m = new Map();
  for (const r of rows) {
    if (r[key] === null) continue;
    if (!m.has(r.item_id)) m.set(r.item_id, { id: r.item_id, name: r.item, points: [] });
    m.get(r.item_id).points.push({ date: r.date, v: r[key] });
  }
  for (const s of m.values()) s.points.sort((a, b) => (a.date < b.date ? -1 : 1));
  return m;
}

const barScales = unit => ({
  x: { grid: { display: false } },
  y: { grid: { color: "rgba(0, 119, 182, 0.12)" }, title: { display: true, text: unit } },
});

// --- the line chart explorer: pick a value and the destinations ---
function buildExplorer(rows, dates) {
  const names = new Map();
  for (const r of rows) names.set(r.item_id, r.item);
  const ids = [...names.keys()].sort((a, b) => names.get(a).localeCompare(names.get(b)));
  const colorOf = Object.fromEntries(ids.map((id, i) => [id, seriesColor(i)]));
  const shown = new Set(ids);

  const select = h("select", { id: "t-metric" }, METRICS.map(m => h("option", { value: m.key }, m.label)));
  const { box, canvas } = chartBox("Line chart of the chosen weather value for each selected destination over the days", true);
  const picker = h("fieldset", { class: "picker" }, h("legend", null, "Destinations"));
  const mini = (text, fn) => { const b = h("button", { type: "button", class: "mini-btn" }, text); b.addEventListener("click", fn); return b; };

  const chart = new Chart(canvas, {
    type: "line",
    data: { labels: dates.map(niceDate), datasets: [] },
    options: {
      interaction: { mode: "nearest", intersect: false },
      plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false } }, y: { grid: { color: "rgba(0, 119, 182, 0.12)" }, title: { display: true, text: "" } } },
    },
  });

  function draw() {
    const metric = METRICS.find(m => m.key === select.value);
    const byItem = seriesByItem(rows, metric.key);
    chart.data.datasets = ids.filter(id => shown.has(id)).map(id => {
      const byDate = new Map((byItem.get(id)?.points || []).map(p => [p.date, p.v]));
      return {
        label: names.get(id), data: dates.map(d => byDate.get(d) ?? null),
        borderColor: colorOf[id], backgroundColor: colorOf[id], tension: 0.3,
        pointRadius: 4, pointHoverRadius: 6, borderWidth: 2.5, spanGaps: true,
      };
    });
    chart.options.scales.y.title.text = metric.label;
    chart.options.plugins.tooltip = { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y, 2)}${metric.unit}` } };
    chart.update();
  }

  for (const id of ids) {
    const box_ = h("input", { type: "checkbox", checked: true, value: id });
    box_.addEventListener("change", () => { box_.checked ? shown.add(id) : shown.delete(id); draw(); });
    picker.append(h("label", { class: "pick" }, box_, h("span", { class: "swatch", style: `background:${colorOf[id]}` }), names.get(id)));
  }
  const setAll = on => () => {
    picker.querySelectorAll("input").forEach(i => { i.checked = on; on ? shown.add(i.value) : shown.delete(i.value); });
    draw();
  };
  picker.append(h("div", { class: "picker-actions" }, mini("Select all", setAll(true)), mini("Clear all", setAll(false))));
  select.addEventListener("change", draw);
  draw();

  const note = dates.length < 3
    ? h("p", { class: "section-note" }, `Only ${plural(dates.length, "day")} of data so far, so the lines are just starting. They fill in every day.`)
    : null;

  return h("section", { class: "explorer glass" },
    h("h2", null, "Every value, day by day"),
    h("p", { class: "section-note" }, "Pick a value and the destinations to compare. Straight from history.csv."),
    h("label", { class: "field", for: "t-metric" }, h("span", null, "Value"), select),
    picker, note, box);
}

// --- finding 1: biggest rise or fall in high temp since the first day ---
function findingSinceStart(rows, dates) {
  const heading = "Biggest change in high temp since the first day";
  const intro = "Compares each destination's high on the latest day with its high on the first day recorded.";
  if (dates.length < 3) return finding(heading, intro, needsDays("Comparing against the first day", plural(dates.length, "day"), 3));
  const first = dates[0], last = dates[dates.length - 1];
  const changes = [];
  for (const s of seriesByItem(rows, "temp_high_f").values()) {
    const a = s.points.find(p => p.date === first), b = s.points.find(p => p.date === last);
    if (a && b) changes.push({ name: s.name, a: a.v, b: b.v, change: round2(b.v - a.v) });
  }
  if (!changes.length) return finding(heading, intro, needsDays("Comparing against the first day", plural(dates.length, "day"), 3));
  changes.sort((x, y) => y.change - x.change);
  const top = changes.reduce((best, c) => (Math.abs(c.change) > Math.abs(best.change) ? c : best));
  const title = top.change === 0
    ? `No destination's high temp has changed since ${niceDate(first)}`
    : `${top.name} has ${top.change > 0 ? "warmed up" : "cooled down"} the most: ${signed(top.change)}°F since ${niceDate(first)}`;
  const explain = h("span", null,
    "For each destination we take temp_high_f on the first date in history.csv (", niceDate(first), ") and subtract it from temp_high_f on the latest date (", niceDate(last), "). The biggest change, up or down, wins: ",
    h("strong", null, `${top.name}, ${fmt(top.a)}°F to ${fmt(top.b)}°F (${signed(top.change)}°F)`),
    `. ${plural(changes.length, "destination")} had a value on both days and are compared below.`);
  const { box, canvas } = chartBox(`Bar chart of the change in high temperature since ${first} for each destination`);
  new Chart(canvas, {
    type: "bar",
    data: { labels: changes.map(c => c.name), datasets: [{ label: "Change in high (°F)", data: changes.map(c => c.change), backgroundColor: changes.map(c => (c.change >= 0 ? "#FF6B6B" : "#2EC4B6")), borderRadius: 8 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${signed(ctx.parsed.y)}°F` } } }, scales: barScales("Change in high (°F)") },
  });
  return finding(title, explain, box);
}

// --- finding 2: biggest single move in temp_high_f ---
function findingBiggestMove(rows, dates) {
  const heading = "Biggest single-day move in high temp";
  const intro = "Looks for the largest jump or drop in one destination's high from one day to the next.";
  if (dates.length < 3) return finding(heading, intro, needsDays("Finding the biggest move", plural(dates.length, "day"), 3));
  const moves = [];
  for (const s of seriesByItem(rows, "temp_high_f").values())
    for (let i = 1; i < s.points.length; i++)
      moves.push({ name: s.name, date: s.points[i].date, prev: s.points[i - 1].date, from: s.points[i - 1].v, to: s.points[i].v, change: round2(s.points[i].v - s.points[i - 1].v) });
  if (!moves.length) return finding(heading, intro, needsDays("Finding the biggest move", plural(dates.length, "day"), 3));
  const biggest = list => list.reduce((best, m) => (Math.abs(m.change) > Math.abs(best.change) ? m : best));
  const top = biggest(moves);
  const title = top.change === 0
    ? "No destination's high temp has moved from one day to the next"
    : `${niceDate(top.date)}: ${top.name} ${top.change > 0 ? "jumped" : "dropped"} ${Math.abs(top.change).toFixed(1)}°F in a day`;
  const explain = h("span", null,
    "For every destination we subtract each day's temp_high_f from the previous recorded day's value in history.csv, then keep the largest change in either direction: ",
    h("strong", null, `${top.name}, ${fmt(top.from)}°F on ${niceDate(top.prev)} to ${fmt(top.to)}°F on ${niceDate(top.date)} (${signed(top.change)}°F)`),
    `. The chart shows the biggest move made on each day, across ${plural(moves.length, "move")} in total.`);
  const perDay = dates.slice(1).map(d => { const day = moves.filter(m => m.date === d); return day.length ? biggest(day) : null; });
  const { box, canvas } = chartBox("Bar chart of the biggest one-day change in high temperature on each day");
  new Chart(canvas, {
    type: "bar",
    data: { labels: dates.slice(1).map(niceDate), datasets: [{ label: "Biggest move (°F)", data: perDay.map(m => (m ? m.change : null)),
      backgroundColor: perDay.map(m => (m === top ? "#FF6B6B" : "#5AA9E6")), borderRadius: 8 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: {
      label: ctx => { const m = perDay[ctx.dataIndex]; return m ? ` ${m.name}: ${signed(m.change)}°F` : ""; } } } }, scales: barScales("Change in high (°F)") },
  });
  return finding(title, explain, box);
}

// --- finding 3: warmest vs coolest destination by average high ---
function findingSpread(rows, dates) {
  const avgs = [...seriesByItem(rows, "temp_high_f").values()].map(s => ({ name: s.name, avg: mean(s.points.map(p => p.v)), n: s.points.length }));
  const heading = "Warmest vs. coolest destination";
  if (dates.length < 3 || avgs.length < 2) return finding(heading, "Compares the average high temperature of each destination.", needsDays("An average over time", plural(dates.length, "day"), 3));
  avgs.sort((a, b) => b.avg - a.avg);
  const hot = avgs[0], cool = avgs[avgs.length - 1], spread = hot.avg - cool.avg;
  const title = `${spread.toFixed(1)}°F separates the warmest (${hot.name}) from the coolest (${cool.name})`;
  const explain = h("span", null,
    `We average temp_high_f over all ${plural(dates.length, "day")} in history.csv for each destination, then subtract the lowest average from the highest: `,
    h("strong", null, `${fmt(hot.avg)}°F (${hot.name}) minus ${fmt(cool.avg)}°F (${cool.name}) = ${spread.toFixed(1)}°F`),
    ".");
  const { box, canvas } = chartBox("Bar chart of average high temperature for each destination");
  new Chart(canvas, {
    type: "bar",
    data: { labels: avgs.map(a => a.name), datasets: [{ label: "Average high (°F)", data: avgs.map(a => round2(a.avg)),
      backgroundColor: avgs.map((a, i) => (i === 0 ? "#FF6B6B" : i === avgs.length - 1 ? "#2EC4B6" : "#FFB385")), borderRadius: 8 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.parsed.y, 1)}°F` } } }, scales: barScales("Average high (°F)") },
  });
  return finding(title, explain, box);
}

// --- finding 4: sunniest vs rainiest ---
function findingSunRain(rows, dates) {
  const sun = seriesByItem(rows, "sunshine_hours"), rain = seriesByItem(rows, "precip_in");
  const stats = [...new Set([...sun.keys(), ...rain.keys()])].map(id => {
    const s = sun.get(id), r = rain.get(id);
    return { name: (s || r).name, sun: s ? mean(s.points.map(p => p.v)) : null, rain: r ? r.points.reduce((a, p) => a + p.v, 0) : null };
  });
  const withSun = stats.filter(s => s.sun !== null), withRain = stats.filter(s => s.rain !== null);
  const heading = "Sunniest vs. rainiest destinations";
  if (dates.length < 3 || !withSun.length || !withRain.length) return finding(heading, "Compares average sunshine and total rain for each destination.", needsDays("Averages and totals", plural(dates.length, "day"), 3));
  const sunniest = withSun.reduce((b, s) => (s.sun > b.sun ? s : b));
  const rainiest = withRain.reduce((b, s) => (s.rain > b.rain ? s : b));
  const title = `${sunniest.name} is the sunniest (${sunniest.sun.toFixed(1)} h a day) and ${rainiest.name} the rainiest (${rainiest.rain.toFixed(2)} in)`;
  const explain = h("span", null,
    `Sunshine is the average of sunshine_hours per day and rain is the total of precip_in, both over ${plural(dates.length, "day")} of history.csv. `,
    h("strong", null, `Sunniest: ${sunniest.name}, ${sunniest.sun.toFixed(2)} h a day. Rainiest: ${rainiest.name}, ${rainiest.rain.toFixed(2)} in in total.`),
    ` ${rainiest.rain === 0 ? "Nothing has rained yet, so the rainiest pick is just the first in the list." : ""}`);
  stats.sort((a, b) => (b.sun ?? -1) - (a.sun ?? -1));
  const { box, canvas } = chartBox("Bar chart of average daily sunshine hours and total rain in inches for each destination", true);
  new Chart(canvas, {
    type: "bar",
    data: { labels: stats.map(s => s.name), datasets: [
      { label: "Avg sunshine (h/day)", data: stats.map(s => (s.sun === null ? null : round2(s.sun))), backgroundColor: "#FFD166", borderRadius: 8, yAxisID: "y" },
      { label: "Total rain (in)", data: stats.map(s => (s.rain === null ? null : round2(s.rain))), backgroundColor: "#0077B6", borderRadius: 8, yAxisID: "y2" },
    ] },
    options: { scales: {
      x: { grid: { display: false } },
      y: { position: "left", beginAtZero: true, grid: { color: "rgba(0, 119, 182, 0.12)" }, title: { display: true, text: "Sunshine (h/day)" } },
      y2: { position: "right", beginAtZero: true, grid: { display: false }, title: { display: true, text: "Rain (in)" } },
    } },
  });
  return finding(title, explain, box);
}

async function initTrends(main) {
  const { rows } = await loadData();
  const dates = [...new Set(rows.map(r => r.date))].sort();
  main.replaceChildren();
  if (!rows.length) { main.append(h("p", { class: "empty glass" }, "🏝️ No history yet. Check back after the first daily update.")); return; }
  if (typeof Chart === "undefined") throw new Error("Chart.js did not load (vendor/chart.umd.min.js)");
  styleChartDefaults();
  main.append(
    ...(dates.length < 3 ? [h("p", { class: "notice" }, `🌴 We only have ${plural(dates.length, "day")} of history so far. Some findings need more days and will appear on their own as the history grows.`)] : []),
    buildExplorer(rows, dates),
    findingSinceStart(rows, dates),
    findingBiggestMove(rows, dates),
    findingSpread(rows, dates),
    findingSunRain(rows, dates));
}

// ---------- start-up ----------

document.addEventListener("DOMContentLoaded", async () => {
  renderChrome();
  const main = document.getElementById("app");
  if (!main) return;
  main.append(h("p", { class: "empty glass" }, "🌊 Loading the latest waves…"));
  try {
    const page = document.body.dataset.page;
    if (page === "today") await initToday(main);
    else if (page === "browse") await initBrowse(main);
    else if (page === "trends") await initTrends(main);
  } catch (err) {
    console.error(err);
    main.replaceChildren(h("p", { class: "empty glass" },
      "😕 Couldn't load the data files. If you opened this page straight from disk, serve the folder instead (python -m http.server). ",
      h("small", null, String(err.message || err))));
  }
});
