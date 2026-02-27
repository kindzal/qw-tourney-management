function parseDateTime(text) {
  // Freeze "now" for deterministic tests (can be overridden by tests)
  const now = typeof TEST_NOW !== 'undefined' ? new Date(TEST_NOW) : new Date();

  let hour = 21;
  let minute = 0;

  // ---- Extract timezone first (don't break time parsing) ----
  const tzMatch = text.match(/(CET|CEST)/i);
  const explicitTz = tzMatch ? tzMatch[1].toUpperCase() : null;

  // Remove timezone safely (even if attached like 20:45CET)
  const cleanText = text.replace(/(CET|CEST)/gi, "").trim();

  // ---- TIME PARSING (strict priority order) ----

  // 1️⃣ 24-hour format (20:45)
  const time24 = cleanText.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);

  if (time24) {
    hour = Number(time24[1]);
    minute = Number(time24[2]);

  } else {

    // 2️⃣ 12-hour format (9pm)
    const time12 = cleanText.match(/\b(\d{1,2})\s?(am|pm)\b/i);

    if (time12) {
      hour = Number(time12[1]) % 12;
      if (time12[2].toLowerCase() === "pm") hour += 12;

    } else {

      // 3️⃣ Bare hour (21, @21, 21 )
      const timeHourOnly = cleanText.match(/(?:@|\s)([01]?\d|2[0-3])\b/);

      if (timeHourOnly) {
        hour = Number(timeHourOnly[1]);
        minute = 0;
      }
    }
  }

  // ---- DATE PARSING (explicit date wins over weekday) ----

  let date =
    parseNamedDate(cleanText, now) ||
    parseNumericDate(cleanText, now);

  if (!date) {
    date =
      parseRelativeDate(cleanText, now) ||
      parseWeekday(cleanText, now);
  }

  if (!date) return null;

  date.setHours(hour, minute, 0, 0);

  // ---- Timezone inference ----
  const timezone = explicitTz || inferCetOrCest(date);

  return formatDate(date, timezone);
}

function parseNamedDate(text, now) {
  const months = {
    january: 0, february: 1, march: 2, april: 3,
    may: 4, june: 5, july: 6, august: 7,
    september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, mar: 2, apr: 3,
    jun: 5, jul: 6, aug: 7,
    sep: 8, sept: 8, oct: 9, nov: 10, dec: 11
  };

  // 1️⃣ Remove weekday safely (no heavy regex)
  const cleaned = text.replace(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    ""
  );

  // 2️⃣ Match "22nd February" or "February 22nd"
  const match = cleaned.match(
    /\b(\d{1,2})(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\s+(\d{1,2})(st|nd|rd|th)?\b/i
  );

  if (!match) return null;

  let day, month;

  if (match[1]) {
    // 22 February
    day = Number(match[1]);
    month = months[match[3].toLowerCase()];
  } else {
    // February 22
    day = Number(match[5]);
    month = months[match[4].toLowerCase()];
  }

  const year = now.getFullYear();
  return new Date(year, month, day);
}


function parseRelativeDate(text, now) {
  const lower = text.toLowerCase();

  if (lower.includes("today")) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  if (lower.includes("tonight")) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  if (lower.includes("tomorrow")) {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return new Date(
      tomorrow.getFullYear(),
      tomorrow.getMonth(),
      tomorrow.getDate()
    );
  }

  return null;
}

function parseNumericDate(text, now) {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return new Date(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3])
    );
  }

  const eu = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);
  if (eu) {
    const year = eu[3] ? Number(eu[3]) : now.getFullYear();
    return new Date(
      year,
      Number(eu[2]) - 1,
      Number(eu[1])
    );
  }

  return null;
}

function parseWeekday(text, now) {
  const days = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6
  };

  const match = text.match(
    /\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i
  );

  if (!match) return null;

  const isNext = !!match[1];
  const targetDay = days[match[2].toLowerCase()];

  const d = new Date(now);
  const diff = (targetDay - d.getDay() + 7) % 7 || 7;

  d.setDate(d.getDate() + (isNext ? diff + 7 : diff));
  return d;
}

function monthToIndex(mon) {
  return {
    jan: 0, feb: 1, mar: 2, apr: 3,
    may: 4, jun: 5, jul: 6, aug: 7,
    sep: 8, oct: 9, nov: 10, dec: 11
  }[mon.toLowerCase()];
}

function formatDate(date, timezone) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');

  return `${dd}/${mm}/${yyyy} @ ${hh}:${min} ${timezone}`;
}

function inferCetOrCest(date) {
  const year = date.getFullYear();
  const marchLastSunday = lastSundayOfMonth(year, 2);
  const octoberLastSunday = lastSundayOfMonth(year, 9);

  return (date >= marchLastSunday && date < octoberLastSunday)
    ? "CEST"
    : "CET";
}

function lastSundayOfMonth(year, monthIndex) {
  const d = new Date(year, monthIndex + 1, 0);
  while (d.getDay() !== 0) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

function parseScheduledFor(dateStr) {
  // "12/02/2026 @ 21:00 CET"
  const match = dateStr.match(
    /(\d{2})\/(\d{2})\/(\d{4})\s*@\s*(\d{2}):(\d{2})/
  );
  if (!match) return null;

  return {
    day: Number(match[1]),
    month: Number(match[2]),
    year: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5])
  };
}

// Helper function to parse deadline from ScheduleConfig
function parseDeadline(deadlineStr) {
  if (!deadlineStr) return null;
  
  // Convert to string in case it's a Date object or other type
  const str = String(deadlineStr);
  
  // Try format with time: "08/02/2026 23:59:59"
  let match = str.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (match) {
    const [, day, month, year, hour, minute, second] = match;
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second)
    );
  }
  
  // Try format without time: "08/02/2026"
  match = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    // Default to end of day (23:59:59) if no time specified
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      23,
      59,
      59
    );
  }
  
  return null;
}

/**
 * Parses a date value that may be:
 *  - A native Date object (GAS read a date-formatted cell)
 *  - A string in DD/MM/YYYY format
 * Returns a Date set to midnight UTC, or null if unparseable.
 */
function parseDdMmYyyy(value) {
  if (value instanceof Date && !isNaN(value)) return value;

  const match = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const [, dd, mm, yyyy] = match;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
}

/**
 * Returns true if any excluded keyword appears in the matchtag (case-insensitive).
 */
function hasExcludedKeyword(matchtag, excludedKeywords) {
  if (!excludedKeywords || excludedKeywords.length === 0) return false;
  const lower = String(matchtag).toLowerCase();
  return excludedKeywords.some(kw => lower.includes(kw));
}

/**
 * Returns true if [teamA, teamB] (or swapped) matches any entry in scheduledPairs.
 * Both sides are already lower-cased before comparison.
 */
function isScheduledPair(teamNames, scheduledPairs) {
  if (teamNames.length < 2) return false;
  const [a, b] = teamNames;

  return scheduledPairs.some(([pa, pb]) =>
    (pa.toLowerCase() === a.toLowerCase() && pb.toLowerCase() === b.toLowerCase()) || (pa.toLowerCase() === b.toLowerCase() && pb.toLowerCase() === a.toLowerCase())
  );
}

function checkForIssues() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("FIX-ME");
  if (!sheet || sheet.getLastRow() < 2) return false;
  return Boolean(sheet.getRange(2, 1).getValue());
}

function GASencode(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  return value.startsWith("'") ? "\\" + value : value;
}

function GASdecode(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  return value.startsWith("\\'") ? value.substring(1) : value;
}

function formatMaps(mapString) {
  return mapString
    .split(",")
    .map(m => m.trim())
    .join(" • ");
}

function getFirstSundayAfter(dateString) {
  const parts = dateString.split("/");
  const date = new Date(parts[2], parts[1] - 1, parts[0]);

  const day = date.getDay();
  const daysUntilSunday = (7 - day) % 7 || 7;

  return addDays(date, daysUntilSunday);
}

function addDays(date, days) {
  const newDate = new Date(date);
  newDate.setDate(newDate.getDate() + days);
  return newDate;
}

function hasExistingData(sheet) {
  if (!sheet) return false;
  return sheet.getLastRow() > 1;
}

function ensureExcludedGamesTab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("ExcludedGames");

  if (!sheet) {
    sheet = ss.insertSheet("ExcludedGames");
    sheet.getRange(1, 1).setValue("Hub URL");
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return new Set();

  return new Set(
    sheet.getRange(2, 1, lastRow - 1, 1)
      .getValues()
      .flat()
      .map(v => String(v).trim())
      .filter(Boolean)
  );
}

// ============================================================================
// FUZZY SEARCH / LEVENSHTEIN DISTANCE
// ============================================================================

/**
 * Calculates the Levenshtein distance between two strings.
 * This is the minimum number of single-character edits (insertions, deletions,
 * or substitutions) required to change one string into the other.
 * 
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - The edit distance between the two strings
 */
function levenshteinDistance(a, b) {
  const aLower = String(a).toLowerCase();
  const bLower = String(b).toLowerCase();
  
  const aLen = aLower.length;
  const bLen = bLower.length;
  
  // Edge cases
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;
  if (aLower === bLower) return 0;
  
  // Create distance matrix
  const matrix = [];
  
  // Initialize first column
  for (let i = 0; i <= aLen; i++) {
    matrix[i] = [i];
  }
  
  // Initialize first row
  for (let j = 0; j <= bLen; j++) {
    matrix[0][j] = j;
  }
  
  // Fill in the rest of the matrix
  for (let i = 1; i <= aLen; i++) {
    for (let j = 1; j <= bLen; j++) {
      const cost = aLower[i - 1] === bLower[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  
  return matrix[aLen][bLen];
}

/**
 * Calculates similarity percentage between two strings using Levenshtein distance.
 * 
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Similarity percentage (0-100)
 */
function levenshteinSimilarity(a, b) {
  const aStr = String(a);
  const bStr = String(b);
  const maxLen = Math.max(aStr.length, bStr.length);
  
  if (maxLen === 0) return 100; // Both empty strings are identical
  
  const distance = levenshteinDistance(aStr, bStr);
  return ((maxLen - distance) / maxLen) * 100;
}

/**
 * Performs fuzzy search to find the best match for a candidate string
 * from a list of possible matches.
 * 
 * @param {string} candidate - The string to search for
 * @param {string[]} list - Array of strings to match against
 * @param {number} threshold - Minimum similarity percentage (0-100) to consider a match
 * @returns {Object|null} - Best match object { match, similarity, index } or null if no match meets threshold
 */
function fuzzySearch(candidate, list, threshold) {
  if (!candidate || !list || !Array.isArray(list) || list.length === 0) {
    return null;
  }
  
  threshold = threshold ?? 90; // Default threshold of 90%
  
  let bestMatch = null;
  let bestSimilarity = 0;
  let bestIndex = -1;
  
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (item == null) continue;
    
    const similarity = levenshteinSimilarity(candidate, item);
    
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = item;
      bestIndex = i;
    }
  }
  
  if (bestSimilarity >= threshold) {
    return {
      match: bestMatch,
      similarity: Math.round(bestSimilarity * 100) / 100,
      index: bestIndex
    };
  }
  
  return null;
}

/**
 * Finds all matches above a given threshold, sorted by similarity (descending).
 * 
 * @param {string} candidate - The string to search for
 * @param {string[]} list - Array of strings to match against
 * @param {number} threshold - Minimum similarity percentage (0-100) to include
 * @returns {Array} - Array of match objects { match, similarity, index } sorted by similarity
 */
function fuzzySearchAll(candidate, list, threshold) {
  if (!candidate || !list || !Array.isArray(list) || list.length === 0) {
    return [];
  }
  
  threshold = threshold ?? 90; // Default threshold of 90%
  
  const matches = [];
  
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (item == null) continue;
    
    const similarity = levenshteinSimilarity(candidate, item);
    
    if (similarity >= threshold) {
      matches.push({
        match: item,
        similarity: Math.round(similarity * 100) / 100,
        index: i
      });
    }
  }
  
  // Sort by similarity descending
  matches.sort((a, b) => b.similarity - a.similarity);
  
  return matches;
}

/**
 * Cleans a game nick by removing reconnect suffixes like "(1)", "(2)", etc.
 * Common in QW when players rejoin after dropping.
 * 
 * @param {string} nick - The game nick to clean
 * @returns {string} - The cleaned nick
 */
function cleanGameNick(nick) {
  if (!nick) return "";
  return String(nick)
    .replace(/\s*\(\d+\)\s*$/, "")  // Remove trailing (1), (2), etc.
    .trim();
}

/**
 * Fuzzy matches a game nick against a list of players.
 * Searches both player names and their registered game nicks.
 * 
 * @param {string} gameNick - The game nick to match (will be cleaned of reconnect suffixes)
 * @param {Array} players - Array of player objects: { name: string, nicks: string[] }
 * @param {number} threshold - Minimum similarity percentage (0-100), default 65
 * @returns {Object|null} - Best match { player: string, matchedOn: string, similarity: number } or null
 */
function fuzzyMatchPlayer(gameNick, players, threshold) {
  if (!gameNick || !players || !Array.isArray(players) || players.length === 0) {
    return null;
  }
  
  threshold = threshold ?? 65;
  const cleanedNick = cleanGameNick(gameNick);
  
  let bestMatch = null;
  let bestSimilarity = 0;
  let matchedOn = null;
  
  for (const player of players) {
    if (!player || !player.name) continue;
    
    // Check against player name
    const nameSimilarity = levenshteinSimilarity(cleanedNick, player.name);
    if (nameSimilarity > bestSimilarity) {
      bestSimilarity = nameSimilarity;
      bestMatch = player.name;
      matchedOn = player.name;
    }
    
    // Check against each registered game nick
    if (player.nicks && Array.isArray(player.nicks)) {
      for (const nick of player.nicks) {
        if (!nick) continue;
        const nickSimilarity = levenshteinSimilarity(cleanedNick, nick);
        if (nickSimilarity > bestSimilarity) {
          bestSimilarity = nickSimilarity;
          bestMatch = player.name;
          matchedOn = nick;
        }
      }
    }
  }
  
  if (bestSimilarity >= threshold) {
    return {
      player: bestMatch,
      matchedOn: matchedOn,
      similarity: Math.round(bestSimilarity * 100) / 100
    };
  }
  
  return null;
}

/**
 * Builds a player list from spreadsheet data for use with fuzzyMatchPlayer.
 * Expects data from Players sheet with columns: [Team, GameNicks, Player, ...]
 * 
 * @param {Array[]} playersData - 2D array from Players sheet (including header row)
 * @returns {Array} - Array of { name, nicks } objects
 */
function buildPlayerList(playersData) {
  if (!playersData || playersData.length < 2) return [];
  
  return playersData.slice(1).map(row => ({
    name: String(row[2] || "").trim(),
    nicks: String(row[1] || "").split(",").map(n => n.trim()).filter(Boolean)
  })).filter(p => p.name);
}

/**
 * Attempts to fix a missing player nick by fuzzy matching it to an existing player.
 * If a match is found (>= threshold), adds the nick to that player's Game Nicks.
 * 
 * @param {string} gameNick - The unmatched game nick to fix
 * @param {number} threshold - Minimum similarity percentage (0-100), default 65
 * @returns {Object} - Result: { success, player?, addedNick?, similarity?, message }
 */
function fixMissingPlayerNick(gameNick, threshold) {
  if (!gameNick) {
    return { success: false, message: "No game nick provided" };
  }
  
  threshold = threshold ?? 65;
  const cleanedNick = cleanGameNick(gameNick);
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const playersSheet = ss.getSheetByName("Players");
  
  if (!playersSheet) {
    return { success: false, message: "Players sheet not found" };
  }
  
  const playersData = playersSheet.getDataRange().getValues();
  const players = buildPlayerList(playersData);
  
  // Check if nick already exists (exact match)
  for (const player of players) {
    const nicksLower = player.nicks.map(n => n.toLowerCase());
    if (nicksLower.includes(cleanedNick.toLowerCase())) {
      return { 
        success: false, 
        message: `Nick "${cleanedNick}" already assigned to ${player.name}` 
      };
    }
  }
  
  // Try fuzzy match
  const match = fuzzyMatchPlayer(cleanedNick, players, threshold);
  
  if (!match) {
    return { 
      success: false, 
      message: `No match found for "${cleanedNick}" at ${threshold}% threshold` 
    };
  }
  
  // Find the row for this player and update their Game Nicks
  for (let i = 1; i < playersData.length; i++) {
    const playerName = String(playersData[i][2] || "").trim();
    
    if (playerName === match.player) {
      const rowIndex = i + 1; // 1-based row index
      const currentNicks = playersSheet.getRange(rowIndex, 2).getValue();
      
      let newNicks = cleanedNick;
      if (currentNicks) {
        newNicks = currentNicks + "," + cleanedNick;
      }
      
      playersSheet.getRange(rowIndex, 2).setValue(newNicks);
      
      return {
        success: true,
        player: match.player,
        addedNick: cleanedNick,
        matchedOn: match.matchedOn,
        similarity: match.similarity,
        message: `Added "${cleanedNick}" to ${match.player}'s Game Nicks (matched "${match.matchedOn}" at ${match.similarity}%)`
      };
    }
  }
  
  return { success: false, message: `Could not find row for player "${match.player}"` };
}

/**
 * Attempts to fix multiple missing player nicks in batch.
 * 
 * @param {string[]} gameNicks - Array of unmatched game nicks to fix
 * @param {number} threshold - Minimum similarity percentage (0-100), default 65
 * @returns {Object} - Result: { fixed: [], failed: [], summary }
 */
function fixMissingPlayerNicksBatch(gameNicks, threshold) {
  if (!gameNicks || !Array.isArray(gameNicks) || gameNicks.length === 0) {
    return { fixed: [], failed: [], summary: "No game nicks provided" };
  }
  
  threshold = threshold ?? 65;
  const fixed = [];
  const failed = [];
  
  for (const nick of gameNicks) {
    const result = fixMissingPlayerNick(nick, threshold);
    
    if (result.success) {
      fixed.push(result);
    } else {
      failed.push({ nick, reason: result.message });
    }
  }
  
  return {
    fixed,
    failed,
    summary: `Fixed ${fixed.length}/${gameNicks.length} nicks`
  };
}

// ============================================================================
// TEAM TAG FUZZY MATCHING
// ============================================================================

/**
 * Builds a team list from spreadsheet data for use with fuzzyMatchTeam.
 * Expects data from Teams sheet with columns: [Team Tag, Team Name, ...]
 * 
 * @param {Array[]} teamsData - 2D array from Teams sheet (including header row)
 * @returns {Array} - Array of { name, tags } objects
 */
function buildTeamList(teamsData) {
  if (!teamsData || teamsData.length < 2) return [];
  
  return teamsData.slice(1).map(row => ({
    name: String(row[1] || "").trim(),
    tags: String(row[0] || "").split("‡").map(t => t.trim()).filter(Boolean)
  })).filter(t => t.name);
}

/**
 * Fuzzy matches a team tag against a list of teams.
 * Searches both team names and their registered tags.
 * 
 * @param {string} teamTag - The team tag to match
 * @param {Array} teams - Array of team objects: { name: string, tags: string[] }
 * @param {number} threshold - Minimum similarity percentage (0-100), default 65
 * @returns {Object|null} - Best match { team: string, matchedOn: string, similarity: number } or null
 */
function fuzzyMatchTeam(teamTag, teams, threshold) {
  if (!teamTag || !teams || !Array.isArray(teams) || teams.length === 0) {
    return null;
  }
  
  threshold = threshold ?? 65;
  const cleanedTag = String(teamTag).trim();
  
  let bestMatch = null;
  let bestSimilarity = 0;
  let matchedOn = null;
  
  for (const team of teams) {
    if (!team || !team.name) continue;
    
    // Check against team name
    const nameSimilarity = levenshteinSimilarity(cleanedTag, team.name);
    if (nameSimilarity > bestSimilarity) {
      bestSimilarity = nameSimilarity;
      bestMatch = team.name;
      matchedOn = team.name;
    }
    
    // Check against each registered tag
    if (team.tags && Array.isArray(team.tags)) {
      for (const tag of team.tags) {
        if (!tag) continue;
        const tagSimilarity = levenshteinSimilarity(cleanedTag, tag);
        if (tagSimilarity > bestSimilarity) {
          bestSimilarity = tagSimilarity;
          bestMatch = team.name;
          matchedOn = tag;
        }
      }
    }
  }
  
  if (bestSimilarity >= threshold) {
    return {
      team: bestMatch,
      matchedOn: matchedOn,
      similarity: Math.round(bestSimilarity * 100) / 100
    };
  }
  
  return null;
}

/**
 * Attempts to fix a missing team tag by fuzzy matching it to an existing team.
 * If a match is found (>= threshold), adds the tag to that team's Team Tag column.
 * Team tags are separated by ‡ (dagger symbol).
 * 
 * @param {string} teamTag - The unmatched team tag to fix
 * @param {number} threshold - Minimum similarity percentage (0-100), default 65
 * @returns {Object} - Result: { success, team?, addedTag?, similarity?, message }
 */
function fixMissingTeamTag(teamTag, threshold) {
  if (!teamTag) {
    return { success: false, message: "No team tag provided" };
  }
  
  threshold = threshold ?? 65;
  const cleanedTag = String(teamTag).trim();
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const teamsSheet = ss.getSheetByName("Teams");
  
  if (!teamsSheet) {
    return { success: false, message: "Teams sheet not found" };
  }
  
  const teamsData = teamsSheet.getDataRange().getValues();
  const teams = buildTeamList(teamsData);
  
  // Check if tag already exists (exact match, case-insensitive)
  for (const team of teams) {
    const tagsLower = team.tags.map(t => t.toLowerCase());
    if (tagsLower.includes(cleanedTag.toLowerCase())) {
      return { 
        success: false, 
        message: `Tag "${cleanedTag}" already assigned to ${team.name}` 
      };
    }
  }
  
  // Try fuzzy match
  const match = fuzzyMatchTeam(cleanedTag, teams, threshold);
  
  if (!match) {
    return { 
      success: false, 
      message: `No match found for "${cleanedTag}" at ${threshold}% threshold` 
    };
  }
  
  // Find the row for this team and update their Team Tag
  for (let i = 1; i < teamsData.length; i++) {
    const teamName = String(teamsData[i][1] || "").trim();
    
    if (teamName === match.team) {
      const rowIndex = i + 1; // 1-based row index
      const currentTags = teamsSheet.getRange(rowIndex, 1).getValue();
      
      let newTags = cleanedTag;
      if (currentTags) {
        newTags = currentTags + "‡" + cleanedTag;
      }
      
      teamsSheet.getRange(rowIndex, 1).setValue(newTags);
      
      return {
        success: true,
        team: match.team,
        addedTag: cleanedTag,
        matchedOn: match.matchedOn,
        similarity: match.similarity,
        message: `Added "${cleanedTag}" to ${match.team}'s Team Tags (matched "${match.matchedOn}" at ${match.similarity}%)`
      };
    }
  }
  
  return { success: false, message: `Could not find row for team "${match.team}"` };
}

/**
 * Attempts to fix multiple missing team tags in batch.
 * 
 * @param {string[]} teamTags - Array of unmatched team tags to fix
 * @param {number} threshold - Minimum similarity percentage (0-100), default 65
 * @returns {Object} - Result: { fixed: [], failed: [], summary }
 */
function fixMissingTeamTagsBatch(teamTags, threshold) {
  if (!teamTags || !Array.isArray(teamTags) || teamTags.length === 0) {
    return { fixed: [], failed: [], summary: "No team tags provided" };
  }
  
  threshold = threshold ?? 65;
  const fixed = [];
  const failed = [];
  
  for (const tag of teamTags) {
    const result = fixMissingTeamTag(tag, threshold);
    
    if (result.success) {
      fixed.push(result);
    } else {
      failed.push({ tag, reason: result.message });
    }
  }
  
  return {
    fixed,
    failed,
    summary: `Fixed ${fixed.length}/${teamTags.length} tags`
  };
}

// ============================================================================
// CONFIGURATION HELPERS
// ============================================================================

/**
 * Set a value in the Configuration tab, with optional dropdown validation.
 * Creates the key if it doesn't exist, updates if it does.
 * 
 * @param {string} key - The configuration key name
 * @param {string} value - The value to set
 * @param {string[]} [dropdownOptions] - Optional array of values for dropdown validation
 * @returns {Object} - { updated: boolean, created: boolean }
 */
function setConfigurationValue(key, value, dropdownOptions) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName("Configuration");
  
  if (!configSheet) {
    throw new Error("Configuration sheet not found");
  }
  
  const data = configSheet.getDataRange().getValues();
  let rowIndex = -1;
  
  // Find existing key
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) {
      rowIndex = i + 1; // 1-based
      break;
    }
  }
  
  let created = false;
  let targetRow;
  
  if (rowIndex === -1) {
    // Create new row
    targetRow = configSheet.getLastRow() + 1;
    configSheet.getRange(targetRow, 1).setValue(key);
    configSheet.getRange(targetRow, 2).setValue(value);
    created = true;
  } else {
    // Update existing row
    targetRow = rowIndex;
    configSheet.getRange(targetRow, 2).setValue(value);
  }
  
  // Add dropdown validation if specified
  if (dropdownOptions && dropdownOptions.length > 0) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(dropdownOptions, true)
      .setAllowInvalid(false)
      .build();
    configSheet.getRange(targetRow, 2).setDataValidation(rule);
  }
  
  return { updated: !created, created: created };
}

// ============================================================================
// MIGRATIONS
// ============================================================================

/**
 * Runs all pending migrations to update sheet structure.
 * Safe to run multiple times - each migration checks if it's already been applied.
 * 
 * @returns {Object} - Result: { migrations: [], summary }
 */
function runMigration() {
  const results = [];
  
  // Migration 1: Move 'Web App deployment URL' from Discord to Configuration
  results.push(migrateDiscordWebAppUrl());
  
  // Migration 2: Move 'Discord web hook' from Discord to Configuration
  results.push(migrateDiscordWebhook());
  
  // Migration 3: Remove 'Round' from Discord tab (now handled by sidebar)
  results.push(migrateDiscordRound());
  
  // Migration 4: Add 'Schedule Info Sent' column to ScheduleConfig
  results.push(migrateScheduleInfoSent());
  
  // Migration 5: Remove 'Notes' column from Discord tab
  results.push(migrateDiscordNotesColumn());
  
  // Migration 6: Add Group Stage Mode and Playoffs Mode to Configuration
  results.push(migrateGroupStageAndPlayoffsMode());
  
  const applied = results.filter(r => r.applied).length;
  const skipped = results.filter(r => !r.applied).length;
  
  return {
    migrations: results,
    summary: `Migrations complete: ${applied} applied, ${skipped} skipped`
  };
}

/**
 * Migration 1: Move 'Web App deployment URL' from Discord tab to Configuration tab as 'Discord Web App URL'
 */
function migrateDiscordWebAppUrl() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const discordSheet = ss.getSheetByName("Discord");
  const configSheet = ss.getSheetByName("Configuration");
  
  if (!discordSheet || !configSheet) {
    return { 
      name: "migrateDiscordWebAppUrl", 
      applied: false, 
      message: "Discord or Configuration sheet not found" 
    };
  }
  
  // Find the key in Discord sheet
  const discordData = discordSheet.getDataRange().getValues();
  let discordRowIndex = -1;
  let value = null;
  
  for (let i = 1; i < discordData.length; i++) {
    if (String(discordData[i][0]).trim() === "Web App deployment URL") {
      discordRowIndex = i + 1; // 1-based row index
      value = discordData[i][1];
      break;
    }
  }
  
  if (discordRowIndex === -1) {
    return { 
      name: "migrateDiscordWebAppUrl", 
      applied: false, 
      message: "Key 'Web App deployment URL' not found in Discord tab (already migrated or never existed)" 
    };
  }
  
  // Check if it already exists in Configuration
  const configData = configSheet.getDataRange().getValues();
  let configRowIndex = -1;
  
  for (let i = 1; i < configData.length; i++) {
    if (String(configData[i][0]).trim() === "Discord Web App URL") {
      configRowIndex = i + 1;
      break;
    }
  }
  
  // Add to Configuration if it doesn't exist
  if (configRowIndex === -1) {
    const newRow = configSheet.getLastRow() + 1;
    configSheet.getRange(newRow, 1).setValue("Discord Web App URL");
    configSheet.getRange(newRow, 2).setValue(value);
  } else {
    // Update existing value
    configSheet.getRange(configRowIndex, 2).setValue(value);
  }
  
  // Remove from Discord sheet
  discordSheet.deleteRow(discordRowIndex);
  
  return { 
    name: "migrateDiscordWebAppUrl", 
    applied: true, 
    message: `Moved 'Web App deployment URL' to Configuration as 'Discord Web App URL'` 
  };
}

/**
 * Migration 2: Move 'Discord web hook' from Discord tab to Configuration tab as 'Discord Schedule Channel Webhook'
 */
function migrateDiscordWebhook() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const discordSheet = ss.getSheetByName("Discord");
  const configSheet = ss.getSheetByName("Configuration");
  
  if (!discordSheet || !configSheet) {
    return { 
      name: "migrateDiscordWebhook", 
      applied: false, 
      message: "Discord or Configuration sheet not found" 
    };
  }
  
  // Find the key in Discord sheet
  const discordData = discordSheet.getDataRange().getValues();
  let discordRowIndex = -1;
  let value = null;
  
  for (let i = 1; i < discordData.length; i++) {
    if (String(discordData[i][0]).trim() === "Discord web hook") {
      discordRowIndex = i + 1; // 1-based row index
      value = discordData[i][1];
      break;
    }
  }
  
  if (discordRowIndex === -1) {
    return { 
      name: "migrateDiscordWebhook", 
      applied: false, 
      message: "Key 'Discord web hook' not found in Discord tab (already migrated or never existed)" 
    };
  }
  
  // Check if it already exists in Configuration
  const configData = configSheet.getDataRange().getValues();
  let configRowIndex = -1;
  
  for (let i = 1; i < configData.length; i++) {
    if (String(configData[i][0]).trim() === "Discord Schedule Channel Webhook") {
      configRowIndex = i + 1;
      break;
    }
  }
  
  // Add to Configuration if it doesn't exist
  if (configRowIndex === -1) {
    const newRow = configSheet.getLastRow() + 1;
    configSheet.getRange(newRow, 1).setValue("Discord Schedule Channel Webhook");
    configSheet.getRange(newRow, 2).setValue(value);
  } else {
    // Update existing value
    configSheet.getRange(configRowIndex, 2).setValue(value);
  }
  
  // Remove from Discord sheet
  discordSheet.deleteRow(discordRowIndex);
  
  return { 
    name: "migrateDiscordWebhook", 
    applied: true, 
    message: `Moved 'Discord web hook' to Configuration as 'Discord Schedule Channel Webhook'` 
  };
}

/**
 * Migration 3: Remove 'Round' from Discord tab (now handled by sidebar dropdown)
 */
function migrateDiscordRound() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const discordSheet = ss.getSheetByName("Discord");
  
  if (!discordSheet) {
    return { 
      name: "migrateDiscordRound", 
      applied: false, 
      message: "Discord sheet not found" 
    };
  }
  
  // Find the 'Round' key in Discord sheet
  const discordData = discordSheet.getDataRange().getValues();
  let discordRowIndex = -1;
  
  for (let i = 1; i < discordData.length; i++) {
    if (String(discordData[i][0]).trim() === "Round") {
      discordRowIndex = i + 1; // 1-based row index
      break;
    }
  }
  
  if (discordRowIndex === -1) {
    return { 
      name: "migrateDiscordRound", 
      applied: false, 
      message: "Key 'Round' not found in Discord tab (already migrated or never existed)" 
    };
  }
  
  // Remove from Discord sheet
  discordSheet.deleteRow(discordRowIndex);
  
  return { 
    name: "migrateDiscordRound", 
    applied: true, 
    message: "Removed 'Round' from Discord tab (now controlled via sidebar)" 
  };
}

/**
 * Migration 4: Add 'Schedule Info Sent' column to ScheduleConfig tab
 * Creates a dropdown with 'No'/'Yes' values for each row with a Round value
 */
function migrateScheduleInfoSent() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const scheduleConfigSheet = ss.getSheetByName("ScheduleConfig");
  
  if (!scheduleConfigSheet) {
    return { 
      name: "migrateScheduleInfoSent", 
      applied: false, 
      message: "ScheduleConfig sheet not found" 
    };
  }
  
  const data = scheduleConfigSheet.getDataRange().getValues();
  if (data.length < 1) {
    return { 
      name: "migrateScheduleInfoSent", 
      applied: false, 
      message: "ScheduleConfig sheet is empty" 
    };
  }
  
  const headers = data[0];
  const existingColIndex = headers.indexOf("Schedule Info Sent");
  
  // If column already exists, skip
  if (existingColIndex !== -1) {
    return { 
      name: "migrateScheduleInfoSent", 
      applied: false, 
      message: "'Schedule Info Sent' column already exists" 
    };
  }
  
  // Find the Round column to check which rows have data
  const roundColIndex = headers.indexOf("Round");
  if (roundColIndex === -1) {
    return { 
      name: "migrateScheduleInfoSent", 
      applied: false, 
      message: "'Round' column not found in ScheduleConfig" 
    };
  }
  
  // Add the new header
  const newColIndex = headers.length + 1; // 1-based column index
  scheduleConfigSheet.getRange(1, newColIndex).setValue("Schedule Info Sent");
  
  // Find rows with Round values and set default to 'No'
  const lastRow = scheduleConfigSheet.getLastRow();
  
  for (let i = 2; i <= lastRow; i++) {
    const roundValue = data[i - 1][roundColIndex]; // data is 0-based
    if (roundValue !== "" && roundValue != null) {
      const cell = scheduleConfigSheet.getRange(i, newColIndex);
      cell.setValue("No");
      
      // Create dropdown validation
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(["No", "Yes"], true)
        .setAllowInvalid(false)
        .build();
      cell.setDataValidation(rule);
    }
  }
  
  return { 
    name: "migrateScheduleInfoSent", 
    applied: true, 
    message: `Added 'Schedule Info Sent' column with dropdown to ScheduleConfig` 
  };
}

/**
 * Migration 5: Remove 'Notes' column (column C) from Discord tab
 */
function migrateDiscordNotesColumn() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const discordSheet = ss.getSheetByName("Discord");
  
  if (!discordSheet) {
    return { 
      name: "migrateDiscordNotesColumn", 
      applied: false, 
      message: "Discord sheet not found" 
    };
  }
  
  // Check if there are at least 3 columns
  const lastCol = discordSheet.getLastColumn();
  if (lastCol < 3) {
    return { 
      name: "migrateDiscordNotesColumn", 
      applied: false, 
      message: "Discord sheet has fewer than 3 columns (Notes column already removed or never existed)" 
    };
  }
  
  // Check if column 3 header is "Notes"
  const header = discordSheet.getRange(1, 3).getValue();
  if (String(header).trim() !== "Notes") {
    return { 
      name: "migrateDiscordNotesColumn", 
      applied: false, 
      message: `Column C header is '${header}', not 'Notes' (already migrated or different structure)` 
    };
  }
  
  // Delete the entire column C
  discordSheet.deleteColumn(3);
  
  return { 
    name: "migrateDiscordNotesColumn", 
    applied: true, 
    message: "Removed 'Notes' column from Discord tab" 
  };
}

/**
 * Migration 6: Add 'Group Stage Mode' and 'Playoffs Mode' to Configuration tab
 * Only applies if Schedule sheet has data (more than just the header row)
 */
function migrateGroupStageAndPlayoffsMode() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const scheduleSheet = ss.getSheetByName("Schedule");
  const configSheet = ss.getSheetByName("Configuration");
  
  if (!scheduleSheet || !configSheet) {
    return { 
      name: "migrateGroupStageAndPlayoffsMode", 
      applied: false, 
      message: "Schedule or Configuration sheet not found" 
    };
  }
  
  // Only apply if Schedule has data (more than header row)
  const scheduleLastRow = scheduleSheet.getLastRow();
  if (scheduleLastRow <= 1) {
    return { 
      name: "migrateGroupStageAndPlayoffsMode", 
      applied: false, 
      message: "Schedule sheet is empty (only header row) - skipping" 
    };
  }
  
  // Check if both keys already exist
  const configData = configSheet.getDataRange().getValues();
  let hasGroupStageMode = false;
  let hasPlayoffsMode = false;
  
  for (let i = 1; i < configData.length; i++) {
    const key = String(configData[i][0]).trim();
    if (key === "Group Stage Mode") hasGroupStageMode = true;
    if (key === "Playoffs Mode") hasPlayoffsMode = true;
  }
  
  if (hasGroupStageMode && hasPlayoffsMode) {
    return { 
      name: "migrateGroupStageAndPlayoffsMode", 
      applied: false, 
      message: "Both 'Group Stage Mode' and 'Playoffs Mode' already exist in Configuration" 
    };
  }
  
  const changes = [];
  
  // Add Group Stage Mode if missing
  if (!hasGroupStageMode) {
    setConfigurationValue("Group Stage Mode", "GO3", ["GO3", "BO5"]);
    changes.push("Group Stage Mode (GO3)");
  }
  
  // Add Playoffs Mode if missing
  if (!hasPlayoffsMode) {
    setConfigurationValue("Playoffs Mode", "BO5", ["BO5", "BO7"]);
    changes.push("Playoffs Mode (BO5)");
  }
  
  return { 
    name: "migrateGroupStageAndPlayoffsMode", 
    applied: true, 
    message: `Added to Configuration: ${changes.join(", ")}` 
  };
}

function normalizeForComparison(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, "");
}