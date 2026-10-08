/*
  Bridgewater Bocce — Win % & Point Differential (league admin page)
  Reads the same "Bridgewater_Fall26_Rec_League_Game_Scores" Google Sheet that
  standings-sync.js uses (same CSV link, same column layout) and builds:
    1) a season point-differential table (id="pd-season"): for every team, games
       played, points for, points against and point differential (PD = points
       for minus points against, summed over every game entered so far).
    2) a winning-percentage table (id="wp-season"): games won, games lost and
       winning percentage (games won divided by games played), plus each team's
       PD rank beside its WP rank so the two measures can be compared at a glance.

  Ranks are shared on ties (for example, four teams tied for first are all
  ranked 1 and the next team is ranked 5).
  A game counts only when BOTH of its score cells are filled in (same rule as
  the standings page). A tied game (equal scores) adds to points but is not
  counted as a win or a loss, matching standings-sync.js.
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

  function parseScore(raw) {
    raw = (raw || "").trim();
    if (raw === "") return null;
    var n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }

  // Every completed game in the sheet: [{ vis, home, v, h }]
  // A game is included only when both of its score cells are filled in.
  function buildGames(rows) {
    var games = [];
    rows.slice(1).forEach(function (cols) { // row 0 is the header
      var week = (cols[0] || "").trim();
      var vis = parseInt((cols[3] || "").trim(), 10);
      var home = parseInt((cols[4] || "").trim(), 10);
      if (!week || isNaN(vis) || isNaN(home)) return;
      for (var g = 0; g < 3; g++) {
        var v = parseScore(cols[5 + g * 2]);
        var h = parseScore(cols[6 + g * 2]);
        if (v !== null && h !== null) games.push({ vis: vis, home: home, v: v, h: h });
      }
    });
    return games;
  }

  // Season totals per team: games played, points for/against, games won/lost.
  function computeStats(games) {
    var teams = {};
    for (var t = 1; t <= TEAM_COUNT; t++) teams[t] = { gp: 0, pf: 0, pa: 0, w: 0, l: 0 };
    games.forEach(function (g) {
      var a = teams[g.vis], b = teams[g.home];
      if (a) { a.gp += 1; a.pf += g.v; a.pa += g.h; }
      if (b) { b.gp += 1; b.pf += g.h; b.pa += g.v; }
      if (g.v === g.h) return; // tie — not a win or a loss
      var win = g.v > g.h ? a : b, lose = g.v > g.h ? b : a;
      if (win) win.w += 1;
      if (lose) lose.l += 1;
    });
    var list = [];
    for (var n = 1; n <= TEAM_COUNT; n++) {
      var s = teams[n];
      var decided = s.w + s.l;
      list.push({ team: n, gp: s.gp, pf: s.pf, pa: s.pa, pd: s.pf - s.pa, w: s.w, l: s.l, wp: decided ? s.w / decided : null });
    }
    return { list: list, anyGames: games.length > 0 };
  }

  // Shared ranks on ties: rank = 1 + number of teams with a strictly better value.
  // Teams with no games get no rank (null).
  function assignRanks(list, valueKey, rankKey) {
    list.forEach(function (a) {
      if (a[valueKey] === null || a.gp === 0) { a[rankKey] = null; return; }
      var better = 0;
      list.forEach(function (b) {
        if (b.gp > 0 && b[valueKey] !== null && b[valueKey] > a[valueKey]) better += 1;
      });
      a[rankKey] = better + 1;
    });
  }

  function signed(n) { return (n > 0 ? "+" : "") + n; }
  function pctText(x) { return x === null ? "&ndash;" : (x * 100).toFixed(1) + "%"; }
  function rankText(r) { return r === null ? "&ndash;" : String(r); }

  function sortedBy(list, valueKey, tieKey) {
    return list.slice().sort(function (a, b) {
      if ((a.gp === 0) !== (b.gp === 0)) return a.gp === 0 ? 1 : -1; // no games: last
      var av = a[valueKey] === null ? -1 : a[valueKey];
      var bv = b[valueKey] === null ? -1 : b[valueKey];
      if (bv !== av) return bv - av;
      if (b[tieKey] !== a[tieKey]) return b[tieKey] - a[tieKey];
      return a.team - b.team;
    });
  }

  function pdTableHtml(list) {
    var html = '<div class="pd-scroll"><table class="standings-table"><tr><th>Rank</th><th>Team</th><th>Games</th><th title="Points for">PF</th><th title="Points against">PA</th><th title="Point differential">PD</th></tr>';
    sortedBy(list, "pd", "pf").forEach(function (it) {
      html += "<tr><td>" + rankText(it.pdRank) + "</td><td>Team " + it.team + "</td><td>" + it.gp +
        "</td><td>" + it.pf + "</td><td>" + it.pa + "</td><td><b>" + signed(it.pd) + "</b></td></tr>";
    });
    return html + "</table></div>";
  }

  function wpTableHtml(list) {
    var html = '<div class="pd-scroll"><table class="standings-table"><tr><th>Rank</th><th>Team</th><th>W</th><th>L</th><th title="Winning percentage">WP</th><th title="Rank by point differential, for comparison">PD Rank</th></tr>';
    sortedBy(list, "wp", "w").forEach(function (it) {
      html += "<tr><td>" + rankText(it.wpRank) + "</td><td>Team " + it.team + "</td><td>" + it.w + "</td><td>" + it.l +
        "</td><td><b>" + pctText(it.wp) + "</b></td><td>" + rankText(it.pdRank) + "</td></tr>";
    });
    return html + "</table></div>";
  }

  function render(rows) {
    var stats = computeStats(buildGames(rows));
    var pdEl = document.getElementById("pd-season");
    var wpEl = document.getElementById("wp-season");
    if (!stats.anyGames) {
      var msg = '<p class="pd-note">No scores have been entered yet. These tables will fill in once Week 1 is scored.</p>';
      if (pdEl) pdEl.innerHTML = msg;
      if (wpEl) wpEl.innerHTML = "";
      return;
    }
    assignRanks(stats.list, "pd", "pdRank");
    assignRanks(stats.list, "wp", "wpRank");
    if (pdEl) pdEl.innerHTML = pdTableHtml(stats.list);
    if (wpEl) wpEl.innerHTML = wpTableHtml(stats.list);
  }

  function load() {
    fetch(SCORES_CSV_URL, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("Scores sheet responded with status " + res.status);
        return res.text();
      })
      .then(function (text) { render(parseCSV(text)); })
      .catch(function () {
        var pdEl = document.getElementById("pd-season");
        if (pdEl) pdEl.innerHTML = '<p class="pd-note">Scores couldn&rsquo;t be loaded right now &mdash; please check back soon.</p>';
      });
  }

  load();
})();
