// ─────────────────────────────────────────────
// Getters: functions to load config, fetch games, and check filters
// ─────────────────────────────────────────────

/**
 * Reads all required autoImport keys from OtherConfig.
 * Returns a config object or null if required keys are missing.
 */
function loadAutoImportConfig() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("OtherConfig");

  if (!sheet) {
    Logger.log("autoImport: OtherConfig sheet not found");
    return null;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log("autoImport: OtherConfig sheet is empty");
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
      "autoImport: missing required OtherConfig keys. " +
      "Need: 'Tournament mode', 'Automagic import game tag', " +
      "'Tournament start', 'Tournament end'"
    );
    return null;
  }

  const tournamentStart = startVal instanceof Date ? startVal : new Date(startVal);
  const tournamentEnd   = endVal   instanceof Date ? endVal   : new Date(endVal);

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
 * Loads scheduled team pairs from the Schedule sheet.
 * Returns an array of [teamNameA_lower, teamNameB_lower] pairs.
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
    const tag = row[tagCol];
    const name = row[nameCol];

    if (tag && name) {
      nameToTag[String(name).trim().toLowerCase()] = String(tag).trim();
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
    .map(([a, b]) => {
      const tagA = nameToTag[String(a).trim().toLowerCase()];
      const tagB = nameToTag[String(b).trim().toLowerCase()];

      if (!tagA || !tagB) {
        // Optional: log for debugging
        Logger.log(`Schedule mapping failed for: ${a} vs ${b}`);
        return null;
      }

      return [tagA, tagB];
    })
    .filter(pair => pair !== null);
}
