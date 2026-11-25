// ─────────────────────────────────────────────
// Getters: functions to load config, fetch games, and check filters
// ─────────────────────────────────────────────

/**
 * Splits a "Team Tag Display" cell value on the ‡ delimiter.
 * Returns an array of trimmed, non-empty tag strings.
 * The first element is treated as the canonical tag.
 * e.g. "TAG1‡TAG2" → ["TAG1", "TAG2"]
 */
function parseTagAliases(rawTag) {
  return String(rawTag)
    .split("‡")
    .map(t => t.trim())
    .filter(Boolean);
}

/**
 * Reads all required autoImport keys from Configuration.
 * Returns a config object or null if required keys are missing.
 */
function loadAutoImportConfig() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Configuration");

  if (!sheet) {
    Logger.log("autoImport: Configuration sheet not found");
    return null;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log("autoImport: Configuration sheet is empty");
    return null;
  }

  const raw = {};
  sheet.getRange(2, 1, lastRow - 1, 2).getValues().forEach(([k, v]) => {
    if (k) raw[String(k).trim()] = v;
  });

  const mode     = raw["Tournament mode"];
  const ilike    = raw["Automagic import game tag"];
  const startVal = raw["Tournament start"];
  const endVal   = raw["Tournament end"];

  if (!mode || !ilike || !startVal || !endVal) {
    Logger.log(
      "autoImport: missing required Configuration keys. " +
      "Need: 'Tournament mode', 'Automagic import game tag', " +
      "'Tournament start', 'Tournament end'"
    );
    return null;
  }

  let [dd,mm,yyyy] = String(startVal).split("/");    
  const tournamentStart = new Date(Number(yyyy), Number(mm)-1, Number(dd));
  
  [dd,mm,yyyy] = String(endVal).split("/");
  const tournamentEnd = new Date(Number(yyyy), Number(mm)-1, Number(dd));
  
  // Excluded keywords: comma-separated string → trimmed array (may be empty)
  const excludedRaw     = raw["Automagic excluded keywords"] || "";
  const excludedKeywords = String(excludedRaw)
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  return { mode, ilike, tournamentStart, tournamentEnd, excludedKeywords };
}

/**
 * Loads all URLs from the ImportedURLs sheet into a Set.
 */
function loadImportedUrls() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("ImportedURLs");
  if (!sheet || sheet.getLastRow() === 0) return new Set();

  return new Set(
    sheet.getRange(1, 1, sheet.getLastRow(), 1)
      .getValues()
      .flat()
      .filter(String)
  );
}

/**
 * Builds a map of every tag alias → canonical (first) tag from the Teams sheet.
 * Used to normalise game team tags returned by the API before schedule matching.
 * e.g. if "Team Tag Display" is "TAG1‡TAG2", both "TAG1" and "TAG2" map to "TAG1".
 */
function loadTagAliasMap() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Teams");
  if (!sheet || sheet.getLastRow() < 2) return {};

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const tagCol = headers.indexOf("Team Tag Display");
  if (tagCol === -1) return {};

  const aliasMap = {};
  data.slice(1).forEach(row => {
    const aliases = parseTagAliases(row[tagCol]);
    if (aliases.length === 0) return;
    const canonical = aliases[0];
    aliases.forEach(alias => { aliasMap[alias] = canonical; });
  });

  return aliasMap;
}

/**
 * Loads scheduled team pairs from the Schedule sheet.
 * Returns an array of [canonicalTagA, canonicalTagB] pairs.
 *
 * Schedule columns: Round (A), Team1 (B), Team2 (C)
 */
function loadScheduledTeamPairs() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const scheduleSheet = ss.getSheetByName("Schedule");
  const teamsSheet = ss.getSheetByName("Teams");

  if (!scheduleSheet || scheduleSheet.getLastRow() < 2) return [];
  if (!teamsSheet || teamsSheet.getLastRow() < 2) return [];

  // -------------------------------------------------------
  // Build Team Name -> Team Tag lookup
  // -------------------------------------------------------
  const teamsData = teamsSheet.getDataRange().getValues();
  const teamHeaders = teamsData[0];

  const tagCol = teamHeaders.indexOf("Team Tag");
  const nameCol = teamHeaders.indexOf("Team Name");

  if (tagCol === -1 || nameCol === -1) {
    throw new Error("Teams sheet must contain 'Team Tag' and 'Team Name' columns");
  }

  const nameToTag = {};

  teamsData.slice(1).forEach(row => {
    const rawTag = GASdecode(row[tagCol]);
    const name = row[nameCol];

    if (rawTag && name) {
      const aliases = parseTagAliases(rawTag);
      if (aliases.length) {
        nameToTag[String(name).trim().toLowerCase()] = aliases;
      }
    }
  });

  // -------------------------------------------------------
  // Read Schedule team name pairs (columns B & C)
  // -------------------------------------------------------
  const schedulePairs = scheduleSheet
    .getRange(2, 2, scheduleSheet.getLastRow() - 1, 2)
    .getValues()
    .filter(([a, b]) => a && b);

  // -------------------------------------------------------
  // Convert to Team Tag pairs
  // -------------------------------------------------------
  return schedulePairs
    .flatMap(([a, b]) => {
      const tagsA = nameToTag[String(a).trim().toLowerCase()];
      const tagsB = nameToTag[String(b).trim().toLowerCase()];

      if (!tagsA || !tagsB) {
        Logger.log(`Schedule mapping failed for: ${a} vs ${b}`);
        return [];
      }

      // Produce a pair for every combination of alias from A and alias from B
      return tagsA.flatMap(tagA => tagsB.map(tagB => [tagA, tagB]));
    });
}

function getConfiguration() {
  const sheet = SpreadsheetApp.getActive().getSheetByName("Configuration");
  const data = sheet.getDataRange().getValues();

  const config = {};
  for (let i = 1; i < data.length; i++) {
    config[data[i][0]] = data[i][1];
  }

  return config;
}
function getTeams() {
  const sheet = SpreadsheetApp.getActive().getSheetByName("Teams");
  const data = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
  return data.flat().filter(name => name);
}

function findTeamByRoleName(roleName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Teams");
  if (!sheet) throw new Error("Teams sheet not found");

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const nameCol = headers.indexOf("Team Name");
  const roleCol = headers.indexOf("Discord Role ID");

  if (nameCol === -1 || roleCol === -1) {
    throw new Error("Teams sheet missing required columns");
  }

  const normalizedRoleName = normalizeForComparison(roleName);

  for (let i = 1; i < data.length; i++) {
    const teamName = data[i][nameCol];
    if (normalizeForComparison(teamName) === normalizedRoleName) {
      return { rowIndex: i + 1, roleCol: roleCol + 1, teamName: teamName, roleId: data[i][roleCol] };
    }
  }

  return null;
}