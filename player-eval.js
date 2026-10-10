/*
  Bridgewater Bocce — Player Evaluations (league admin page)
  Reads the "Player Evaluations (Responses)" Google Sheet, tab "Form Responses 1",
  through its CSV export link (same method as wp-pd.js) and lists every note.
  Column order in the sheet (written by the Google Form):
    A Timestamp | B Player first name | C Player last name |
    D Date of evaluation | E Initial rating level | F Eval notes |
    G Updated Player Rating
  Notes are never deleted by this page: every form submission is a permanent row
  in the sheet, and the admin can correct a note by editing that row in the sheet.
  This file is read-only: it never writes anything back to the sheet.
  Text from the sheet is inserted as plain text (never as HTML).
*/
(function () {
  var EVAL_CSV_URL = "https://docs.google.com/spreadsheets/d/1pI1fXTrm_lWNhG-4_dHEjV_xnBP1zMk-Al7r941rRZ4/export?format=csv&gid=109646289";

  var allRows = [];

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
    out.sort(function (a, b) {
      if (b.dv !== a.dv) return b.dv - a.dv;
      return b.order - a.order; // same date: most recently entered first
    });
    return out;
  }

  function cell(tr, cls, text) {
    var td = document.createElement("td");
    if (cls) td.className = cls;
    td.textContent = text;
    tr.appendChild(td);
  }

  function render() {
    var box = document.getElementById("pe-list");
    var countEl = document.getElementById("pe-count");
    var q = (document.getElementById("pe-search").value || "").trim().toLowerCase();
    var shown = allRows.filter(function (r) {
      if (!q) return true;
      return (r.first + " " + r.last + " " + r.last + ", " + r.first + " " + r.rating + " " + r.notes + " " + r.updated).toLowerCase().indexOf(q) !== -1;
    });
    countEl.textContent = allRows.length ? "Showing " + shown.length + " of " + allRows.length : "";
    box.textContent = "";
    if (!allRows.length) {
      var p0 = document.createElement("p");
      p0.className = "pe-note";
      p0.textContent = "No evaluations have been entered yet. They will appear here once the first form is submitted.";
      box.appendChild(p0);
      return;
    }
    if (!shown.length) {
      var p1 = document.createElement("p");
      p1.className = "pe-note";
      p1.textContent = "No evaluations match that search.";
      box.appendChild(p1);
      return;
    }
    var wrap = document.createElement("div");
    wrap.className = "pe-scroll";
    var table = document.createElement("table");
    table.className = "standings-table pe-table";
    var head = document.createElement("tr");
    ["Date", "Player", "Initial rating", "Eval notes", "Updated rating"].forEach(function (h) {
      var th = document.createElement("th");
      th.textContent = h;
      head.appendChild(th);
    });
    table.appendChild(head);
    shown.forEach(function (r) {
      var tr = document.createElement("tr");
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
        var p = document.createElement("p");
        p.className = "pe-note";
        p.textContent = "Evaluations couldn’t be loaded right now — please check back soon.";
        box.appendChild(p);
      });
  }

  document.getElementById("pe-search").addEventListener("input", render);

  // Refresh button: re-reads the sheet (use after submitting a new evaluation).
  document.getElementById("pe-refresh").addEventListener("click", load);

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
