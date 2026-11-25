// =============================================================================
// Secret-gated API used ONLY by the queue service (server to server).
// POST body (Content-Type text/plain, JSON string): { "secret": "...", "op": "ladderPlayers", ... }
// The secret is Script Property QUEUE_API_SECRET. Apps Script cannot read request headers,
// so the secret travels in the body. These ops are never reachable through doGet.
// =============================================================================

/**
 * Called first from doPost. Returns a response if the request is for the ladder
 * (Ko-fi webhook or a queue op), otherwise null so the existing handlers run unchanged.
 */
function routeLadderPost_(e) {
  try {
    if (e.parameter && e.parameter.data && e.postData && /form-urlencoded/i.test(e.postData.type || '')) return handleKofi_(e);
    const raw = e.postData && e.postData.contents;
    if (!raw || raw.charAt(0) !== '{') return null;
    let body;
    try { body = JSON.parse(raw); } catch (err) { return null; }
    if (!body || typeof body.op !== 'string') return null;
    return jsonResponse(handleQueueOp_(body));
  } catch (err) {
    Logger.log('ladder post error: ' + err.message);
    return jsonResponse({ error: 'server_error', message: String(err.message) });
  }
}

function constEq_(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function handleQueueOp_(body) {
  const secret = PropertiesService.getScriptProperties().getProperty('QUEUE_API_SECRET');
  if (!secret) return { error: 'not_configured' };
  if (!body.secret || !constEq_(body.secret, secret)) return { error: 'unauthorized' };
  switch (body.op) {
    case 'ladderPlayers': return { players: ladderPlayers_() };
    case 'ladderServers': return { servers: ladderServers_() };
    case 'ladderConfig': return { config: ladderConfig_() };
    case 'ladderTeams': return { teams: ladderTeams_().map(t => ({ tag: t.tag, name: t.name, color: t.color })) };
    case 'claimPlayer': return claimPlayer_(String(body.playerName || ''), String(body.discordId || ''), String(body.displayName || ''));
    case 'getPlayerPrefs': return { prefs: getPlayerPrefs_() };
    case 'savePlayerPrefs': return savePlayerPrefs_(body.prefs);
    case 'appendLog': return appendLadderLog_(body.rows);
    default: return { error: 'unknown_op' };
  }
}

// ---------------------------------------------------------------- players / identity

const IDENTITY_HEADERS = ['Player', 'Discord ID', 'Claimed At', 'Last Display Name'];

function ensureIdentitySheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('PlayerIdentity');
  if (!sheet) {
    sheet = ss.insertSheet('PlayerIdentity');
    sheet.getRange('A:D').setNumberFormat('@'); // plain text: Discord IDs must never become numbers
    sheet.getRange(1, 1, 1, IDENTITY_HEADERS.length).setValues([IDENTITY_HEADERS]).setFontWeight('bold');
  }
  return sheet;
}

/** Map of player name -> Discord ID (string) from PlayerIdentity. */
function identityMap_() {
  const sheet = ensureIdentitySheet_();
  const map = {};
  if (sheet.getLastRow() < 2) return map;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(r => {
    const name = String(r[0]).trim(); const id = String(r[1]).trim();
    if (name && id) map[name] = id;
  });
  return map;
}

/**
 * Pure: pick the rating used for team balancing.
 * Implied Rank is used when Rank is 0/empty OR the player has played fewer than minMaps maps.
 * Returns { rating, implied }; rating null = nothing usable (the queue service then interpolates from list order).
 */
function ladderEffectiveRank_(rank, impliedRank, mapsPld, minMaps) {
  const r = Number(rank); const im = Number(impliedRank); const maps = Number(mapsPld);
  const hasRank = isFinite(r) && r > 0;
  const hasImplied = isFinite(im) && im > 0;
  const low = !(isFinite(maps) && maps >= minMaps);
  if ((!hasRank || low) && hasImplied) return { rating: im, implied: true };
  if (hasRank) return { rating: r, implied: false };
  return { rating: null, implied: false };
}

/** PlayersImpliedRank tab (Player | Implied Rank), kept apart because UpdateStats rewrites the Players tab. Keys are lower-case names. */
function ladderImpliedMap_(create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('PlayersImpliedRank');
  if (!sheet && create) {
    sheet = ss.insertSheet('PlayersImpliedRank');
    sheet.getRange(1, 1, 1, 2).setValues([['Player', 'Implied Rank']]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  const map = {};
  if (!sheet || sheet.getLastRow() < 2) return map;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(r => {
    const n = String(r[0]).trim().toLowerCase();
    if (n) map[n] = r[1];
  });
  return map;
}

function ladderMinMaps_() { const v = Number(cfgVal_('Ladder rank min maps', 10)); return isFinite(v) && v >= 0 ? v : 10; }

/** Players tab order = rank order (updatePlayerStats keeps it sorted). listIndex is that row order. */
function ladderPlayers_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Players');
  const all = sheet.getLastRow() > 1 ? sheet.getRange(1, 1, sheet.getLastRow(), Math.max(sheet.getLastColumn(), 3)).getValues() : [[]];
  const headers = all[0].map(h => String(h).trim());
  const col = function (name, fallback) { const i = headers.indexOf(name); return i === -1 ? fallback : i; };
  const cRank = col('Rank', 8); const cMaps = col('Maps Pld', -1);
  const implied = ladderImpliedMap_(true);
  const minMaps = ladderMinMaps_();
  const ids = identityMap_();
  const out = [];
  all.slice(1).forEach(r => {
    const name = String(r[2]).trim();
    if (!name) return;
    const eff = ladderEffectiveRank_(r[cRank], implied[name.toLowerCase()], cMaps === -1 ? '' : r[cMaps], minMaps);
    out.push({ name: name, listIndex: out.length, discordId: ids[name] || null, rating: eff.rating, implied: eff.implied });
  });
  return out;
}

/** Ranking page (public API) in ladder mode: show "~Implied" (from the PlayersImpliedRank tab) in the Rank column when it applies. */
function ladderDecoratePlayers_(rows) {
  const minMaps = ladderMinMaps_();
  const implied = ladderImpliedMap_(false);
  return rows.map(o => {
    delete o['Implied Rank']; // never show a stray column
    const im = implied[String(o['Player'] || '').trim().toLowerCase()];
    const eff = ladderEffectiveRank_(o['Rank'], im, o['Maps Pld'], minMaps);
    if (eff.implied) o['Rank'] = '~' + Math.round(eff.rating);
    return o;
  });
}

function claimPlayer_(playerName, discordId, displayName) {
  playerName = playerName.trim(); discordId = discordId.trim();
  if (!playerName || !/^\d{15,25}$/.test(discordId)) return { error: 'unknown_player' };
  return withScriptLock_(function () {
    const names = ladderPlayers_().map(p => p.name);
    let canonical = names.indexOf(playerName) !== -1 ? playerName : null;
    if (!canonical) {
      const ci = names.filter(n => n.toLowerCase() === playerName.toLowerCase());
      if (ci.length === 1) canonical = ci[0];
    }
    if (!canonical) return { error: 'unknown_player' };

    const sheet = ensureIdentitySheet_();
    const last = sheet.getLastRow();
    const rows = last > 1 ? sheet.getRange(2, 1, last - 1, 2).getValues() : [];
    let rowIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const n = String(rows[i][0]).trim(); const id = String(rows[i][1]).trim();
      if (id === discordId) return { error: 'id_already_claimed' };
      if (n === canonical) { if (id) return { error: 'name_taken' }; rowIdx = i + 2; }
    }
    if (rowIdx === -1) rowIdx = last + 1;
    const rng = sheet.getRange(rowIdx, 1, 1, 4);
    rng.setNumberFormat('@');
    rng.setValues([[canonical, discordId, new Date().toISOString(), displayName]]);
    return { ok: true };
  });
}

// ---------------------------------------------------------------- servers / config

function slug_(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function yes_(v, def) { const s = String(v === undefined || v === '' ? def : v).trim().toLowerCase(); return s === 'yes' || s === 'true' || s === '1'; }

/** Pure: rows (no header) of Region | Server | Hostport | Antilag | Enabled -> grouped servers in list order. */
function ladderServersFromRows_(rows) {
  const order = []; const by = {};
  rows.forEach(r => {
    const name = String(r[1]).trim(); const hostport = String(r[2]).trim();
    if (!name || hostport.indexOf(':') === -1) return;
    const id = slug_(name);
    if (!by[id]) { by[id] = { id: id, name: name, region: String(r[0]).trim().toLowerCase(), ports: [] }; order.push(id); }
    by[id].ports.push({ hostport: hostport, antilag: yes_(r[3], 'No'), enabled: yes_(r[4], 'Yes') });
  });
  return order.map(id => by[id]);
}

function ladderServers_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('LadderServers');
  if (!sheet || sheet.getLastRow() < 2) return [];
  return ladderServersFromRows_(sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues());
}

/** Keys match the queue service engine config. */
function ladderConfig_() {
  const n = function (k, d) { const v = Number(cfgVal_(k, d)); return isFinite(v) ? v : d; };
  return {
    readyTimeoutSec: n('Queue ready timeout seconds', 180),
    readyReminderSec: n('Queue ready reminder seconds', 60),
    copyTimeoutSec: n('Queue copy timeout seconds', 300),
    prefsSaveDelaySec: n('Queue prefs save delay seconds', 3),
    notifyCooldownMin: n('Queue alert cooldown minutes', 10),
    expiryMin: n('Queue entry expiry minutes', 60),
    antilagTie: yes_(cfgVal_('Queue antilag tie', 'Yes'), 'Yes'),
    serverWaitSec: n('Queue server wait seconds', 180),
    reservationMin: n('Queue port reservation minutes', 10),
    teamCooldownMin: n('Queue team cooldown minutes', 80),
    pairWindowMin: n('Ladder match window minutes', 160),
    freeCheckIntervalSec: n('Queue free check interval seconds', 15),
    commandTemplate: String(cfgVal_('Queue command template', 'connect {server};team {team};color {color}'))
  };
}


// ---------------------------------------------------------------- per-player queue preferences
// One row per player, key = player name (case-insensitive). Servers are stored by NAME (comma separated).

const PREFS_HEADERS = ['Player', 'Servers', 'Preferred', 'Antilag', 'Notify', 'Notify at', 'Updated'];

function ensurePrefsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('LadderPlayerPrefs');
  if (!sheet) {
    sheet = ss.insertSheet('LadderPlayerPrefs');
    sheet.getRange('A:B').setNumberFormat('@');
    sheet.getRange('C:C').setNumberFormat('@');
    sheet.getRange(1, 1, 1, PREFS_HEADERS.length).setValues([PREFS_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function prefsList_(v) { return String(v || '').split(',').map(x => x.trim()).filter(Boolean); }
function prefsYesNo_(v) { return String(v).trim().toLowerCase() === 'yes' || v === true; }

/** Sheet row -> prefs object. Servers null (empty cell) means "never chosen". */
function prefsFromRow_(r) {
  const player = String(r[0] || '').trim();
  if (!player) return null;
  const at = Number(r[5]);
  return {
    player: player,
    // empty cell = never chosen (null); '(none)' = the player deliberately ticked no server (empty list)
    servers: String(r[1] || '').trim() === '' ? null : (String(r[1]).trim() === '(none)' ? [] : prefsList_(r[1])),
    preferred: prefsList_(r[2]),
    antilag: prefsYesNo_(r[3]),
    notify: prefsYesNo_(r[4]),
    notifyAt: isFinite(at) && at >= 1 && at <= 7 ? Math.round(at) : 7,
    updatedAt: String(r[6] || '')
  };
}

function prefsToRow_(p) {
  return [
    String(p.player || '').trim(),
    Array.isArray(p.servers) ? (p.servers.length ? p.servers.join(', ') : '(none)') : '',
    Array.isArray(p.preferred) ? p.preferred.join(', ') : '',
    p.antilag ? 'Yes' : 'No',
    p.notify ? 'Yes' : 'No',
    Math.min(7, Math.max(1, Math.round(Number(p.notifyAt) || 7))),
    String(p.updatedAt || new Date().toISOString())
  ];
}

function getPlayerPrefs_() {
  const sheet = ensurePrefsSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, PREFS_HEADERS.length).getValues().map(prefsFromRow_).filter(Boolean);
}

/** Upsert a batch of prefs. Rows are matched on player name, case-insensitively. */
function savePlayerPrefs_(list) {
  if (!Array.isArray(list)) return { error: 'bad_request' };
  const items = list.filter(p => p && String(p.player || '').trim()).slice(0, 200);
  if (!items.length) return { ok: true, saved: 0 };
  return withScriptLock_(function () {
    const sheet = ensurePrefsSheet_();
    const last = sheet.getLastRow();
    const names = last > 1 ? sheet.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0]).trim().toLowerCase()) : [];
    const index = {}; names.forEach((n, i) => { index[n] = i + 2; });
    let appendAt = last + 1;
    items.forEach(function (p) {
      const row = prefsToRow_(p);
      const key = row[0].toLowerCase();
      if (index[key]) sheet.getRange(index[key], 1, 1, PREFS_HEADERS.length).setValues([row]);
      else { sheet.getRange(appendAt, 1, 1, PREFS_HEADERS.length).setValues([row]); index[key] = appendAt; appendAt++; }
    });
    return { ok: true, saved: items.length };
  });
}


// ---------------------------------------------------------------- event log (LOGGING=true in the queue service)
// Newest entries are at the TOP (row 2). Each call inserts a batch above the older rows, then trims the sheet.

const LOG_HEADERS = ['Time (UTC)', 'Event', 'Details'];

/** Pure: rows arrive oldest -> newest; the sheet wants newest first. */
function ladderLogBatch_(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 1000).map(r => [String(r[0] || ''), String(r[1] || ''), String(r[2] || '').slice(0, 2000)]).reverse();
}

function appendLadderLog_(rows) {
  const batch = ladderLogBatch_(rows);
  if (!batch.length) return { ok: true, written: 0 };
  return withScriptLock_(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('LadderLog');
    if (!sheet) {
      sheet = ss.insertSheet('LadderLog');
      sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
      sheet.setFrozenRows(1);
      sheet.setColumnWidth(1, 170); sheet.setColumnWidth(2, 150); sheet.setColumnWidth(3, 900);
    }
    sheet.insertRowsBefore(2, batch.length);
    sheet.getRange(2, 1, batch.length, LOG_HEADERS.length).setNumberFormat('@').setValues(batch);
    const max = Math.max(100, Number(cfgVal_('Ladder log max rows', 20000)) || 20000);
    const dataRows = sheet.getLastRow() - 1;
    if (dataRows > max) sheet.deleteRows(max + 2, dataRows - max);
    return { ok: true, written: batch.length };
  });
}
