/**
 * Bridgewater Bocce — Registration Handler (v8: Battle Royale)
 *
 * v8 CHANGE NOTE (Sep 2026): this script now serves the Battle Royale
 * tournament (Saturday, January 9th). What changed from v7, and nothing else:
 *   1. EXPECTED_FORM_NAMES now approves 'battle-royale-registration' (the new
 *      Netlify form name) and keeps 'bocce-registration' (the old name, so a
 *      browser still holding the old page is not lost). The Beginners Street
 *      Brawl form 'street-brawl-registration' was removed, because Street
 *      Brawl is over and its registrants must not receive a Battle Royale email.
 *   2. The registrant confirmation email (in doPost AND syncFromNetlify) now
 *      carries the Battle Royale message. Wording lives in the constants
 *      EVENT_NAME and EVENT_DATE_TEXT below.
 *   3. syncFromNetlify() now polls the form named SYNC_FORM_NAME
 *      ('battle-royale-registration') instead of 'bocce-registration'.
 *      It does NOT poll the old form, so old Street Brawl submissions are
 *      never re-imported or re-emailed, even if the sheet is cleared.
 *   4. Email subject lines that said "Street Brawl" now say "Battle Royale".
 * The Google Sheet, its columns, the duplicate guard, the lock, the roster
 * rebuild and the error alerts are unchanged.
 *
 * ORIGINAL v7 HEADER FOLLOWS (kept for history; wording refers to Street Brawl)
 * -----------------------------------------------------------------------
 * Bridgewater Bocce Street Brawl Tournament — Registration Handler (v7)
 *
 * Receives Netlify's "HTTP POST request" form notification (JSON payload)
 * for Street Brawl registration forms (see the two-sites note below),
 * writes each registrant to the "Bridgewater Street Brawl Registration"
 * Google Sheet, sends a thank-you email to the registrant, sends a
 * notification email to the organizer, and rebuilds a "Team Rosters" tab
 * sorted and grouped by street.
 *
 * A separate scheduled function, syncFromNetlify(), polls Netlify directly
 * every 10 minutes as a backstop in case the live webhook ever gets
 * disabled after repeated delivery failures.
 *
 * Duplicate-submission fix (Aug 2026): in v3, doPost() never recorded a
 * submission's Netlify ID in column H. That meant syncFromNetlify() could
 * never tell that doPost() had already written a row for a given
 * submission, so every registration that came in through the live webhook
 * got silently re-added by the next 10-minute sync — and if Netlify ever
 * retried a webhook delivery, doPost() itself had no guard against
 * writing that same submission twice. v4 fixes both: doPost() now stamps
 * the Netlify submission ID into column H (so the two paths recognize
 * each other's work) and checks that column before writing, using a lock
 * so two near-simultaneous deliveries can't race past the check together.
 *
 * Form-name guard (Aug 2026): the Netlify notification for this script is
 * currently scoped to "Any form" instead of a single named form, due to a
 * known Netlify dashboard bug where the Form dropdown silently reverts to
 * "Any form" after saving, no matter how carefully it's re-selected.
 * Because of that, this script receives submissions from every form on
 * the bridgewater-bocce-preview-v2 site (Fall Survey, League Registration,
 * Beginners Clinic, Street Brawl), not just Street Brawl. v5 adds a guard
 * at the very top of doPost() that reads the form name Netlify sends with
 * every submission and silently ignores (no email, no row, no roster
 * rebuild) anything that isn't a recognized Street Brawl form name.
 *
 * Two sites feed this same script and sheet (Aug 2026): the independent
 * Street Brawl tournament site (dynamic-narwhal-1d5542, form name
 * "bocce-registration", field names fullName/email/textNumber/street/
 * experience) AND the "Street Brawl Tournament for Beginners" form on the
 * bridgewater-bocce-preview-v2 site's Clinics & Classes page (form name
 * "street-brawl-registration", field names "Full Name"/"Email Address"/
 * "Text Number"/"Street" — that form has no experience question, since
 * it's open to beginners only, so Experience is simply left blank for
 * those rows). EXPECTED_FORM_NAMES and extractParams() below both handle
 * either site's naming convention so registrations from both funnel into
 * the same roster. If the Netlify scoping is ever fixed to point only at
 * one named form, this guard and the field fallbacks are harmless and
 * simply never trigger for the other site.
 *
 * Confirmation-email tracking (updated Aug 2026, per Rick): column G
 * ("Confirmation Email") now records "Sent", "Failed", or "No Email On
 * File" for every row, matching the same three-value convention used on
 * the League Registration, Fall Survey, and Beginners Clinic sheets, so
 * the league admin can scan one consistent column across every roster.
 * Previously this column only ever showed "Pending" or "Sent" and had no
 * way to record a failed send — and previously, an email failure here
 * would throw all the way out of doPost() uncaught, which could cause
 * Netlify to retry a submission that had already been written to the
 * sheet. Both are fixed below by wrapping the send in its own try/catch.
 *
 * Error-alert safeguard (Aug 2026): two silent-failure gaps are now
 * closed. doPost()'s outer catch previously returned an error to Netlify
 * but never told Rick — fixed by emailing on any uncaught exception in
 * doPost(). syncFromNetlify() previously had no top-level catch at all,
 * so a thrown (not just a bad-status) network error would fail the
 * execution with zero notification — fixed the same way. The repeating
 * preflight checks inside syncFromNetlify() (missing token, site lookup,
 * form lookup, submissions fetch) now route through a throttled
 * notifyRickOfError() helper instead of a bare MailApp.sendEmail(), so a
 * broken Netlify token can't flood the inbox with the same alert every
 * 10 minutes — at most one email per issue per hour. Per-registrant
 * emails (confirmation-send failures, roster-rebuild failures) are left
 * as immediate, unthrottled sends, since each concerns a distinct person
 * or event rather than a repeating condition.
 *
 * Lock-timeout fix (Aug 2026): doPost()'s lock.waitLock(10000) previously
 * sat before the try block, so a lock timeout (two near-simultaneous
 * deliveries, or one execution stuck holding it) threw an uncaught
 * exception — Apps Script returned a raw HTTP 500 instead of a clean JSON
 * response, with no email sent. Netlify disables a webhook after 6 such
 * failures in a row, which is what happened here: the live webhook was
 * silently disabled while the 10-minute syncFromNetlify() backstop kept
 * the sheet current underneath it, masking the outage. Fixed by moving
 * waitLock() inside the try block, guarded by a lockAcquired flag so
 * finally only releases a lock that was actually acquired.
 *
 * Deploy this as a Web App: Execute as "Me", Who has access "Anyone".
 *
 * IMPORTANT: after pasting this in, you must create a NEW deployment
 * version (or edit the existing deployment to "New version") for the
 * live Web app URL to actually run this updated code. Saving alone is
 * not enough — see Deploy > Manage deployments > pencil icon > Version.
 */

var SHEET_ID = '1xiE2jSIt9Imh1fPWxiRdVzbgsEa1XI53B9uexBS7dEg';
var ORGANIZER_EMAIL = 'rick.g.schuette@gmail.com';

// v8: Battle Royale. New form name first; old name kept for stragglers.
// 'street-brawl-registration' (Beginners Street Brawl) intentionally removed.
var EXPECTED_FORM_NAMES = ['battle-royale-registration', 'bocce-registration'];

// v8: the one Netlify form syncFromNetlify() polls.
var SYNC_FORM_NAME = 'battle-royale-registration';

// v8: wording used in the registrant confirmation email.
var EVENT_NAME = 'Battle Royale';
var EVENT_DATE_TEXT = 'Saturday, January 9th';

var STREET_ORDER = [
  'Chapel Bridge', 'Treasure Cay', 'Trift Bridge', 'Millennium', 'Caravan',
  'Great Belt East (of Breakers Row)', 'Great Belt West (of Breakers Row)',
  'Alister East (of Breakers Row)', 'Alister West (of Breakers Row)', 'Velkey'
];

// --- Error alerting ---
// Sends Rick an immediate email for a sync problem, throttled to at most
// one alert per hour per distinct issue, so a broken token or ongoing
// outage doesn't flood the inbox with a repeat email every 10 minutes.
function notifyRickOfError(subject, message) {
  try {
    var props = PropertiesService.getScriptProperties();
    var throttleKey = 'LAST_ALERT_' + subject.replace(/[^A-Za-z0-9]/g, '_');
    var lastAlert = Number(props.getProperty(throttleKey) || '0');
    var now = Date.now();
    var oneHour = 60 * 60 * 1000;

    if (now - lastAlert < oneHour) {
      return; // already alerted about this within the last hour
    }

    MailApp.sendEmail({
      to: ORGANIZER_EMAIL,
      subject: EVENT_NAME + ' Sync Problem: ' + subject,
      body: message + '\n\nThis alert will not repeat again for at least an hour for the same issue, ' +
            'so if it keeps happening you will only be notified once per hour.'
    });

    props.setProperty(throttleKey, String(now));
  } catch (e) {
    Logger.log('notifyRickOfError itself failed: ' + e.toString());
  }
}

/**
 * Pulls the submitted form's name out of the raw request event, checking
 * every shape Netlify is known to send it in. Returns null if no form
 * name can be found (in which case the form-name guard is skipped rather
 * than risk silently dropping a legitimate registration).
 */
function extractFormNameFromEvent(e) {
  var raw = e && e.postData ? e.postData.contents : '';
  var contentType = e && e.postData ? e.postData.type : '';

  if (contentType && contentType.indexOf('json') !== -1 && raw) {
    try {
      var body = JSON.parse(raw);
      if (body.payload && body.payload.form_name) return body.payload.form_name;
      if (body.form_name) return body.form_name;
    } catch (parseErr) {
      return null;
    }
  }
  return null;
}

function extractParams(e) {
  var raw = e.postData ? e.postData.contents : '';
  var contentType = e.postData ? e.postData.type : '';

  if (contentType && contentType.indexOf('json') !== -1 && raw) {
    var body;
    try {
      body = JSON.parse(raw);
    } catch (parseErr) {
      return { fullName: '', email: '', textNumber: '', street: '', experience: '', netlifyId: null, _raw: raw, _parseError: parseErr.toString() };
    }
    var data = (body.payload && body.payload.data) ? body.payload.data
             : (body.data ? body.data
             : (body.payload ? body.payload : body));
    // Two sites feed this script with two different field-naming
    // conventions — check both. See the Aug 2026 header comment.
    return {
      fullName: data.fullName || data['Full Name'] || '',
      email: data.email || data['Email Address'] || '',
      textNumber: data.textNumber || data['Text Number'] || '',
      street: data.street || data['Street'] || '',
      experience: data.experience || data['Experience'] || '',
      captain: data.captain || data['Captain'] || '',
      netlifyId: extractSubmissionId(body),
      _raw: raw
    };
  }

  var p = e.parameter || {};
  return {
    fullName: p.fullName || p['Full Name'] || '',
    email: p.email || p['Email Address'] || '',
    textNumber: p.textNumber || p['Text Number'] || '',
    street: p.street || p['Street'] || '',
    experience: p.experience || p['Experience'] || '',
    captain: p.captain || p['Captain'] || '',
    netlifyId: null,
    _raw: raw
  };
}

/**
 * Pulls Netlify's unique submission identifier out of the webhook body,
 * checking every shape Netlify is known to send it in. Returns null if
 * no ID can be found (in which case the duplicate guard is skipped rather
 * than risk silently dropping a legitimate registration).
 */
function extractSubmissionId(body) {
  if (body.payload && (body.payload.id || body.payload.number)) {
    return String(body.payload.id || ('number-' + body.payload.number));
  }
  if (body.id || body.number) {
    return String(body.id || ('number-' + body.number));
  }
  return null;
}

function doPost(e) {
  // --- Form-name guard ---
  // Only process submissions that actually came from an approved
  // registration form. If Netlify sends us a submission from a different
  // form, quietly acknowledge it and stop — no email, no row, no roster
  // rebuild.
  var incomingFormName = extractFormNameFromEvent(e);
  if (incomingFormName && EXPECTED_FORM_NAMES.indexOf(incomingFormName) === -1) {
    return ContentService
      .createTextOutput(JSON.stringify({ result: 'success', note: 'ignored submission from form: ' + incomingFormName }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var lock = LockService.getScriptLock();
  var lockAcquired = false;
  try {
    // waitLock() moved inside the try (Aug 2026 fix): previously this call
    // sat before the try block, so if it ever timed out waiting for the
    // lock (two near-simultaneous deliveries, or one execution stuck
    // holding it), the thrown exception went uncaught — Apps Script
    // returned a raw HTTP 500 instead of a clean JSON response, with no
    // email sent. Netlify disables a webhook after 6 such failures in a
    // row, which is what happened here. Now a lock timeout is caught like
    // any other error: Rick gets notified and Netlify gets a clean
    // response instead of a 500.
    lock.waitLock(10000);
    lockAcquired = true;

    var params = extractParams(e);
    var fullName = (params.fullName || '').trim();
    var email = (params.email || '').trim();
    var phone = (params.textNumber || '').trim();
    var street = (params.street || '').trim();
    var experience = (params.experience || '').trim();
    var captain = (params.captain || '').trim();
    var netlifyId = params.netlifyId;
    var firstName = fullName.split(' ')[0] || 'there';

    if (!fullName) {
      MailApp.sendEmail(
        ORGANIZER_EMAIL,
        EVENT_NAME + ': could not read a submission',
        'Content-Type: ' + (e.postData ? e.postData.type : 'none') + '\n\nRaw body:\n' + (params._raw || '(empty)')
      );
      return ContentService
        .createTextOutput(JSON.stringify({ result: 'error', error: 'no fullName parsed' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheets()[0];
    ensureNetlifyIdColumn(sheet);
    ensureCaptainColumn(sheet);
    ensureConfirmationColumn(sheet);

    // --- Duplicate-submission guard ---
    // Covers both a retried webhook delivery AND the 10-minute
    // syncFromNetlify() backstop trying to re-add the same submission.
    if (netlifyId && netlifyIdAlreadyRecorded(sheet, netlifyId)) {
      return ContentService
        .createTextOutput(JSON.stringify({ result: 'success', note: 'duplicate submission skipped' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    sheet.appendRow([new Date(), fullName, street, phone, email, experience, '', netlifyId || '', captain]);
    var lastRow = sheet.getLastRow();

    var confirmationStatus;
    if (email) {
      try {
        var subject = "You're In! Bridgewater Bocce " + EVENT_NAME + " — Registration Confirmed";
        var body =
          'Hi ' + firstName + ',\n\n' +
          'Thank you for registering for the ' + EVENT_NAME + ' bocce tournament. ' +
          'Please block your calendar for ' + EVENT_DATE_TEXT + '. ' +
          'We will contact you with further details as we draw nearer to the date.\n\n' +
          'Warm regards,\n' +
          'Rick Schuette\n' +
          'Bridgewater Sports Courts Growth Initiative';
        MailApp.sendEmail(email, subject, body);
        confirmationStatus = 'Sent';
      } catch (mailErr) {
        confirmationStatus = 'Failed';
        MailApp.sendEmail(ORGANIZER_EMAIL, EVENT_NAME + ': confirmation email failed',
          'Name: ' + fullName + '\nEmail: ' + email + '\nError: ' + mailErr.message);
      }
    } else {
      confirmationStatus = 'No Email On File';
    }
    sheet.getRange(lastRow, 7).setValue(confirmationStatus);

    MailApp.sendEmail(
      ORGANIZER_EMAIL,
      'New ' + EVENT_NAME + ' Registration: ' + fullName,
      'Name: ' + fullName + '\nStreet: ' + street + '\nPhone: ' + phone +
      '\nEmail: ' + email + '\nExperience: ' + experience
    );

    try {
      rebuildTeamRosters(ss, sheet);
    } catch (rosterError) {
      MailApp.sendEmail(ORGANIZER_EMAIL, EVENT_NAME + ': roster rebuild failed', rosterError.toString());
    }

    return ContentService
      .createTextOutput(JSON.stringify({ result: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log('Unexpected error in doPost: ' + error.toString());
    notifyRickOfError('doPost unexpected error', 'The ' + EVENT_NAME + ' webhook receiver (doPost) threw an unexpected error while handling a registration (this now also catches lock-timeout errors, which previously went uncaught).\n\nDetails: ' + error.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ result: 'error', error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    if (lockAcquired) {
      lock.releaseLock();
    }
  }
}

/** Checks column H (Netlify ID) of every existing row for a match. */
function netlifyIdAlreadyRecorded(sheet, netlifyId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  var ids = sheet.getRange(2, 8, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] && String(ids[i][0]) === netlifyId) return true;
  }
  return false;
}

function rebuildTeamRosters(ss, regSheet) {
  var data = regSheet.getDataRange().getValues();
  var byStreet = {};

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var name = row[1], street = row[2], phone = row[3], email = row[4], exp = row[5];
    if (!name) continue;
    var key = street && STREET_ORDER.indexOf(street) !== -1 ? street : 'Unassigned / Needs Review';
    if (!byStreet[key]) byStreet[key] = [];
    byStreet[key].push([name, phone, email, exp]);
  }

  var orderedKeys = STREET_ORDER.slice();
  if (byStreet['Unassigned / Needs Review']) orderedKeys.push('Unassigned / Needs Review');

  var rosterSheet = ss.getSheetByName('Team Rosters');
  if (!rosterSheet) rosterSheet = ss.insertSheet('Team Rosters');
  rosterSheet.clear();

  var out = [];
  var boldRows = [];
  var r = 1;

  orderedKeys.forEach(function (street) {
    var players = byStreet[street];
    if (!players || players.length === 0) return;
    players.sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });

    out.push([street + '  (' + players.length + ' registered)', '', '', '']);
    boldRows.push(r); r++;
    out.push(['Name', 'Phone', 'Email', 'Experience Level']);
    boldRows.push(r); r++;
    players.forEach(function (p) { out.push(p); r++; });
    out.push(['', '', '', '']); r++;
  });

  if (out.length === 0) {
    out.push(['No registrations yet.', '', '', '']);
  }

  rosterSheet.getRange(1, 1, out.length, 4).setValues(out);
  boldRows.forEach(function (rowNum) {
    rosterSheet.getRange(rowNum, 1, 1, 4).setFontWeight('bold').setBackground('#EDE7DA');
  });
  rosterSheet.autoResizeColumns(1, 4);
}

/**
 * Polls Netlify directly for form submissions and processes any not yet
 * recorded in the sheet. Backstop for the outgoing webhook, which Netlify
 * disables after repeated delivery failures. Now safe to run alongside
 * doPost(), since both check and stamp the same Netlify ID column.
 */
function syncFromNetlify() {
  try {
    var token = PropertiesService.getScriptProperties().getProperty('NETLIFY_TOKEN');
    if (!token) {
      notifyRickOfError('Missing Netlify token', 'The NETLIFY_TOKEN script property is not set, so the ' + EVENT_NAME + ' backstop sync cannot authenticate with Netlify.\n\nFix: Apps Script > Project Settings > Script Properties > set NETLIFY_TOKEN to a valid Netlify personal access token.');
      return;
    }

    var siteName = 'dynamic-narwhal-1d5542';
    var headers = { 'Authorization': 'Bearer ' + token };

    var sitesResp = UrlFetchApp.fetch('https://api.netlify.com/api/v1/sites', {
      headers: headers, muteHttpExceptions: true
    });
    if (sitesResp.getResponseCode() !== 200) {
      notifyRickOfError('Could not list Netlify sites', 'HTTP ' + sitesResp.getResponseCode() + '\n' + sitesResp.getContentText() +
        '\n\nIf this is a 401, the NETLIFY_TOKEN has expired or been revoked and needs to be replaced.');
      return;
    }
    var sites = JSON.parse(sitesResp.getContentText());
    var site = sites.filter(function (s) {
      return s.name === siteName ||
        (s.url && s.url.indexOf(siteName) !== -1) ||
        (s.ssl_url && s.ssl_url.indexOf(siteName) !== -1);
    })[0];
    if (!site) {
      var seen = sites.map(function (s) { return s.name; }).join(', ') || '(none)';
      notifyRickOfError(EVENT_NAME + ' site not found',
        'No site matching "' + siteName + '" was visible to this token.\nSites this token can see: ' + seen);
      return;
    }

    var formsResp = UrlFetchApp.fetch('https://api.netlify.com/api/v1/sites/' + site.id + '/forms', {
      headers: headers, muteHttpExceptions: true
    });
    if (formsResp.getResponseCode() !== 200) {
      notifyRickOfError('Could not list Netlify forms', 'HTTP ' + formsResp.getResponseCode() + '\n' + formsResp.getContentText());
      return;
    }
    var forms = JSON.parse(formsResp.getContentText());
    var form = forms.filter(function (f) { return f.name === SYNC_FORM_NAME; })[0];
    if (!form) {
      var formNames = forms.map(function (f) { return f.name; }).join(', ') || '(none)';
      notifyRickOfError(EVENT_NAME + ' form not found',
        'No form named "' + SYNC_FORM_NAME + '" on site "' + siteName + '".\nForms found: ' + formNames +
        '\n\nIf the new registration page has not been published or tested yet, this is expected until the first submission arrives.');
      return;
    }

    var subsResp = UrlFetchApp.fetch('https://api.netlify.com/api/v1/forms/' + form.id + '/submissions', {
      headers: headers, muteHttpExceptions: true
    });
    if (subsResp.getResponseCode() !== 200) {
      notifyRickOfError('Could not fetch ' + EVENT_NAME + ' submissions', 'HTTP ' + subsResp.getResponseCode() + '\n' + subsResp.getContentText() +
        '\n\nIf this is a 401, the NETLIFY_TOKEN has expired or been revoked and needs to be replaced.');
      return;
    }
    var submissions = JSON.parse(subsResp.getContentText());

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheets()[0];
    ensureNetlifyIdColumn(sheet);
    ensureCaptainColumn(sheet);
    ensureConfirmationColumn(sheet);

    var data = sheet.getDataRange().getValues();
    var existingIds = {};
    for (var i = 1; i < data.length; i++) {
      var id = data[i][7];
      if (id) existingIds[String(id)] = true;
    }

    var addedCount = 0;

    submissions.forEach(function (sub) {
      if (sub.state === 'spam') return;
      var netlifyId = String(sub.id);
      if (existingIds[netlifyId]) return;

      var d = sub.data || {};
      var fullName = (d.fullName || '').trim();
      var email = (d.email || '').trim();
      var phone = (d.textNumber || '').trim();
      var street = (d.street || '').trim();
      var experience = (d.experience || '').trim();
      var captain = (d.captain || '').trim();
      if (!fullName) return;
      var firstName = fullName.split(' ')[0] || 'there';

      sheet.appendRow([new Date(sub.created_at || Date.now()), fullName, street, phone, email, experience, '', netlifyId, captain]);
      var lastRow = sheet.getLastRow();

      var confirmationStatus;
      if (email) {
        try {
          var subject = "You're In! Bridgewater Bocce " + EVENT_NAME + " — Registration Confirmed";
          var body =
            'Hi ' + firstName + ',\n\n' +
            'Thank you for registering for the ' + EVENT_NAME + ' bocce tournament. ' +
            'Please block your calendar for ' + EVENT_DATE_TEXT + '. ' +
            'We will contact you with further details as we draw nearer to the date.\n\n' +
            'Warm regards,\n' +
            'Rick Schuette\n' +
            'Bridgewater Sports Courts Growth Initiative';
          MailApp.sendEmail(email, subject, body);
          confirmationStatus = 'Sent';
        } catch (mailErr) {
          confirmationStatus = 'Failed';
          MailApp.sendEmail(ORGANIZER_EMAIL, EVENT_NAME + ' sync: confirmation email failed',
            'Name: ' + fullName + '\nEmail: ' + email + '\nError: ' + mailErr.message + '\n\n(picked up via scheduled sync)');
        }
      } else {
        confirmationStatus = 'No Email On File';
      }
      sheet.getRange(lastRow, 7).setValue(confirmationStatus);

      MailApp.sendEmail(
        ORGANIZER_EMAIL,
        'New ' + EVENT_NAME + ' Registration: ' + fullName,
        'Name: ' + fullName + '\nStreet: ' + street + '\nPhone: ' + phone +
        '\nEmail: ' + email + '\nExperience: ' + experience + '\n\n(picked up via scheduled sync)'
      );

      existingIds[netlifyId] = true;
      addedCount++;
    });

    if (addedCount > 0) {
      try {
        rebuildTeamRosters(ss, sheet);
      } catch (rosterError) {
        MailApp.sendEmail(ORGANIZER_EMAIL, EVENT_NAME + ': roster rebuild failed', rosterError.toString());
      }
    }
  } catch (e) {
    Logger.log('Unexpected error in syncFromNetlify: ' + e.toString());
    notifyRickOfError('Unexpected sync error', 'syncFromNetlify threw an unexpected error not caused by a bad HTTP response (for example, a network failure or quota issue).\n\nDetails: ' + e.toString());
  }
}

function ensureNetlifyIdColumn(sheet) {
  var header = sheet.getRange(1, 8).getValue();
  if (header !== 'Netlify ID') {
    sheet.getRange(1, 8).setValue('Netlify ID');
  }
}

function ensureCaptainColumn(sheet) {
  var header = sheet.getRange(1, 9).getValue();
  if (header !== 'Captain') {
    sheet.getRange(1, 9).setValue('Captain');
  }

}

/** Ensures column G carries the "Confirmation Email" header. */
function ensureConfirmationColumn(sheet) {
  var header = sheet.getRange(1, 7).getValue();
  if (header !== 'Confirmation Email') {
    sheet.getRange(1, 7).setValue('Confirmation Email');
  }
}

function createSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncFromNetlify') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncFromNetlify')
    .timeBased()
    .everyMinutes(10)
    .create();
}

function forceRosterRebuild() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheets()[0];
  rebuildTeamRosters(ss, sheet);
}

/** Simple health check so you can confirm the deployment is live by visiting the URL directly. */
function doGet(e) {
  return ContentService.createTextOutput(EVENT_NAME + ' registration endpoint is live.');
}
