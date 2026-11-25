// =============================================================================
// QML LADDER: mode switch, ladder points, Ladder tab, public webConfig/ladder API.
// Nothing here runs in Tournament mode (the only calls from existing code are guarded
// by isLadderMode(); see the "LADDER:" comments in Code.js and api.js).
// =============================================================================

/** Reads a Configuration value (config.js global `config`), with a default for blank/missing keys. */
function cfgVal_(key, def) {
  const v = config[key];
  return (v === undefined || v === null || v === '') ? def : v;
}

function getTournamentType() {
  return String(cfgVal_('Tournament type', 'Tournament')).trim().toLowerCase() === 'ladder' ? 'Ladder' : 'Tournament';
}
function isLadderMode() { return getTournamentType() === 'Ladder'; }

/** Runs fn under the script lock (used only for ladder-owned writes: claims and donations). */
function withScriptLock_(fn, waitMs) {
  const lock = LockService.getScriptLock();
  lock.waitLock(waitMs || 25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function parseGameDate_(v) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (v === null || v === undefined || v === '') return null;
  const iso = String(v).trim().replace(' ', 'T').replace(/ ?([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}

// ----------------------------------------------------------------------------
// Ladder points (pure core, unit-tested in Node)
// ----------------------------------------------------------------------------

/**
 * gamesData: Games sheet values incl. header row.
 *   Columns: 0 URL, 1 Date, 5 Map Won, 6 Frags, 7 Team, 8 Name, 13 TKs, 14 Given, 16 EWEP, 30 RL kills
 * playersData: Players sheet values incl. header row. Columns: 1 Game Nicks (comma separated), 2 Player
 * excludedUrls: Set of URLs to skip. pts: { played, win, mvp }
 * Sorted by Points, Win %, Maps, Name.
 */
function ladderComputeTable_(gamesData, playersData, excludedUrls, pts) {
  const nickToPlayer = {};
  for (let i = 1; i < playersData.length; i++) {
    const player = String(playersData[i][2] || '').trim();
    if (!player) continue;
    String(playersData[i][1] || '').split(',').forEach(n => {
      const k = n.trim().toLowerCase();
      if (k && !(k in nickToPlayer)) nickToPlayer[k] = player;
    });
  }

  const byUrl = new Map();
  for (let j = 1; j < gamesData.length; j++) {
    const url = String(gamesData[j][0] || '').trim();
    if (!url || (excludedUrls && excludedUrls.has(url))) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(gamesData[j]);
  }

  const stats = {};
  byUrl.forEach(rows => {
    if (rows.length !== 8) return; // only full 4v4 games count
    const teamCount = {};
    rows.forEach(r => { const t = String(r[7]); teamCount[t] = (teamCount[t] || 0) + 1; });
    const teams = Object.keys(teamCount);
    if (teams.length !== 2 || teams.some(t => teamCount[t] !== 4)) return;

    const date = parseGameDate_(rows[0][1]);
    // Same terms as the Rank formula (without the win-rate term, which is identical within a team)
    const scores = rows.map(r => (Number(r[6]) || 0) + (Number(r[14]) || 0) / 1000 + (Number(r[16]) || 0) / 1000 - (Number(r[13]) || 0) + (Number(r[30]) || 0));
    const top = Math.max.apply(null, scores);

    rows.forEach((r, idx) => {
      const player = nickToPlayer[String(r[8]).trim().toLowerCase()];
      if (!player) return;
      const won = Number(r[5]) === 1;
      const isMvp = scores[idx] >= top - 1e-9;
      const s = stats[player] || (stats[player] = { points: 0, maps: 0, wins: 0, events: [] });
      s.points += pts.played + (won ? pts.win : 0) + (isMvp ? pts.mvp : 0);
      s.maps++;
      if (won) s.wins++;
      s.events.push({ date: date, won: won });
    });
  });

  const out = Object.keys(stats).map(name => {
    const s = stats[name];
    s.events.sort((a, b) => (a.date ? a.date.getTime() : 0) - (b.date ? b.date.getTime() : 0));
    const last = s.events[s.events.length - 1];
    let streak = 0;
    for (let i = s.events.length - 1; i >= 0 && s.events[i].won === last.won; i--) streak++;
    const lastDate = s.events.reduce((m, e) => (e.date && (!m || e.date > m) ? e.date : m), null);
    return { player: name, points: s.points, maps: s.maps, wins: s.wins, losses: s.maps - s.wins,
      winPct: Math.round(s.wins / s.maps * 100), streak: streak + (last.won ? 'W' : 'L'), lastPlayed: lastDate };
  });
  out.sort((a, b) => b.points - a.points || b.winPct - a.winPct || b.maps - a.maps || a.player.localeCompare(b.player));
  return out.map((r, i) => Object.assign({ pos: i + 1 }, r));
}

const LADDER_HEADERS = ['Pos', 'Player', 'Points', 'Maps', 'Wins', 'Losses', 'Win %', 'Streak', 'Last Played'];

/** Recomputes the Ladder tab from Games (Ladder mode only; called from ladderUpdateStats_). */
function updateLadderStats() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const games = ss.getSheetByName('Games');
  const players = ss.getSheetByName('Players');
  if (!games || !players) return;
  const pts = {
    played: Number(cfgVal_('Ladder points played', 10)),
    win: Number(cfgVal_('Ladder points win', 20)),
    mvp: Number(cfgVal_('Ladder points mvp', 10))
  };
  const table = ladderComputeTable_(games.getDataRange().getValues(), players.getDataRange().getValues(), ensureExcludedGamesTab(), pts);
  const tz = Session.getScriptTimeZone();
  const values = table.map(r => [r.pos, r.player, r.points, r.maps, r.wins, r.losses, r.winPct, r.streak,
    r.lastPlayed ? Utilities.formatDate(r.lastPlayed, tz, 'yyyy-MM-dd HH:mm') : '']);

  let sheet = ss.getSheetByName('Ladder');
  if (!sheet) sheet = ss.insertSheet('Ladder');
  sheet.clear();
  sheet.getRange(1, 1, 1, LADDER_HEADERS.length).setValues([LADDER_HEADERS]).setFontWeight('bold');
  if (values.length) sheet.getRange(2, 1, values.length, LADDER_HEADERS.length).setValues(values);
  Logger.log('updateLadderStats: ' + values.length + ' players');
}

// ----------------------------------------------------------------------------
// Public GET endpoints (no secrets, no Discord IDs)
// ----------------------------------------------------------------------------

function getLadderAPI() {
  if (!isLadderMode()) return [];
  const sheet = SpreadsheetApp.getActive().getSheetByName('Ladder');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

function getWebConfigAPI() {
  return {
    appTitle: CONFIG.appTitle,
    logoUrl: CONFIG.logoUrl,
    wikiUrl: CONFIG.wikiUrl,
    defaultPage: CONFIG.defaultPage,
    rankTooltipText: CONFIG.rankTooltipText,
    recentGamesLimit: CONFIG.recentGamesLimit,
    hidePlayoffs: CONFIG.hidePlayoffs,
    tournamentType: getTournamentType(),
    // 'Match procedure' (falls back to the older key name) and 'Queue msg' are shown on the queue page
    matchProcedure: String(cfgVal_('Match procedure', cfgVal_('Group match procedure', ''))),
    queueMsg: String(cfgVal_('Queue msg', '')),
    mapPool: String(cfgVal_('Tournament maps', '')).split(',').map(function (m) { return m.trim(); }).filter(Boolean)
  };
}
