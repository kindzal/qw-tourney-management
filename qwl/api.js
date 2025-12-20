function handleApiRequest(e) {
  const endpoint = e.parameter.endpoint;

  switch (endpoint) {
    case "standings":
      return jsonResponse(getStandings());
    case "players":
      return jsonResponse(getPlayers());
    case "games":
      return jsonResponse(getTeamGames());
    case "teams":
      return jsonResponse(getTeams());  
    default:
      return jsonResponse({ error: "Unknown endpoint" });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getStandings() {
  const sheet = SpreadsheetApp.getActive().getSheetByName("Standings");
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();

  return values.map(r => Object.fromEntries(headers.map((h,i) => [h, r[i]])));
}

function getPlayers() {
  const sheet = SpreadsheetApp.getActive().getSheetByName("Players");
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();

  const PRIORITY_ORDER = ["Rank", "Player", "Avg Frags", "Win Rate", "Avg Eff", "Avg SG", "Avg LG", "Avg RL Killed"];
  const EXCLUDE = ["Game Nicks", "Team"];

  return values.map(row => {
    const rowObj = Object.fromEntries(
      headers.map((h, i) => [h, row[i]])
    );

    // Remove excluded columns
    EXCLUDE.forEach(col => delete rowObj[col]);

    const ordered = {};

    // Add priority columns first (if they exist)
    PRIORITY_ORDER.forEach(col => {
      if (col in rowObj) {
        ordered[col] = rowObj[col];
      }
    });

    // Add remaining columns in original sheet order
    headers.forEach(h => {
      if (
        !(h in ordered) &&
        h in rowObj &&
        !EXCLUDE.includes(h)
      ) {
        ordered[h] = rowObj[h];
      }
    });

    return ordered;
  });
}

function getTeamGames() {
  const ss = SpreadsheetApp.getActive();

  const gamesSheet = ss.getSheetByName("TeamGames");
  if (!gamesSheet) throw new Error("Sheet 'TeamGames' not found");

  const scheduleSheet = ss.getSheetByName("Schedule");
  if (!scheduleSheet) throw new Error("Sheet 'Schedule' not found");

  /* ---------- TEAM GAMES (PLAYED) ---------- */

  const gameValues = gamesSheet.getDataRange().getValues();
  const gameHeaders = gameValues.shift();

  const gIdx = {};
  gameHeaders.forEach((h, i) => gIdx[h.trim()] = i);

  const REQUIRED = ["Round", "TeamA", "TeamB", "MapsWonA", "MapsWonB", "AllMapsJSON"];
  REQUIRED.forEach(col => {
    if (!(col in gIdx)) throw new Error(`Missing column in TeamGames: ${col}`);
  });

  const gamesByRound = {};

  gameValues.forEach(row => {
    const round = row[gIdx.Round];
    if (round === "" || round == null) return;

    const roundKey = String(round);

    let maps = [];
    const allMapsRaw = row[gIdx.AllMapsJSON];
    if (allMapsRaw) {
      try {
        maps = JSON.parse(allMapsRaw).map(m => ({
          mapName: m.mapName || "",
          teamAFrags: Number(m.teamAFrags) || 0,
          teamBFrags: Number(m.teamBFrags) || 0,
          gameUrl: m.gameUrl || ""
        }));
      } catch (e) {
        Logger.log(`Failed to parse AllMapsJSON (round ${roundKey}): ${e}`);
      }
    }

    if (!gamesByRound[roundKey]) gamesByRound[roundKey] = [];

    gamesByRound[roundKey].push({
      round: roundKey,
      teamA: row[gIdx.TeamA],
      teamB: row[gIdx.TeamB],
      mapsWonA: Number(row[gIdx.MapsWonA]) || 0,
      mapsWonB: Number(row[gIdx.MapsWonB]) || 0,
      played: 1,
      maps
    });
  });

  /* ---------- SCHEDULE (UNPLAYED) ---------- */

  const schedValues = scheduleSheet.getDataRange().getValues();
  const schedHeaders = schedValues.shift();

  const sIdx = {};
  schedHeaders.forEach((h, i) => sIdx[h.trim()] = i);

  ["Round", "Team1", "Team2"].forEach(col => {
    if (!(col in sIdx)) throw new Error(`Missing column in schedule: ${col}`);
  });

  schedValues.forEach(row => {
    const round = row[sIdx.Round];
    if (round === "" || round == null) return;

    // Only numeric rounds
    if (isNaN(Number(round))) return;

    const roundKey = String(round);

    if (!gamesByRound[roundKey]) gamesByRound[roundKey] = [];

    // Avoid duplicating already played games
    const alreadyExists = gamesByRound[roundKey].some(g =>
      (g.teamA === row[sIdx.Team1] && g.teamB === row[sIdx.Team2]) ||
      (g.teamA === row[sIdx.Team2] && g.teamB === row[sIdx.Team1])
    );

    if (alreadyExists) return;

    gamesByRound[roundKey].push({
      round: roundKey,
      teamA: row[sIdx.Team1],
      teamB: row[sIdx.Team2],
      mapsWonA: "",
      mapsWonB: "",
      played: 0,
      maps: []   // no maps yet → UI shows no popup content
    });
  });

  /* ---------- FLATTEN & SORT ---------- */

  const result = [];

  Object.keys(gamesByRound)
    .sort((a, b) => Number(a) - Number(b))
    .forEach(roundKey => {
      gamesByRound[roundKey].forEach(game => result.push(game));
    });

  return result;
}

function getTeams() {
  const sheet = SpreadsheetApp.getActive().getSheetByName("Teams");
  if (!sheet) throw new Error('Teams sheet not found');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // Get only columns A–C
  const values = sheet.getRange(1, 1, lastRow, 3).getValues();
  const headers = values.shift();

  return values.map(row =>
    Object.fromEntries(
      headers.map((h, i) => [h, row[i]])
    )
  );
}
