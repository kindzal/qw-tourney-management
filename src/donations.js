// =============================================================================
// Ko-fi support widget: webhook receiver + public `donations` endpoint.
// Ko-fi has no read API, so payments are recorded in the Donations tab as they arrive
// (Ko-fi webhook -> this web app's /exec URL). Progress = sum of the current month.
// Donations tab columns: Date | Amount | Source | Id | Currency   (Currency is optional)
// =============================================================================

const DONATION_HEADERS = ['Date', 'Amount', 'Source', 'Id', 'Currency'];

function ensureDonationsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Donations');
  if (!sheet) {
    sheet = ss.insertSheet('Donations');
    sheet.getRange(1, 1, 1, DONATION_HEADERS.length).setValues([DONATION_HEADERS]).setFontWeight('bold');
    sheet.getRange('D:D').setNumberFormat('@');
  }
  return sheet;
}

/** Pure: sum amounts for rows in `monthKey` (yyyy-MM). rows = sheet values without header. */
function donationsSumMonth_(rows, monthKey, currency, tz, fmt) {
  let total = 0;
  rows.forEach(r => {
    const d = r[0] instanceof Date ? r[0] : parseGameDate_(r[0]);
    const amt = Number(r[1]);
    if (!d || !isFinite(amt)) return;
    const cur = String(r[4] || '').trim().toUpperCase();
    if (cur && cur !== String(currency).toUpperCase()) return;
    if (fmt(d, tz) === monthKey) total += amt;
  });
  return Math.round(total * 100) / 100;
}

function getDonationsAPI() {
  const tz = Session.getScriptTimeZone();
  const currency = String(cfgVal_('Donation currency', 'GBP'));
  const goal = Number(cfgVal_('Donation goal', 20)) || 20;
  const month = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  const sheet = SpreadsheetApp.getActive().getSheetByName('Donations');
  const rows = sheet && sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, DONATION_HEADERS.length).getValues() : [];
  const raised = donationsSumMonth_(rows, month, currency, tz, (d, z) => Utilities.formatDate(d, z, 'yyyy-MM'));
  return {
    title: String(cfgVal_('Donation title', 'Hosting & Dev Support - {MONTH}')),
    text: String(cfgVal_('Donation text', 'Running this software costs money. Please consider a small donation to keep it going!')),
    link: String(cfgVal_('Donation link', '')),
    goal: goal, raised: raised, currency: currency, month: month,
    percent: Math.round(raised / goal * 100)
  };
}

/** Pure: validates a Ko-fi webhook payload. Returns { ok, row } | { ignored } | { error }. */
function kofiParse_(data, expectedToken) {
  if (!expectedToken) return { error: 'not_configured' };
  if (!data || data.verification_token !== expectedToken) return { error: 'bad_token' };
  if (['Donation', 'Subscription'].indexOf(data.type) === -1) return { ignored: true };
  const amount = parseFloat(data.amount);
  if (!isFinite(amount) || amount <= 0 || !data.message_id) return { error: 'bad_payload' };
  return { ok: true, row: { date: data.timestamp ? new Date(data.timestamp) : new Date(), amount: amount, id: String(data.message_id), currency: String(data.currency || '').toUpperCase() } };
}

/** Ko-fi posts application/x-www-form-urlencoded with one field `data` (JSON). */
function handleKofi_(e) {
  let data;
  try { data = JSON.parse(e.parameter.data); } catch (err) { return ContentService.createTextOutput('bad json'); }
  const res = kofiParse_(data, PropertiesService.getScriptProperties().getProperty('KOFI_VERIFICATION_TOKEN'));
  if (res.error) { Logger.log('kofi webhook rejected: ' + res.error); return ContentService.createTextOutput(res.error); }
  if (res.ignored) return ContentService.createTextOutput('ignored');
  withScriptLock_(function () {
    const sheet = ensureDonationsSheet_();
    const last = sheet.getLastRow();
    const ids = last > 1 ? sheet.getRange(2, 4, last - 1, 1).getValues().flat().map(String) : [];
    if (ids.indexOf(res.row.id) !== -1) return; // duplicate delivery
    sheet.getRange(last + 1, 1, 1, 5).setValues([[res.row.date, res.row.amount, 'kofi', res.row.id, res.row.currency]]);
  });
  return ContentService.createTextOutput('OK');
}
