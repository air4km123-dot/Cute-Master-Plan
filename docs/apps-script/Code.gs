/**
 * Air4 Master Plan — sheet reader.
 *
 * Paste this into the Apps Script project bound to the company project sheet
 * (Extensions → Apps Script), then deploy it as a Web App. Air4 calls it to read
 * the tab; it never writes anything back.
 *
 * Why this instead of a service account: the script is bound to the spreadsheet
 * and executes as its owner, so it already has permission to read. There is no
 * Google Cloud project to create, no service account to share the sheet with,
 * and no private key to store — Air4 holds only the shared token below.
 *
 * --------------------------------------------------------------------------
 * SETUP
 * --------------------------------------------------------------------------
 * 1. Open the sheet → Extensions → Apps Script.
 * 2. Replace the contents of Code.gs with this file.
 * 3. Replace TOKEN below with a long random string of your own, then Save.
 *    Generate one with:  openssl rand -hex 32
 * 4. Deploy → New deployment → type "Web app"
 *       Execute as:      Me
 *       Who has access:  Anyone
 *    "Anyone" means anyone who knows the /exec URL can reach the script — which
 *    is why it refuses to answer without the token. Do not skip the token.
 * 5. Copy the Web app URL (it ends in /exec).
 * 6. In Vercel → Settings → Environment Variables, add:
 *       AIR4_SHEET_WEBAPP_URL    = the /exec URL
 *       AIR4_SHEET_WEBAPP_TOKEN  = the same TOKEN value
 *    Then redeploy.
 *
 * Whenever you edit this script you must Deploy → Manage deployments → edit the
 * existing deployment → New version. Saving alone does not update the live URL.
 * --------------------------------------------------------------------------
 */

/** Shared secret. Must match AIR4_SHEET_WEBAPP_TOKEN in Vercel exactly. */
var TOKEN = 'REPLACE_WITH_A_LONG_RANDOM_STRING';

/** Tab read when the caller does not name one. */
var DEFAULT_TAB = 'สรุปโปรเจค';

/** Columns A–H: ลำดับ, แผนก, ชื่อ Project, Priority, ผู้รับผิดชอบ, Brief, สถานะ, หมายเหตุ */
var LAST_COLUMN = 8;

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};

    if (!TOKEN || TOKEN === 'REPLACE_WITH_A_LONG_RANDOM_STRING') {
      return json({ ok: false, error: 'The script still has its placeholder token.' });
    }
    if (params.token !== TOKEN) {
      return json({ ok: false, error: 'Bad or missing token.' });
    }

    var name = params.tab || DEFAULT_TAB;
    var book = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = book.getSheetByName(name);

    if (!sheet) {
      return json({
        ok: false,
        error: 'No tab named "' + name + '". Available: ' +
          book.getSheets().map(function (s) { return s.getName(); }).join(', ')
      });
    }

    var rows = sheet.getLastRow();
    var cols = Math.min(LAST_COLUMN, Math.max(1, sheet.getLastColumn()));
    if (rows === 0) return json({ ok: true, tab: name, values: [] });

    // getDisplayValues, not getValues: Air4 compares against text it stored
    // earlier, and raw values turn dates and numbers into objects that would
    // read as spurious changes on every sync.
    var values = sheet.getRange(1, 1, rows, cols).getDisplayValues();

    return json({
      ok: true,
      tab: name,
      spreadsheetId: book.getId(),
      rows: rows,
      values: values
    });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run this from the editor once to check the script can read the sheet before
 * deploying. Look at View → Logs for the result.
 */
function testRead() {
  var out = doGet({ parameter: { token: TOKEN } });
  var parsed = JSON.parse(out.getContent());
  Logger.log('ok: %s, rows: %s', parsed.ok, parsed.rows || parsed.error);
  if (parsed.values && parsed.values.length) {
    Logger.log('first data-ish row: %s', JSON.stringify(parsed.values[3]));
  }
}
