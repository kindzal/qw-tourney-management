function handleApiRequest(e) {
  const endpoint = e.parameter.endpoint;

  switch (endpoint) {
    case "standings":
      return jsonResponse(getStandingsAPI());
    case "players":
      return jsonResponse(getPlayersAPI());
    case "groupGames":
      return jsonResponse(getTeamGamesAPI('group'));
    case "playoffGames":
      return jsonResponse(getTeamGamesAPI('playoff'));
    case "teams":
      return jsonResponse(getTeamsAPI());        
    case "allGames":
      return jsonResponse(getTeamGamesAPI('all'));  
    case "scheduleConfig":
      return jsonResponse(getScheduleConfigAPI());
    case "mapStats":                       
      return jsonResponse(getMapStatsAPI());  
    default:
      return jsonResponse({ error: "Unknown endpoint" });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Logo URL base path
const LOGO_BASE_URL = 'https://cdn.jsdelivr.net/gh/kindzal/my-assets@master/images/clan-logos/optimised/';

/**
 * Strips emoji characters from a string, replacing them with spaces.
 * @param {string} str - Input string
 * @returns {string} String with emojis replaced by spaces, collapsed and trimmed
 */
function stripEmojis(str) {
  if (!str) return '';
  // Replace emoji characters with spaces (covers most common emoji ranges)
  return String(str)
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1FA00}-\u{1FAFF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{231A}-\u{231B}]|[\u{23E9}-\u{23F3}]|[\u{23F8}-\u{23FA}]|[\u{25AA}-\u{25AB}]|[\u{25B6}]|[\u{25C0}]|[\u{25FB}-\u{25FE}]|[\u{2614}-\u{2615}]|[\u{2648}-\u{2653}]|[\u{267F}]|[\u{2693}]|[\u{26A1}]|[\u{26AA}-\u{26AB}]|[\u{26BD}-\u{26BE}]|[\u{26C4}-\u{26C5}]|[\u{26CE}]|[\u{26D4}]|[\u{26EA}]|[\u{26F2}-\u{26F3}]|[\u{26F5}]|[\u{26FA}]|[\u{26FD}]|[\u{2702}]|[\u{2705}]|[\u{2708}-\u{270D}]|[\u{270F}]|[\u{2712}]|[\u{2714}]|[\u{2716}]|[\u{271D}]|[\u{2721}]|[\u{2728}]|[\u{2733}-\u{2734}]|[\u{2744}]|[\u{2747}]|[\u{274C}]|[\u{274E}]|[\u{2753}-\u{2755}]|[\u{2757}]|[\u{2763}-\u{2764}]|[\u{2795}-\u{2797}]|[\u{27A1}]|[\u{27B0}]|[\u{27BF}]|[\u{2934}-\u{2935}]|[\u{2B05}-\u{2B07}]|[\u{2B1B}-\u{2B1C}]|[\u{2B50}]|[\u{2B55}]|[\u{3030}]|[\u{303D}]|[\u{3297}]|[\u{3299}]|[\u{FE0F}]|[\u{200D}]/gu, ' ')
    .replace(/\s+/g, ' ')   // Collapse multiple spaces to single space
    .trim();
}

/**
 * Creates a cleaned team name for logo URL (lowercase, no spaces, no special chars).
 * @param {string} teamName - Original team name
 * @returns {string} Cleaned name for URL
 */
function cleanTeamNameForLogo(teamName) {
  if (!teamName) return '';
  // First strip emojis, then normalize accented chars (NFD), remove diacritics, remove special chars, lowercase
  return stripEmojis(teamName)
    .normalize('NFD')                      // Decompose: ç → c + combining cedilla, ã → a + combining tilde
    .replace(/[\u0300-\u036f]/g, '')       // Remove combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');            // Remove everything except a-z and 0-9
}

/**
 * Builds the logo URL for a team.
 * @param {string} teamName - Original team name
 * @returns {string} Full logo URL
 */
function buildTeamLogoUrl(teamName) {
  const cleaned = cleanTeamNameForLogo(teamName);
  if (!cleaned) return LOGO_BASE_URL + 'fallback.png';
  return LOGO_BASE_URL + cleaned + '.png';
}

function getScheduleConfigAPI() {  
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
  const scheduleInfoSentIdx = headers.indexOf("Schedule Info Sent");

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
      : r[deadlineIdx],
      scheduleInfoSent: scheduleInfoSentIdx !== -1 ? String(r[scheduleInfoSentIdx] || "No").trim() : "No"
     }));
}

function getStandingsAPI() {
  const sheet = SpreadsheetApp.getActive().getSheetByName("Standings");
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();

  return values.map(r => {
    const obj = Object.fromEntries(headers.map((h,i) => [h, r[i]]));
    
    // Add Team Display Name and logo URL
    const teamName = obj['Team'] || obj['Team Name'] || '';
    obj['Team Display Name'] = stripEmojis(teamName);
    obj['teamLogoUrl'] = buildTeamLogoUrl(teamName);
    
    return obj;
  });
}

function getPlayersAPI() {
  const sheet = SpreadsheetApp.getActive().getSheetByName("Players");
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();

  const PRIORITY_ORDER = ["Player", "Rank", "Maps Pld", "Avg Frags", "Win %", "Avg Eff", "Avg SG", "Avg LG", "Avg RL Kld"];
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

function getTeamGamesAPI(mode = 'group') {
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
    
    const teamAName = row[gIdx.TeamA];
    const teamBName = row[gIdx.TeamB];
    
    const game = {
      stage,
      round: String(round),
      teamA: teamAName,
      teamB: teamBName,
      teamALogoUrl: buildTeamLogoUrl(teamAName),
      teamBLogoUrl: buildTeamLogoUrl(teamBName),
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
        teamALogoUrl: buildTeamLogoUrl(team1),
        teamBLogoUrl: buildTeamLogoUrl(team2),
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

function getTeamsAPI() {
  const sheet = SpreadsheetApp.getActive().getSheetByName("Teams");
  if (!sheet) throw new Error('Teams sheet not found');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // Get only columns A–C
  const values = sheet.getRange(1, 1, lastRow, 4).getValues();
  const headers = values.shift();

  const TAG_COLUMNS = ["Team Tag"];

  return values.map(row => {
    const obj = Object.fromEntries(headers.map((h, i) => [h, row[i]]));
    TAG_COLUMNS.forEach(col => {
      if (col in obj) obj[col] = parseTagAliases(GASdecode(obj[col]));
    });
        
    const teamName = obj['Team Name'];
        
    // Add logo URL
    obj['logoUrl'] = buildTeamLogoUrl(teamName);
    
    return obj;
  });
}

function getMapStatsAPI() {
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
            const parsed = JSON.parse(obj[col]);

            if (col === "Highest Frag Game" || col === "Most One-Sided Game") {
              if (parsed.teamNameA) {
                parsed.teamLogoUrlA = buildTeamLogoUrl(parsed.teamNameA);
              }
              if (parsed.teamNameB) {
                parsed.teamLogoUrlB = buildTeamLogoUrl(parsed.teamNameB);
              }
            }

            if (col === "Dominant Team" && parsed.teamName) {
              parsed.teamLogoUrl = buildTeamLogoUrl(parsed.teamName);
            }
            obj[col] = parsed;
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
      "https://assets.quake.world/mapshots/sm/" +
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