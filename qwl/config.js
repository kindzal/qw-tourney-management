/**
 * Central configuration for QuakeWorld 4on4 Tournament SPA
 */

// -------------------------------------------------------
// Read OtherConfig (key -> value)
// -------------------------------------------------------
const ss = SpreadsheetApp.getActiveSpreadsheet();
const otherConfigSheet = ss.getSheetByName("OtherConfig");

const lastRow = otherConfigSheet.getLastRow();
const configData = otherConfigSheet.getRange(2, 1, lastRow - 1, 2).getValues();
const config = {};
configData.forEach(([key, value]) => {
  if (key) config[String(key).trim()] = value;
});

const CONFIG = {
  appTitle: config["WebApp title"],
  defaultPage: config["WebApp default page"],
  rankTooltipText: config["WebApp rank tooltip text"],
  logoUrl: config["WebApp logo url"],
  wikiUrl: config["WebApp wiki url"],
  apiEndpoints: {
    standings: "standings",
    teams: "teams",
    players: "players",
    games: "games"
  },
  
};
