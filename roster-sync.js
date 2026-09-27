/*
  Bridgewater Bocce — Rec League roster sync
  Reads player names from the "Fall '26 Rec League Rosters" Google Sheet
  (shared as "Anyone with the link — Viewer") via its CSV-export URL, and
  fills them into team-rosters.html's nine per-team tables
  (data-team="Team 1" through "Team 9").

  Sheet layout (row 1 is the header, skipped by position):
    Team, Player 1, Player 2, Player 3, Player 4, Player 5, Player 6
  "Team" is just the plain number 1-9. A blank player cell leaves that
  seat's existing "Player name placeholder" text in place — this script
  only ever fills in names, it never removes or blanks a row. If the
  fetch fails for any reason, the page is left exactly as it was.
*/
(function () {
  var SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1z0PNHH2Xff5jPsm-hAJTI5scq4DJDFrAIb-OAiPm6Cc/export?format=csv";

  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function dataRowsOf(table) {
    return Array.prototype.slice.call(table.querySelectorAll("tr")).filter(function (tr) {
      return !tr.querySelector("th");
    });
  }

  function applyRoster(text) {
    var rows = parseCSV(text).slice(1); // skip header row
    rows.forEach(function (cols) {
      var teamNum = (cols[0] || "").trim();
      if (!teamNum) return;
      var table = document.querySelector('table[data-team="Team ' + teamNum + '"]');
      if (!table) return;
      var seats = dataRowsOf(table);
      for (var i = 0; i < seats.length; i++) {
        var name = (cols[i + 1] || "").trim();
        if (!name) continue; // leave existing placeholder text in place
        var td = seats[i].querySelector("td");
        if (td) td.textContent = name;
      }
    });
  }

  function load() {
    fetch(SHEET_CSV_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("Sheet fetch failed: " + res.status);
        return res.text();
      })
      .then(applyRoster)
      .catch(function (err) {
        console.error("Roster sync error:", err);
      });
  }

  window.RosterSync = { load: load };
  load();
})();
