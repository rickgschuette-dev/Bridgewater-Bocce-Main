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
       #standings-table-wrap) — Wins/Losses are total GAMES won and lost;
       "Last 6" is the won-lost record over each team's 6 most recent games.
    3) on the Schedule page, each team's games won-lost record beneath its
       name in every match-up box, as of the START of that week.

  SHEET FORMAT (row 1 is a header row; columns in this exact order):
    A Week | B Date | C Time | D Visiting Team | E Home Team |
    F Visiting G1 | G Home G1 | H Visiting G2 | I Home G2 |
     J Visiting G3 | K Home G3 | (L blank) | M optional status
   - Visiting Team is the team shown on the LEFT of the scoreboard and
     website; Home Team is the team on the RIGHT.
   - Leave a game's two score cells blank until that game has been played.
     A game counts only when BOTH of its score cells are filled in; the
     higher score wins that game.
   - Enter "Rainout" or "No games" in column M for a date that should stay
     visible on the schedule but be skipped by the "Up next" box.
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

  // Groups the sheet's rows into an ordered array of scheduled dates:
  // { n, dateStr, matches: [{ vis, home, games: [{ v, h }] }], sequence }
  // The Week + Date pair is the key so a rain-out can be rescheduled on a
  // later date without being merged into the original week's match-ups.
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
      var status = (cols[12] || "").trim();
      if (!week || !vis || !home) return;

      var games = [];
      for (var g = 0; g < 3; g++) {
        var v = parseScore(cols[5 + g * 2]);
        var h = parseScore(cols[6 + g * 2]);
        if (v !== null && h !== null) games.push({ v: v, h: h });
      }

      var key = week + "::" + dateStr;
      if (!byWeek[key]) {
        byWeek[key] = { n: week, dateStr: dateStr, matches: [], sequence: order.length, status: "" };
        order.push(key);
      }
      if (/^(rainout|no games)$/i.test(status)) byWeek[key].status = status;
      byWeek[key].matches.push({ vis: vis, home: home, time: timeStr, games: games });
    });
    return order.map(function (w) { return byWeek[w]; });
  }

  function weekHasScores(wk) {
    return wk.matches.some(function (m) { return m.games.length > 0; });
  }

  // Total games won / lost per team across every game entered so far.
  // If beforeSequence is given, only earlier scheduled dates are counted,
  // i.e. the records as they stood going into that date. This also supports
  // rescheduled rain-out dates that retain the original Week number.
  function computeStats(weeks, beforeSequence) {
    var stats = {};
    for (var t = 1; t <= TEAM_COUNT; t++) stats[t] = { w: 0, l: 0, form: [] };
    weeks.forEach(function (wk) {
      if (beforeSequence !== undefined && wk.sequence >= beforeSequence) return;
      wk.matches.forEach(function (m) {
        m.games.forEach(function (g) {
          if (g.v === g.h) return; // tie — not expected, skipped rather than guessed
          var winner = g.v > g.h ? m.vis : m.home;
          var loser = g.v > g.h ? m.home : m.vis;
          if (stats[winner]) { stats[winner].w += 1; stats[winner].form.push("W"); }
          if (stats[loser]) { stats[loser].l += 1; stats[loser].form.push("L"); }
        });
      });
    });
    return stats;
  }

  // Won-lost over a team's most recent 6 games played (oldest games drop off).
  // A team with fewer than 6 games shows whatever it has so far.
  function last6Text(stats, team) {
    var form = stats[team].form.slice(-6), w = 0;
    for (var i = 0; i < form.length; i++) { if (form[i] === "W") w++; }
    return w + "\u2013" + (form.length - w);
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
      if (!weeks[i].status && !weekHasScores(weeks[i])) { next = weeks[i]; break; }
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
      if (!cells[3]) { row.appendChild(document.createElement("td")); cells = row.querySelectorAll("td:not(.place)"); }
      cells[3].textContent = last6Text(stats, team);
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

  // Schedule page: builds the accordion entirely from the sheet. Each team's
  // record is calculated as of the start of that specific scheduled date.
  function scheduleMatchHtml(m, stats) {
    return '<div class="matchup">' +
      (m.time ? '<span class="mtime">' + escapeHtml(m.time) + '</span>' : '') +
      '<div class="matchup-teams">' +
      '<span class="mnum">Team ' + escapeHtml(m.vis) + '<span class="mrec">' + recordText(stats, m.vis) + '</span></span>' +
      '<span class="mvs">vs</span>' +
      '<span class="mnum">Team ' + escapeHtml(m.home) + '<span class="mrec">' + recordText(stats, m.home) + '</span></span>' +
      '</div></div>';
  }

  function scheduleByeText(wk) {
    var playing = {};
    wk.matches.forEach(function (m) { playing[m.vis] = true; playing[m.home] = true; });
    var byes = [];
    for (var t = 1; t <= TEAM_COUNT; t++) {
      if (!playing[t]) byes.push('Team ' + t);
    }
    if (!byes.length) return '';
    return '<p class="schedule-note">' + byes.join(', ') +
      (byes.length === 1 ? ' has a bye this week.</p>' : ' have byes this week.</p>');
  }

  function renderSchedule(el, weeks) {
    var html = '';
    weeks.forEach(function (wk) {
      var stats = computeStats(weeks, wk.sequence);
      var heading = weekHeading(wk) + (wk.status ? ' &mdash; ' + escapeHtml(wk.status) : '');
      html += '<details class="schedule-week' + (wk.status ? ' makeup-round' : '') + '"><summary>' + heading + '</summary>';
      if (wk.status) {
        var statusMessage = /^no games$/i.test(wk.status) ? 'no games were scheduled on this date.' : 'no games were played on this date.';
        html += '<p class="schedule-note"><strong>' + escapeHtml(wk.status) + '</strong> &mdash; ' + statusMessage + '</p>';
      } else {
        html += '<div class="matchup-grid">';
        wk.matches.forEach(function (m) { html += scheduleMatchHtml(m, stats); });
        html += '</div>' + scheduleByeText(wk);
      }
      html += '</details>';
    });
    el.innerHTML = html || '<p class="schedule-loading">No schedule has been posted yet.</p>';
  }

  function load() {
    var resultsEl = document.getElementById("standings-current");
    var scheduleEl = document.getElementById("schedule-weeks");
    if (resultsEl) resultsEl.innerHTML = '<p class="schedule-loading">Loading results&hellip;</p>';
    if (scheduleEl) scheduleEl.innerHTML = '<p class="schedule-loading">Loading schedule&hellip;</p>';

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
        if (scheduleEl) renderSchedule(scheduleEl, weeks);
        var previousEl = document.getElementById("standings-previous");
        if (previousEl) previousEl.innerHTML = ""; // older weeks now live inside the weekly results box
      })
      .catch(function (err) {
        console.error("Standings sync error:", err);
        if (resultsEl) resultsEl.innerHTML = '<p class="schedule-loading">Results couldn&rsquo;t be loaded right now &mdash; please check back soon.</p>';
        if (scheduleEl) scheduleEl.innerHTML = '<p class="schedule-loading">The schedule couldn&rsquo;t be loaded right now &mdash; please check back soon.</p>';
      });
  }

  window.StandingsSync = { load: load };
  load();
})();
