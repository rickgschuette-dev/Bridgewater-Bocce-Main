/*
  Bridgewater Bocce — Rec League results & standings sync
  Reads the "Fall '26 Rec League Schedule" Google Sheet (the same sheet
  the Schedule page's matchups were mirrored from) and uses its
  Home Team Score / Visiting Team Score columns to build:
    1) a "This week's results" box (id="standings-current") showing the
       most recently scored week's matches
    2) the season standings table (rows tagged data-team="1".."9" inside
       #standings-table-wrap) — Wins/Losses are MATCH results: whichever
       team has the higher of the two scores in a week's match gets +1
       Win that week, the other +1 Loss.

  SHEET FORMAT (Week, Date, Time, Home Team, Visiting Team, Location,
  Home Team Score, Visiting Team Score):
   - Home Team / Visiting Team are plain numbers (1-9), or "BYE" on a
     team's bye-week row — bye rows are always skipped, they're never
     scored.
   - Leave both Score columns blank until that week's match has been
     played. Once both are filled in (e.g. 12 and 7), that match counts
     — whichever team's score is higher is the winner of that match.
   - If the fetch fails, or nothing has been scored yet, the page falls
     back to a friendly message / the static 0-0 table already in the
     HTML — it never breaks.
*/
(function () {
  var SCHEDULE_CSV_URL = "https://docs.google.com/spreadsheets/d/1QdEuJ-EGxrNmes5IN2vX5D5mahZzzNMQyJlpHvJPZzY/export?format=csv";

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
  // { n, dateStr, matches: [{ home, vis, homeScore, visScore, scored }] }
  // Bye rows (Visiting or Home Team = "BYE") are skipped entirely, same
  // as they are on the Schedule page's own matchup list.
  function buildWeeks(rows) {
    var byWeek = {};
    var order = [];
    var pendingDate = "";
    rows.slice(1).forEach(function (cols) { // row 0 is the header
      var week = (cols[0] || "").trim();
      var dateCell = (cols[1] || "").trim();
      var home = (cols[3] || "").trim();
      var vis = (cols[4] || "").trim();
      var scoreHomeRaw = cols[6];
      var scoreVisRaw = cols[7];

      if (!home && !vis) {
        pendingDate = dateCell; // spacer row carrying that week's date
        return;
      }
      if (!week || !home || !vis) return;
      if (/^bye$/i.test(vis) || /^bye$/i.test(home)) return; // bye row — never scored

      var effectiveDate = dateCell || pendingDate;
      var homeScore = parseScore(scoreHomeRaw);
      var visScore = parseScore(scoreVisRaw);
      var scored = homeScore !== null && visScore !== null;

      if (!byWeek[week]) { byWeek[week] = { n: week, dateStr: effectiveDate, matches: [] }; order.push(week); }
      if (effectiveDate && !byWeek[week].dateStr) byWeek[week].dateStr = effectiveDate;
      byWeek[week].matches.push({ home: home, vis: vis, homeScore: homeScore, visScore: visScore, scored: scored });
    });
    return order.map(function (w) { return byWeek[w]; });
  }

  function matchResultHtml(m) {
    var homeWon = m.homeScore > m.visScore;
    var visWon = m.visScore > m.homeScore;
    var homeLabel = "Team " + escapeHtml(m.home) + " &mdash; " + m.homeScore;
    var visLabel = "Team " + escapeHtml(m.vis) + " &mdash; " + m.visScore;
    var homeSpan = '<span class="' + (homeWon ? "result-winner" : "result-loser") + '">' + homeLabel + "</span>";
    var visSpan = '<span class="' + (visWon ? "result-winner" : "result-loser") + '">' + visLabel + "</span>";
    return '<div class="schedule-match"><div class="matchup">' + visSpan + '<span class="at-word">vs</span>' + homeSpan + "</div></div>";
  }

  function renderResults(el, weeks) {
    var scoredWeeks = weeks.filter(function (w) { return w.matches.some(function (m) { return m.scored; }); });
    if (!scoredWeeks.length) {
      el.innerHTML = '<p class="current-eyebrow">This week&rsquo;s results</p>' +
        "<h2>No results yet</h2>" +
        '<p class="schedule-loading">Results will appear here once scores are entered for Week 1.</p>';
      return;
    }
    var current = scoredWeeks[scoredWeeks.length - 1];
    var scoredMatches = current.matches.filter(function (m) { return m.scored; });
    var html = '<p class="current-eyebrow">This week&rsquo;s results</p>' +
      "<h2>Week " + escapeHtml(current.n) + (current.dateStr ? " &mdash; " + escapeHtml(current.dateStr) : "") + "</h2>" +
      '<div class="schedule-match-list">';
    scoredMatches.forEach(function (m) { html += matchResultHtml(m); });
    html += "</div>";
    el.innerHTML = html;
  }

  function renderStandings(weeks) {
    var stats = {};
    for (var t = 1; t <= 9; t++) stats[t] = { w: 0, l: 0 };

    weeks.forEach(function (wk) {
      wk.matches.forEach(function (m) {
        if (!m.scored) return;
        if (m.homeScore === m.visScore) return; // tie — not expected for this league, skip rather than guess
        var winner = m.homeScore > m.visScore ? m.home : m.vis;
        var loser = m.homeScore > m.visScore ? m.vis : m.home;
        if (stats[winner]) stats[winner].w += 1;
        if (stats[loser]) stats[loser].l += 1;
      });
    });

    for (var team = 1; team <= 9; team++) {
      var row = document.querySelector('tr[data-team="' + team + '"]');
      if (!row) continue;
      var cells = row.querySelectorAll("td");
      if (cells[0]) cells[0].textContent = stats[team].w;
      if (cells[1]) cells[1].textContent = stats[team].l;
    }
  }

  function load() {
    var resultsEl = document.getElementById("standings-current");
    if (resultsEl) resultsEl.innerHTML = '<p class="schedule-loading">Loading results&hellip;</p>';

    fetch(SCHEDULE_CSV_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (text) {
        var weeks = buildWeeks(parseCSV(text));
        if (resultsEl) renderResults(resultsEl, weeks);
        renderStandings(weeks);
      })
      .catch(function (err) {
        console.error("Standings sync error:", err);
        if (resultsEl) resultsEl.innerHTML = '<p class="schedule-loading">Results couldn&rsquo;t be loaded right now &mdash; please check back soon.</p>';
      });
  }

  window.StandingsSync = { load: load };
  load();
})();
