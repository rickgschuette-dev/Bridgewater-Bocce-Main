/*
  Bridgewater Bocce — Player Evaluations (league admin page)
  Reads the "Player Evaluations (Responses)" Google Sheet, tab "Form Responses 1",
  through its CSV export link (same method as wp-pd.js).
  Column order in the sheet (written by the Google Form):
    A Timestamp | B Player first name | C Player last name |
    D Date of evaluation | E Initial rating level | F Eval notes |
    G Updated Player Rating
  Two views:
    "By player" (default): one card per player, alphabetical by last name, with the
      rating trend and every note for that player together, oldest to newest.
      A player is the same person when first + last name match (ignoring capital
      letters and extra spaces), so a misspelled name will appear as a second player.
    "All notes by date": one flat table, newest evaluation date first.
  Notes are never deleted by this page: every form submission is a permanent row in
  the sheet, and the admin can correct a note by editing that row in the sheet.
  This file is read-only: it never writes anything back to the sheet.
  Text from the sheet is inserted as plain text (never as HTML).
*/
(function () {
  var EVAL_CSV_URL = "https://docs.google.com/spreadsheets/d/1pI1fXTrm_lWNhG-4_dHEjV_xnBP1zMk-Al7r941rRZ4/export?format=csv&gid=109646289";

  var allRows = [];
  var view = "player"; // "player" or "date"

  function parseCSV(text) {
    var rows = [], row = [], field = "", inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; } }
        else field += c;
      } else if (c === '"') { inQuotes = true; }
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = ""; rows.push(row); row = [];
      } else field += c;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
  }

  // Sheet dates arrive as M/D/YYYY. Returns a sortable number, or 0 if unreadable.
  function dateValue(s) {
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec((s || "").trim());
    if (!m) return 0;
    return parseInt(m[3], 10) * 10000 + parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
  }

  function buildRows(csvRows) {
    var out = [];
    csvRows.slice(1).forEach(function (c, idx) { // row 0 is the header
      var first = (c[1] || "").trim(), last = (c[2] || "").trim();
      var notes = (c[5] || "").trim();
      if (!first && !last && !notes) return; // skip blank rows
      out.push({
        order: idx,
        date: (c[3] || "").trim(),
        dv: dateValue(c[3]),
        first: first,
        last: last,
        rating: (c[4] || "").trim(),
        notes: notes,
        updated: (c[6] || "").trim()
      });
    });
    return out;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function playerKey(r) {
    return (r.first + "|" + r.last).toLowerCase().replace(/\s+/g, " ");
  }

  function matches(r, q) {
    if (!q) return true;
    return (r.first + " " + r.last + " " + r.last + ", " + r.first + " " + r.rating + " " + r.notes + " " + r.updated)
      .toLowerCase().indexOf(q) !== -1;
  }

  // Group the rows into players. Every note is kept for a player who has any match.
  function buildPlayers(rows, q) {
    var map = {};
    rows.forEach(function (r) {
      var k = playerKey(r);
      if (!map[k]) map[k] = { first: r.first, last: r.last, notes: [], hit: false };
      map[k].notes.push(r);
      if (matches(r, q)) map[k].hit = true;
    });
    var list = Object.keys(map).map(function (k) { return map[k]; }).filter(function (p) { return p.hit; });
    list.forEach(function (p) {
      p.notes.sort(function (a, b) { // oldest first
        if (a.dv !== b.dv) return a.dv - b.dv;
        return a.order - b.order;
      });
    });
    list.sort(function (a, b) {
      var l = a.last.toLowerCase().localeCompare(b.last.toLowerCase());
      return l !== 0 ? l : a.first.toLowerCase().localeCompare(b.first.toLowerCase());
    });
    return list;
  }

  // Rating trend: first initial rating on record -> latest updated rating (if any).
  function ratingText(p) {
    var start = "", now = "";
    p.notes.forEach(function (n) {
      if (!start && n.rating) start = n.rating;
      if (n.updated) now = n.updated;
    });
    if (!start && !now) return "";
    if (!now || now === start) return start;
    return (start || "?") + " → " + now;
  }

  function playerCard(p, openIt) {
    var d = el("details", "pe-player");
    if (openIt) d.open = true;
    var s = el("summary");
    s.appendChild(el("span", "pe-pname", (p.first + " " + p.last).trim()));
    var rt = ratingText(p);
    var meta = el("span", "pe-pmeta");
    if (rt) { meta.appendChild(document.createTextNode("Rating ")); meta.appendChild(el("b", "", rt)); meta.appendChild(document.createTextNode(" · ")); }
    var latest = p.notes[p.notes.length - 1].date;
    meta.appendChild(document.createTextNode(p.notes.length + (p.notes.length === 1 ? " note" : " notes") + (latest ? " · latest " + latest : "")));
    s.appendChild(meta);
    d.appendChild(s);
    p.notes.forEach(function (n) {
      var item = el("div", "pe-entry-note");
      var head = el("div", "pe-nhead");
      head.appendChild(el("b", "", n.date || "No date"));
      var bits = [];
      if (n.rating) bits.push("Initial rating " + n.rating);
      if (n.updated) bits.push("Updated rating " + n.updated);
      if (bits.length) head.appendChild(document.createTextNode(" · " + bits.join(" · ")));
      item.appendChild(head);
      item.appendChild(el("div", "pe-ntext", n.notes));
      d.appendChild(item);
    });
    return d;
  }

  function cell(tr, cls, text) {
    var td = el("td", cls, text);
    tr.appendChild(td);
  }

  function renderDateTable(box, rows, q) {
    var shown = rows.filter(function (r) { return matches(r, q); }).sort(function (a, b) {
      if (b.dv !== a.dv) return b.dv - a.dv;
      return b.order - a.order;
    });
    document.getElementById("pe-count").textContent = "Showing " + shown.length + " of " + rows.length + " notes";
    if (!shown.length) { box.appendChild(el("p", "pe-note", "No evaluations match that search.")); return; }
    var wrap = el("div", "pe-scroll");
    var table = el("table", "standings-table pe-table");
    var head = el("tr");
    ["Date", "Player", "Initial rating", "Eval notes", "Updated rating"].forEach(function (h) { head.appendChild(el("th", "", h)); });
    table.appendChild(head);
    shown.forEach(function (r) {
      var tr = el("tr");
      cell(tr, "pe-date", r.date);
      cell(tr, "pe-name", (r.first + " " + r.last).trim());
      cell(tr, "pe-rating", r.rating);
      cell(tr, "pe-notes", r.notes);
      cell(tr, "pe-rating", r.updated);
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    box.appendChild(wrap);
  }

  function render() {
    var box = document.getElementById("pe-list");
    var q = (document.getElementById("pe-search").value || "").trim().toLowerCase();
    box.textContent = "";
    document.getElementById("pe-fold-tools").style.display = view === "player" ? "" : "none";
    if (!allRows.length) {
      document.getElementById("pe-count").textContent = "";
      box.appendChild(el("p", "pe-note", "No evaluations have been entered yet. They will appear here once the first form is submitted."));
      return;
    }
    if (view === "date") { renderDateTable(box, allRows, q); return; }
    var players = buildPlayers(allRows, q);
    var total = buildPlayers(allRows, "").length;
    document.getElementById("pe-count").textContent = "Showing " + players.length + " of " + total + " players";
    if (!players.length) { box.appendChild(el("p", "pe-note", "No evaluations match that search.")); return; }
    // Few players, or an active search: show notes open. Otherwise start folded.
    var openIt = !!q || total <= 8;
    players.forEach(function (p) { box.appendChild(playerCard(p, openIt)); });
  }

  function setAllOpen(flag) {
    var cards = document.querySelectorAll("#pe-list details.pe-player");
    for (var i = 0; i < cards.length; i++) cards[i].open = flag;
  }

  function setView(v) {
    view = v;
    document.getElementById("pe-view-player").className = "pe-view-btn" + (v === "player" ? " pe-on" : "");
    document.getElementById("pe-view-date").className = "pe-view-btn" + (v === "date" ? " pe-on" : "");
    render();
  }

  function load() {
    fetch(EVAL_CSV_URL, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("Evaluation sheet responded with status " + res.status);
        return res.text();
      })
      .then(function (text) {
        allRows = buildRows(parseCSV(text));
        render();
      })
      .catch(function () {
        var box = document.getElementById("pe-list");
        box.textContent = "";
        box.appendChild(el("p", "pe-note", "Evaluations couldn’t be loaded right now — please check back soon."));
      });
  }

  document.getElementById("pe-search").addEventListener("input", render);
  document.getElementById("pe-refresh").addEventListener("click", load);
  document.getElementById("pe-view-player").addEventListener("click", function () { setView("player"); });
  document.getElementById("pe-view-date").addEventListener("click", function () { setView("date"); });
  document.getElementById("pe-expand").addEventListener("click", function () { setAllOpen(true); });
  document.getElementById("pe-collapse").addEventListener("click", function () { setAllOpen(false); });

  // The form box stays closed until opened; the form loads only on first open.
  var entryBox = document.getElementById("pe-entry");
  var formFrame = document.getElementById("pe-form");
  entryBox.addEventListener("toggle", function () {
    if (entryBox.open && !formFrame.getAttribute("src")) {
      formFrame.setAttribute("src", formFrame.getAttribute("data-src"));
    }
  });

  load();
})();
