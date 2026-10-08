/*
  Bridgewater Bocce — Win % & Point Differential (league admin page)
  Reads the same "Bridgewater_Fall26_Rec_League_Game_Scores" Google Sheet that
  standings-sync.js uses (same CSV link, same column layout) and builds:
    1) a season point-differential table (id="pd-season"): for every team, games
       played, points for, points against and point differential (PD = points
       for minus points against, summed over every game entered so far).
    2) a week-by-week table (id="pd-weekly"): each team's cumulative PD after
       every week that has scores. A team on a bye keeps its previous total.

  A game counts only when BOTH of its score cells are filled in (same rule as
  the standings page). Ties are counted for points like any other game.
  If the fetch fails, the page shows a friendly message and never breaks.
  This file is read-only: it never writes anything back to the sheet.
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

  // Same grouping rules as standings-sync.js:
  // [{ n, dateStr, matches: [{ vis, home, games: [{ v, h }] }] }]
  function buildWeeks(rows) {
    var byWeek = {}, order = [];
    rows.slice(1).forEach(function (cols) {
      var week = (cols[0] || "").trim();
      var dateStr = (cols[1] || "").trim();
      var vis = parseInt((cols[3] || "").trim(), 10);
      var home = parseInt((cols[4] || "").trim(), 10);
      if (!week || isNaN(vis) || isNaN(home)) return;
      var games = [];
      for (var g = 0; g < 3; g++) {
        var v = parseScore(cols[5 + g * 2]);
        var h = parseScore(cols[6 + g * 2]);
        if (v !== null && h !== null) games.push({ v: v, h: h });
      }
      if (!byWeek[week]) { byWeek[week] = { n: week, dateStr: dateStr, matches: [] }; order.push(week); }
      if (dateStr && !byWeek[week].dateStr) byWeek[week].dateStr = dateStr;
      byWeek[week].matches.push({ vis: vis, home: home, games: games });
    });
    return order.map(function (w) { return byWeek[w]; });
  }

  function weekHasScores(wk) {
    return wk.matches.some(function (m) { return m.games.length > 0; });
  }

  // Season totals plus the running PD after each scored week.
  function computeStats(weeks) {
    var teams = {};
    for (var t = 1; t <= TEAM_COUNT; t++) teams[t] = { gp: 0, pf: 0, pa: 0 };
    var scored = weeks.filter(weekHasScores);
    var running = []; // running[i][team] = cumulative PD after scored[i]
    scored.forEach(function (wk) {
      wk.matches.forEach(function (m) {
        m.games.forEach(function (g) {
          if (teams[m.vis]) { teams[m.vis].gp += 1; teams[m.vis].pf += g.v; teams[m.vis].pa += g.h; }
          if (teams[m.home]) { teams[m.home].gp += 1; teams[m.home].pf += g.h; teams[m.home].pa += g.v; }
        });
      });
      var snap = {};
      for (var t2 = 1; t2 <= TEAM_COUNT; t2++) snap[t2] = teams[t2].pf - teams[t2].pa;
      running.push(snap);
    });
    return { teams: teams, scored: scored, running: running };
  }

  function signed(n) { return (n > 0 ? "+" : "") + n; }

  function seasonHtml(stats) {
    var items = [];
    for (var t = 1; t <= TEAM_COUNT; t++) {
      var s = stats.teams[t];
      items.push({ team: t, gp: s.gp, pf: s.pf, pa: s.pa, pd: s.pf - s.pa });
    }
    // Highest PD first; ties by points for, then team number.
    // A team with no games played yet is listed last.
    items.sort(function (a, b) {
      if ((a.gp === 0) !== (b.gp === 0)) return a.gp === 0 ? 1 : -1;
      if (b.pd !== a.pd) return b.pd - a.pd;
      if (b.pf !== a.pf) return b.pf - a.pf;
      return a.team - b.team;
    });
    var html = '<table class="standings-table"><tr><th>Rank</th><th>Team</th><th>Games</th><th>Pts For</th><th>Pts Against</th><th>Point Diff</th></tr>';
    items.forEach(function (it, i) {
      html += "<tr><td>" + (it.gp ? i + 1 : "&ndash;") + "</td><td>Team " + it.team + "</td><td>" + it.gp +
        "</td><td>" + it.pf + "</td><td>" + it.pa + "</td><td><b>" + signed(it.pd) + "</b></td></tr>";
    });
    return html + "</table>";
  }

  function weeklyHtml(stats) {
    if (!stats.scored.length) return "";
    var html = '<div class="pd-scroll"><table class="standings-table"><tr><th>Team</th>';
    stats.scored.forEach(function (wk) {
      html += "<th>Wk " + escapeHtml(wk.n) + (wk.dateStr ? "<br><span class=\"pd-date\">" + escapeHtml(wk.dateStr) + "</span>" : "") + "</th>";
    });
    html += "</tr>";
    for (var t = 1; t <= TEAM_COUNT; t++) {
      html += "<tr><td>Team " + t + "</td>";
      stats.running.forEach(function (snap) { html += "<td>" + signed(snap[t]) + "</td>"; });
      html += "</tr>";
    }
    return html + "</table></div>";
  }

  function render(rows) {
    var weeks = buildWeeks(rows);
    var stats = computeStats(weeks);
    var seasonEl = document.getElementById("pd-season");
    var weeklyEl = document.getElementById("pd-weekly");
    if (!stats.scored.length) {
      if (seasonEl) seasonEl.innerHTML = '<p class="pd-note">No scores have been entered yet. Point differentials will appear here once Week 1 is scored.</p>';
      if (weeklyEl) weeklyEl.innerHTML = "";
      return;
    }
    if (seasonEl) seasonEl.innerHTML = seasonHtml(stats);
    if (weeklyEl) weeklyEl.innerHTML = weeklyHtml(stats);
  }

  function load() {
    fetch(SCORES_CSV_URL, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("Scores sheet responded with status " + res.status);
        return res.text();
      })
      .then(function (text) { render(parseCSV(text)); })
      .catch(function () {
        var seasonEl = document.getElementById("pd-season");
        if (seasonEl) seasonEl.innerHTML = '<p class="pd-note">Scores couldn&rsquo;t be loaded right now &mdash; please check back soon.</p>';
      });
  }

  load();
})();
