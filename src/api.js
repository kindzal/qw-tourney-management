function handleApiRequest(e) {
  const endpoint = e.parameter.endpoint;

  switch (endpoint) {
    case "standings":
      return jsonResponse(getStandings());
    case "players":
      return jsonResponse(getPlayers());
    case "groupGames":
      return jsonResponse(getTeamGames('group'));
    case "playoffGames":
      return jsonResponse(getTeamGames('playoff'));
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

function getTeamGames(mode = 'group') {
  const ss = SpreadsheetApp.getActive();

  const gamesSheet =
    mode === 'group'
      ? ss.getSheetByName("TeamGames")
      : ss.getSheetByName("TeamGamesPlayoffs");

  if (!gamesSheet) {
    throw new Error(`Games sheet not found for mode: ${mode}`);
  }

  const scheduleSheet = ss.getSheetByName("Schedule");
  if (!scheduleSheet) {
    throw new Error("Sheet 'Schedule' not found");
  }

  /* ---------- HELPERS ---------- */

  function isNumericRound(r) {
    return !isNaN(Number(r));
  }

  function pairKey(a, b) {
    return [String(a).trim(), String(b).trim()]
      .sort()
      .join("||")
      .toLowerCase();
  }

  /* ---------- READ PLAYED GAMES ---------- */

  const gameValues = gamesSheet.getDataRange().getValues();
  const gameHeaders = gameValues.shift();

  const gIdx = {};
  gameHeaders.forEach((h, i) => (gIdx[h.trim()] = i));

  const REQUIRED = ["Round", "TeamA", "TeamB", "MapsWonA", "MapsWonB", "AllMapsJSON"];
  REQUIRED.forEach(col => {
    if (!(col in gIdx)) {
      throw new Error(`Missing column in games sheet: ${col}`);
    }
  });

  // Played games indexed by team-pair
  const playedByPair = {};

  gameValues.forEach(row => {
    const round = row[gIdx.Round];
    if (round === "" || round == null) return;

    // Respect mode: numeric = group, non-numeric = playoff
    if (mode === 'group' && !isNumericRound(round)) return;
    if (mode === 'playoff' && isNumericRound(round)) return;

    let maps = [];
    const raw = row[gIdx.AllMapsJSON];
    if (raw) {
      try {
        maps = JSON.parse(raw).map(m => ({
          mapName: m.mapName || "",
          teamAFrags: Number(m.teamAFrags) || 0,
          teamBFrags: Number(m.teamBFrags) || 0,
          gameUrl: m.gameUrl || ""
        }));
      } catch (e) {
        Logger.log(`Failed to parse AllMapsJSON: ${e}`);
      }
    }

    const game = {
      round: String(round),
      teamA: row[gIdx.TeamA],
      teamB: row[gIdx.TeamB],
      mapsWonA: Number(row[gIdx.MapsWonA]) || 0,
      mapsWonB: Number(row[gIdx.MapsWonB]) || 0,
      played: 1,
      maps
    };

    const key = pairKey(game.teamA, game.teamB);
    if (!playedByPair[key]) playedByPair[key] = [];
    playedByPair[key].push(game);
  });

  /* ---------- READ SCHEDULE ---------- */

  const schedValues = scheduleSheet.getDataRange().getValues();
  const schedHeaders = schedValues.shift();

  const sIdx = {};
  schedHeaders.forEach((h, i) => (sIdx[h.trim()] = i));

  ["Round", "Team1", "Team2"].forEach(col => {
    if (!(col in sIdx)) {
      throw new Error(`Missing column in Schedule: ${col}`);
    }
  });

  // Track how many games we’ve already consumed per team-pair
  const pairCursor = {};
  const result = [];

  schedValues.forEach(row => {
    const round = row[sIdx.Round];
    if (round === "" || round == null) return;

    // Respect mode
    if (mode === 'group' && !isNumericRound(round)) return;
    if (mode === 'playoff' && isNumericRound(round)) return;

    const team1 = row[sIdx.Team1];
    const team2 = row[sIdx.Team2];

    const key = pairKey(team1, team2);
    const playedList = playedByPair[key] || [];
    const idx = pairCursor[key] || 0;

    if (idx < playedList.length) {
      // Consume next played game
      const game = playedList[idx];
      pairCursor[key] = idx + 1;

      result.push({
        ...game,
        round: String(round)
      });
    } else {
      // No played game yet → placeholder
      result.push({
        round: String(round),
        teamA: team1,
        teamB: team2,
        mapsWonA: "",
        mapsWonB: "",
        played: 0,
        maps: []
      });
    }
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