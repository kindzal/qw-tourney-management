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
    case "allGames":
      return jsonResponse(getTeamGames('all'));  
    case "scheduleConfig":
      return jsonResponse(getScheduleConfig());
    case "mapStats":                       
      return jsonResponse(getMapStats());  
    default:
      return jsonResponse({ error: "Unknown endpoint" });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getScheduleConfig() {  
  const scheduleConfigSheet = SpreadsheetApp.getActive().getSheetByName('ScheduleConfig');

  if (!scheduleConfigSheet) {
    throw new Error("ScheduleConfig sheet not found");
  }

  const values = scheduleConfigSheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(h => String(h).trim());

  const roundIdx = headers.indexOf("Round");
  const mapsIdx = headers.indexOf("Maps");
  const deadlineIdx = headers.indexOf("Deadline");

  if (roundIdx === -1 || deadlineIdx === -1) {
    throw new Error("ScheduleConfig must contain Round and Deadline columns");
  }

  return values.slice(1)
    .filter(r => r[roundIdx] !== "" && r[roundIdx] != null)
    .map(r => ({
      round: String(r[roundIdx]).trim(),
      maps: mapsIdx !== -1 ? r[mapsIdx] : "",
      deadline: r[deadlineIdx] instanceof Date
      ? Utilities.formatDate(
          r[deadlineIdx],
          Session.getScriptTimeZone(),
          "dd/MM/yyyy"
        )
      : r[deadlineIdx]
     }));
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

  const PRIORITY_ORDER = ["Rank", "Player", "Maps Pld", "Avg Frags", "Win %", "Avg Eff", "Avg SG", "Avg LG", "Avg RL Kld"];
  const EXCLUDE = ["Game Nicks", "Team", "Total Frags", "Maps Won", ];

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
  const gamesSheet = ss.getSheetByName("TeamGames");
  if (!gamesSheet) {
    throw new Error("TeamGames sheet not found");
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
  
  const REQUIRED = ["Stage", "Round", "TeamA", "TeamB", "MapsWonA", "MapsWonB", "AllMapsJSON", "Date"];
  REQUIRED.forEach(col => {
    if (!(col in gIdx)) {
      throw new Error(`Missing column in games sheet: ${col}`);
    }
  });
  
  // Played games indexed by team-pair
  const playedByPair = {};
  gameValues.forEach(row => {
    const stage = String(row[gIdx.Stage]).trim();
    const round = row[gIdx.Round];
    if (round === "" || round == null) return;
    
    // Filter by mode using Stage column
    if (mode === 'group' && stage !== 'Group') return;
    if (mode === 'playoff' && stage !== 'Playoff') return;
    // mode === 'all' → include everything
    
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
    
    const rawDate = row[gIdx.Date];
    let gameDate;
    if (rawDate instanceof Date) {
      gameDate = rawDate;
    } else {
      const iso = String(rawDate)
        .replace(" ", "T")
        .replace(/ ([+-]\d{2})(\d{2})$/, "$1:$2");
      gameDate = new Date(iso);
    }
    
    const game = {
      stage,
      round: String(round),
      teamA: row[gIdx.TeamA],
      teamB: row[gIdx.TeamB],
      mapsWonA: Number(row[gIdx.MapsWonA]) || 0,
      mapsWonB: Number(row[gIdx.MapsWonB]) || 0,
      played: 1,
      maps,
      date: gameDate
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
  
  ["Round", "Team1", "Team2", "Scheduled For"].forEach(col => {
    if (!(col in sIdx)) {
      throw new Error(`Missing column in Schedule: ${col}`);
    }
  });
  
  // Track how many games we've already consumed per team-pair
  const pairCursor = {};
  const result = [];
  
  schedValues.forEach(row => {
    const round = row[sIdx.Round];
    if (round === "" || round == null) return;
    
    // Determine stage based on round type
    const isGroup = isNumericRound(round);
    const stage = isGroup ? 'Group' : 'Playoff';
    
    // Filter by mode
    if (mode === 'group' && !isGroup) return;
    if (mode === 'playoff' && isGroup) return;
    // mode === 'all' → include everything
    
    const team1 = row[sIdx.Team1];
    const team2 = row[sIdx.Team2];
    const key = pairKey(team1, team2);
    const scheduledFor = row[sIdx["Scheduled For"]];
    
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
        stage,
        round: String(round),
        teamA: team1,
        teamB: team2,
        mapsWonA: "",
        mapsWonB: "",
        played: 0,
        maps: [],
        date: scheduledFor
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
  const values = sheet.getRange(1, 1, lastRow, 4).getValues();
  const headers = values.shift();

  const TAG_COLUMNS = ["Team Tag", "Team Tag Display"];

  return values.map(row => {
    const obj = Object.fromEntries(headers.map((h, i) => [h, row[i]]));
    TAG_COLUMNS.forEach(col => {
      if (col in obj) obj[col] = parseTagAliases(obj[col]);
    });
    return obj;
  });
}

function getMapStats() {
  const sheet = SpreadsheetApp.getActive().getSheetByName("MapStats");

  // If sheet does not exist → return empty structure
  if (!sheet) {
    return {
      totals: {},
      maps: []
    };
  }

  const values = sheet.getDataRange().getValues();

  // If sheet exists but has no data rows
  if (values.length < 2) {
    return {
      totals: {},
      maps: []
    };
  }

  const headers = values.shift().map(h => String(h).trim());

  const playedIdx = headers.indexOf("Played");
  const totalFragsIdx = headers.indexOf("Total Frags");
  const mapNameIdx = headers.indexOf("Map Name");

  const maps = values.map(row => {
    const obj = Object.fromEntries(
      headers.map((h, i) => [h, row[i]])
    );

    // Parse JSON columns safely
    ["Dominant Team", "Highest Frag Game", "Most One-Sided Game"]
      .forEach(col => {
        if (obj[col]) {
          try {
            obj[col] = JSON.parse(obj[col]);
          } catch (e) {
            // Leave as raw value if parsing fails
          }
        }
      });

    // ----------------------------------------
    // Add Map Snap URL
    // ----------------------------------------
    const mapName = row[mapNameIdx];
    obj.mapSnapUrl =
      "https://a.quake.world/mapshots/webp/sm/" +
      mapName +
      ".webp";

    return obj;
  });

  // ----------------------------------------
  // Build totals
  // ----------------------------------------
  let totalPlayed = 0;
  let totalFrags = 0;

  values.forEach(row => {
    totalPlayed += Number(row[playedIdx]) || 0;
    totalFrags += Number(row[totalFragsIdx]) || 0;
  });

  const avgFrags =
    totalPlayed > 0
      ? Number((totalFrags / totalPlayed).toFixed(2))
      : 0;

  return {
    totals: {
      totalPlayed,
      totalFrags,
      avgFrags
    },
    maps
  };
}