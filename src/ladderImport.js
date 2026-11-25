// =============================================================================
// LADDER import and match/stat updating. Separate from the tournament functions so
// the tournament code is untouched. Reached only through the guarded one-liners in
// autoImportGames() and updateStats() (Ladder mode only).
// Same trigger, same 19:00-23:59 window, same Hub query as the tournament import.
// =============================================================================

/** Tag (lowercase, first alias) -> { tag, name, color } from the Teams tab. */
function ladderTeams_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Teams');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const v = sheet.getDataRange().getValues();
  const h = v[0].map(x => String(x).trim());
  const tagCol = h.indexOf('Team Tag'); const nameCol = h.indexOf('Team Name'); const colorCol = h.indexOf('Team Color');
  const out = [];
  v.slice(1).forEach(r => {
    const aliases = parseTagAliases(GASdecode(r[tagCol]));
    const name = String(r[nameCol] || '').trim();
    if (!aliases.length || !name) return;
    out.push({ tag: aliases[0].toLowerCase(), aliases: aliases.map(a => a.toLowerCase()), name: name,
      color: colorCol === -1 ? '' : String(r[colorCol] === undefined ? '' : r[colorCol]).trim() });
  });
  return out;
}

/** alias (lowercase) -> canonical tag (lowercase) */
function ladderAliasMap_(teams) {
  const m = {};
  teams.forEach(t => t.aliases.forEach(a => { m[a] = t.tag; }));
  return m;
}

/** Pure: decide whether a Hub game should be imported. Returns null to import or a skip reason. */
function ladderSkipReason_(game, aliasMap, cfg, importedUrls, urlPrefix, nameFn) {
  if (importedUrls.has(urlPrefix + game.id)) return 'already imported';
  if (hasExcludedKeyword(game.matchtag, cfg.excludedKeywords)) return 'excluded keyword';
  const gameDate = new Date(game.timestamp);
  if (gameDate < cfg.tournamentStart || gameDate > cfg.tournamentEnd) return 'outside tournament window';
  const tags = (game.teams || []).map(t => { const raw = nameFn(t.name).toLowerCase(); return aliasMap[raw] || raw; });
  if (tags.length !== 2 || tags[0] === tags[1]) return 'not two teams';
  if (!aliasMap[tags[0]] || !aliasMap[tags[1]]) return 'team not in Teams tab';
  return null;
}

/** Ladder version of autoImportGames: no schedule needed; both teams must exist in the Teams tab. */
function ladderAutoImportGames_() {
  const cfg = loadAutoImportConfig();
  if (!cfg) return;
  const importedUrls = loadImportedUrls();
  const aliasMap = ladderAliasMap_(ladderTeams_());
  const games = fetchHubGames(cfg);
  if (!games || games.length === 0) { Logger.log('ladderImport: no games returned from API'); return; }

  let enqueued = 0;
  games.forEach(game => {
    const why = ladderSkipReason_(game, aliasMap, cfg, importedUrls, GAME_URL_PREFIX, quakeNameToStandard);
    if (why) { Logger.log('ladderImport: skip (' + why + ') ' + game.id); return; }
    if (enqueueMessageIfNew('auto_match_' + game.id, new Date().toISOString(), 'MATCH_REPORT', { url: GAME_URL_PREFIX + game.id })) enqueued++;
  });
  if (enqueued > 0) enqueueMessage('update_stats_auto_' + Date.now(), new Date().toISOString(), 'UPDATE_STATS', {});
  Logger.log('ladderImport: enqueued ' + enqueued + ' game(s)');
}

/** Ladder version of updateStats: player ranks (existing), matches and map stats (new), FIX-ME (existing), points (new). */
function ladderUpdateStats_(interactive) {
  updatePlayerAndStandinsStats();
  ladderUpdateMatches_();
  generateFixMeReport();
  updateLadderStats();
  if (interactive) SpreadsheetApp.getUi().alert('Ladder stats updated.');
}

// ----------------------------------------------------------------------------
// Match definition (pure): maps between the same two teams within `windowMin` minutes of the
// match's first map are one match. Default 160 min = BO5 (5 x 20 min) + 60 min of delays.
// ----------------------------------------------------------------------------

function ladderBuildMatches_(gamesData, excludedUrls, windowMin, canonicalTag) {
  const byUrl = new Map();
  for (let j = 1; j < gamesData.length; j++) {
    const url = String(gamesData[j][0] || '').trim();
    if (!url || (excludedUrls && excludedUrls.has(url))) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(gamesData[j]);
  }
  const maps = [];
  byUrl.forEach((rows, url) => {
    const teams = {};
    rows.forEach(r => {
      const tag = canonicalTag(String(r[7]));
      if (!teams[tag]) teams[tag] = { won: false, frags: 0 };
      if (Number(r[5]) === 1) teams[tag].won = true;
      teams[tag].frags += Number(r[6]) || 0;
    });
    if (Object.keys(teams).length !== 2) return;
    const d = parseGameDate_(rows[0][1]);
    maps.push({ mapName: rows[0][2], mapUrl: url, mapDate: d ? d.getTime() : 0, teams: teams });
  });
  maps.sort((a, b) => a.mapDate - b.mapDate);

  const matches = [];
  maps.forEach(map => {
    const key = Object.keys(map.teams).sort().join('|');
    const m = matches.filter(x => x.key === key && Math.abs(map.mapDate - x.matchDate) / 60000 <= windowMin)[0];
    if (m) m.maps.push(map);
    else matches.push({ key: key, teams: Object.keys(map.teams).sort(), maps: [map], matchDate: map.mapDate });
  });
  matches.forEach(m => {
    m.scores = {}; m.teams.forEach(t => { m.scores[t] = 0; });
    m.maps.forEach(map => Object.keys(map.teams).forEach(t => { if (map.teams[t].won) m.scores[t]++; }));
  });
  return matches;
}

/** Pure: MapStats output rows (header first), same format the existing mapStats API reads. */
function ladderMapStatsRows_(matches, nameOf, extraMaps) {
  const header = ['Map Name', 'Played', 'Total Frags', 'Avg Frags', 'Dominant Team', 'Highest Frag Game', 'Most One-Sided Game'];
  const st = {};
  const blank = () => ({ played: 0, totalFrags: 0, wins: {}, high: null, highTotal: -1, side: null, sideDiff: -1 });
  matches.forEach(m => m.maps.forEach(map => {
    const s = st[map.mapName] || (st[map.mapName] = blank());
    s.played++;
    const [a, b] = Object.keys(map.teams).sort();
    const fa = map.teams[a].frags; const fb = map.teams[b].frags;
    s.totalFrags += fa + fb;
    const winner = map.teams[a].won ? a : (map.teams[b].won ? b : null);
    if (winner) s.wins[winner] = (s.wins[winner] || 0) + 1;
    const info = { gameUrl: map.mapUrl, teamNameA: nameOf(a), teamNameB: nameOf(b), fragsA: fa, fragsB: fb };
    if (fa + fb > s.highTotal) { s.highTotal = fa + fb; s.high = info; }
    if (Math.abs(fa - fb) > s.sideDiff) { s.sideDiff = Math.abs(fa - fb); s.side = info; }
  }));
  (extraMaps || []).forEach(n => { if (!st[n]) st[n] = blank(); });
  const rows = [header];
  Object.keys(st).sort((x, y) => st[y].played - st[x].played).forEach(name => {
    const s = st[name]; let best = null; let bestWins = 0;
    Object.keys(s.wins).forEach(t => { if (s.wins[t] > bestWins) { bestWins = s.wins[t]; best = t; } });
    const dom = best && s.played ? JSON.stringify({ teamName: nameOf(best), wins: bestWins, winPercentage: Number((bestWins / s.played * 100).toFixed(2)) }) : '';
    rows.push([name, s.played, s.totalFrags, s.played ? (s.totalFrags / s.played).toFixed(2) : '0', dom,
      s.high ? JSON.stringify(s.high) : '', s.side ? JSON.stringify(s.side) : '']);
  });
  return rows;
}

const LADDER_MATCH_HEADERS = ['#', 'Date', 'TeamA', 'MapsWonA', 'MapsWonB', 'TeamB', 'AllMapsJSON'];

/** Writes LadderMatches and MapStats from Games. */
function ladderUpdateMatches_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const games = ss.getSheetByName('Games');
  if (!games) return;
  const teams = ladderTeams_();
  const alias = ladderAliasMap_(teams);
  const nameByTag = {}; teams.forEach(t => { nameByTag[t.tag] = t.name; });
  const canonical = tag => { const k = GASdecode(tag).toLowerCase(); return alias[k] || k; };
  const nameOf = tag => nameByTag[tag] || tag;
  const windowMin = Number(cfgVal_('Ladder match window minutes', 160)) || 160;

  const matches = ladderBuildMatches_(games.getDataRange().getValues(), ensureExcludedGamesTab(), windowMin, canonical);

  const rows = matches.map((m, i) => {
    const [a, b] = m.teams;
    const allMaps = m.maps.map(map => ({ mapName: map.mapName, teamAFrags: map.teams[a].frags, teamBFrags: map.teams[b].frags, gameUrl: map.mapUrl }));
    return [i + 1, new Date(m.matchDate).toISOString(), nameOf(a), m.scores[a], m.scores[b], nameOf(b), JSON.stringify(allMaps)];
  });
  let sheet = ss.getSheetByName('LadderMatches');
  if (!sheet) sheet = ss.insertSheet('LadderMatches');
  sheet.clearContents();
  sheet.getRange(1, 1, 1, LADDER_MATCH_HEADERS.length).setNumberFormat('@STRING@').setValues([LADDER_MATCH_HEADERS]);
  if (rows.length) sheet.getRange(2, 1, rows.length, LADDER_MATCH_HEADERS.length).setNumberFormat('@STRING@').setValues(rows);

  const pool = String(cfgVal_('Tournament maps', '')).split(',').map(s => s.trim()).filter(Boolean);
  const statRows = ladderMapStatsRows_(matches, nameOf, pool);
  let ms = ss.getSheetByName('MapStats');
  if (!ms) ms = ss.insertSheet('MapStats');
  ms.clearContents().getRange(1, 1, statRows.length, statRows[0].length).setNumberFormat('@STRING@').setValues(statRows);
}

/** Public: same shape as getTeamGamesAPI entries, so the Recent page cards work unchanged. */
function getLadderGamesAPI() {
  if (!isLadderMode()) return [];
  const sheet = SpreadsheetApp.getActive().getSheetByName('LadderMatches');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const v = sheet.getDataRange().getValues(); v.shift();
  return v.map(r => {
    let maps = [];
    try { maps = JSON.parse(r[6]); } catch (e) { maps = []; }
    return {
      stage: 'Ladder', round: '', teamA: r[2], teamB: r[5],
      teamALogoUrl: buildTeamLogoUrl(r[2]), teamBLogoUrl: buildTeamLogoUrl(r[5]),
      mapsWonA: Number(r[3]) || 0, mapsWonB: Number(r[4]) || 0, played: 1,
      maps: maps.map(m => ({ mapName: m.mapName || '', teamAFrags: Number(m.teamAFrags) || 0, teamBFrags: Number(m.teamBFrags) || 0, gameUrl: m.gameUrl || '' })),
      date: String(r[1])
    };
  });
}
