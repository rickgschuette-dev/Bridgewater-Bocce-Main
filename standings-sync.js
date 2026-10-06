/*
  Bridgewater Bocce — Rec League results & standings sync
  Reads the "Bridgewater_Fall26_Rec_League_Game_Scores" Google Sheet and builds:
    1) a "Weekly results" box (id="standings-current"): one collapsible box per
       week that has scores, newest week first and open, older weeks closed.
       Each match-up shows the two team names as column headings with that
       match-up's three game scores listed beneath them (winning score bold).
       Beneath the weekly boxes, an "Up next" strip shows the next unplayed
       week's match-ups with each team's current games won-lost record.
    2) the season standings table (rows tagged data-team="1".."9" inside
       #standings-table-wrap) — Wins/Losses are total GAMES won and lost.
    3) on the Schedule page, each team's games won-lost record beneath its
       name in every match-up box.

  SHEET FORMAT (row 1 is a header row; columns in this exact order):
    A Week | B Date | C Time | D Visiting Team | E Home Team |
    F Visiting G1 | G Home G1 | H Visiting G2 | I Home G2 |
    J Visiting G3 | K Home G3 | (L blank) | M note (ignored)
   - Visiting Team is the team shown on the LEFT of the scoreboard and
     website; Home Team is the team on the RIGHT.
   - Leave a game's two score cells blank until that game has been played.
     A game counts only when BOTH of its score cells are filled in; the
     higher score wins that game.
   - If the fetch fails, or nothing has been scored yet, the page falls
     back to a friendly message / the static 0-0 table already in the
     HTML — it never breaks.
*/
(function () {
  var SCORES_CSV_URL = "https://docs.google.com/spreadsheets/d/1uqZa-7lQ8keGyMNIDgJCpt0YoigYfjovqNSotPd7JtQ/export?format=csv&gid=2036022231";
  var TEAM_COUNT = 9;

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

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function parseScore(raw) {
    raw = (raw || "").trim();
    if (raw === "") return null;
    var n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }

  // Groups the sheet's rows into an ordered array of week objects:
  // { n, dateStr, matches: [{ vis, home, games: [{ v, h }] }] }
  // A game is included only when both of its score cells are filled in.
  function buildWeeks(rows) {
    var byWeek = {};
    var order = [];
    rows.slice(1).forEach(function (cols) { // row 0 is the header
      var week = (cols[0] || "").trim();
      var dateStr = (cols[1] || "").trim();
      var timeStr = (cols[2] || "").trim();
      var vis = (cols[3] || "").trim();
      var home = (cols[4] || "").trim();
      if (!week || !vis || !home) return;

      var games = [];
      for (var g = 0; g < 3; g++) {
        var v = parseScore(cols[5 + g * 2]);
        var h = parseScore(cols[6 + g * 2]);
        if (v !== null && h !== null) games.push({ v: v, h: h });
      }

      if (!byWeek[week]) { byWeek[week] = { n: week, dateStr: dateStr, matches: [] }; order.push(week); }
      if (dateStr && !byWeek[week].dateStr) byWeek[week].dateStr = dateStr;
      byWeek[week].matches.push({ vis: vis, home: home, time: timeStr, games: games });
    });
    return order.map(function (w) { return byWeek[w]; });
  }

  function weekHasScores(wk) {
    return wk.matches.some(function (m) { return m.games.length > 0; });
  }

  // Total games won / lost per team across every game entered so far.
  function computeStats(weeks) {
    var stats = {};
    for (var t = 1; t <= TEAM_COUNT; t++) stats[t] = { w: 0, l: 0 };
    weeks.forEach(function (wk) {
      wk.matches.forEach(function (m) {
        m.games.forEach(function (g) {
          if (g.v === g.h) return; // tie — not expected, skipped rather than guessed
          var winner = g.v > g.h ? m.vis : m.home;
          var loser = g.v > g.h ? m.home : m.vis;
          if (stats[winner]) stats[winner].w += 1;
          if (stats[loser]) stats[loser].l += 1;
        });
      });
    });
    return stats;
  }

  function recordText(stats, team) {
    var s = stats[team];
    return s ? s.w + "–" + s.l : "";
  }

  function weekHeading(wk) {
    return "Week " + escapeHtml(wk.n) + (wk.dateStr ? " &mdash; Mon, " + escapeHtml(wk.dateStr) : "");
  }

  // One match-up: team names as column headings, "v." between them, the
  // three game scores listed vertically beneath (winning score in bold).
  function matchTableHtml(m) {
    var html = '<table class="mu"><tr><th>Team ' + escapeHtml(m.vis) + '</th><th class="vs">v.</th><th>Team ' +
      escapeHtml(m.home) + "</th></tr>";
    m.games.forEach(function (g) {
      var vTxt = g.v > g.h ? "<b>" + g.v + "</b>" : String(g.v);
      var hTxt = g.h > g.v ? "<b>" + g.h + "</b>" : String(g.h);
      html += "<tr><td>" + vTxt + '</td><td class="vs"></td><td>' + hTxt + "</td></tr>";
    });
    return html + "</table>";
  }

  function nextWeekHtml(weeks, stats) {
    var next = null;
    for (var i = 0; i < weeks.length; i++) {
      if (!weekHasScores(weeks[i])) { next = weeks[i]; break; }
    }
    if (!next) return ""; // every week already has scores — season over
    var playing = {};
    var html = '<div class="nextwk"><h3>Up next &mdash; ' + weekHeading(next) + '</h3><div class="nextwk-row">';
    next.matches.forEach(function (m) {
      playing[m.vis] = true; playing[m.home] = true;
      html += '<div class="nx">' + (m.time ? '<b class="nx-time">' + escapeHtml(m.time) + "</b>" : "") + "<span>Team " + escapeHtml(m.vis) + " <i>(" + recordText(stats, m.vis) + ")</i></span>" +
        "<em>v.</em><span>Team " + escapeHtml(m.home) + " <i>(" + recordText(stats, m.home) + ")</i></span></div>";
    });
    html += "</div>";
    var byes = [];
    for (var t = 1; t <= TEAM_COUNT; t++) { if (!playing[t]) byes.push("Team " + t); }
    html += '<p class="nextwk-note">' + (byes.length ? byes.join(", ") + (byes.length > 1 ? " have a bye. " : " has a bye. ") : "") +
      "Records shown are total games won&ndash;lost.</p></div>";
    return html;
  }

  // Small prompt beside each box title telling visitors the box can be clicked.
  var HINT = '<span class="tap-hint"><span class="hint-open">&mdash; click to open</span><span class="hint-close">&mdash; click to close</span></span>';

  function renderResults(el, weeks, stats) {
    var scoredWeeks = weeks.filter(weekHasScores);
    var html = "";
    if (!scoredWeeks.length) {
      html += "<h2>No results yet</h2>" +
        '<p class="schedule-loading">Results will appear here once scores are entered for Week 1.</p>';
    } else {
      scoredWeeks.slice().reverse().forEach(function (wk, i) {
        var scored = wk.matches.filter(function (m) { return m.games.length > 0; });
        var missing = wk.matches.length - scored.length;
        // Newest week is shown directly under the main "Weekly results" bar; older weeks fold away.
        html += (i === 0
          ? '<div class="week-latest"><h3>' + weekHeading(wk) + "</h3>"
          : '<details class="previous-week"><summary>' + weekHeading(wk) + HINT + "</summary>") +
          '<div class="mu-wrap">';
        scored.forEach(function (m) { html += matchTableHtml(m); });
        html += "</div>";
        if (missing > 0) {
          html += '<p class="week-note">' + missing + (missing === 1 ? " match-up has" : " match-ups have") + " not been reported yet.</p>";
        }
        html += (i === 0 ? "</div>" : "</details>");
      });
    }
    html += nextWeekHtml(weeks, stats);
    el.innerHTML = '<details class="previous-weeks-all" open><summary>Weekly results' + HINT + '</summary>' +
      '<div class="previous-weeks-body">' + html + "</div></details>";
  }

  // Fills Wins/Losses, adds a Place column, and orders the rows by record:
  // win percentage (highest first), then total wins, then team number.
  // A team with no games played yet (0-0) is listed last.
  function renderStandings(stats) {
    var wrap = document.getElementById("standings-table-wrap");
    var table = wrap && wrap.querySelector("table");
    if (!table) return;
    var headerRow = table.querySelector("tr");
    if (headerRow && !headerRow.querySelector("th.place")) {
      var th = document.createElement("th");
      th.className = "place";
      th.textContent = "Place";
      headerRow.insertBefore(th, headerRow.firstChild);
    }
    var items = [];
    for (var team = 1; team <= TEAM_COUNT; team++) {
      var row = document.querySelector('tr[data-team="' + team + '"]');
      if (!row) continue;
      var cells = row.querySelectorAll("td:not(.place)");
      if (cells[1]) cells[1].textContent = stats[team].w;
      if (cells[2]) cells[2].textContent = stats[team].l;
      items.push({ team: team, row: row, w: stats[team].w, l: stats[team].l });
    }
    items.sort(function (a, b) {
      var ga = a.w + a.l, gb = b.w + b.l;
      var pa = ga ? a.w / ga : -1, pb = gb ? b.w / gb : -1;
      if (pb !== pa) return pb - pa;
      if (b.w !== a.w) return b.w - a.w;
      return a.team - b.team;
    });
    items.forEach(function (it, i) {
      var placeCell = it.row.querySelector("td.place");
      if (!placeCell) {
        placeCell = document.createElement("td");
        placeCell.className = "place";
        it.row.insertBefore(placeCell, it.row.firstChild);
      }
      placeCell.textContent = i + 1;
      it.row.parentNode.appendChild(it.row);
    });
  }

  // Schedule page: put each team's games won-lost record beneath its name in every match-up box.
  function renderScheduleRecords(stats) {
    var labels = document.querySelectorAll(".mnum");
    if (!labels.length) return; // not the Schedule page
    for (var i = 0; i < labels.length; i++) {
      var label = labels[i];
      if (label.querySelector(".mrec")) continue;
      var found = /Team\s+(\d+)/.exec(label.textContent);
      if (!found || !stats[found[1]]) continue;
      var rec = document.createElement("span");
      rec.className = "mrec";
      rec.textContent = recordText(stats, found[1]);
      label.appendChild(rec);
    }
  }

  function load() {
    var resultsEl = document.getElementById("standings-current");
    if (resultsEl) resultsEl.innerHTML = '<p class="schedule-loading">Loading results&hellip;</p>';

    fetch(SCORES_CSV_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (text) {
        var weeks = buildWeeks(parseCSV(text));
        if (!weeks.length) throw new Error("No schedule rows found");
        var stats = computeStats(weeks);
        if (resultsEl) renderResults(resultsEl, weeks, stats);
        renderStandings(stats);
        var previousEl = document.getElementById("standings-previous");
        if (previousEl) previousEl.innerHTML = ""; // older weeks now live inside the weekly results box
        renderScheduleRecords(stats);
      })
      .catch(function (err) {
        console.error("Standings sync error:", err);
        if (resultsEl) resultsEl.innerHTML = '<p class="schedule-loading">Results couldn&rsquo;t be loaded right now &mdash; please check back soon.</p>';
      });
  }

  window.StandingsSync = { load: load };
  load();
})();
