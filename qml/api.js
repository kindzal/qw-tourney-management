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

  return values.map(r => Object.fromEntries(headers.map((h,i) => [h, r[i]])));
}

function getTeamGames() {
  const sheet = SpreadsheetApp.getActive().getSheetByName("TeamGames");
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();

  return values.map(r => Object.fromEntries(headers.map((h,i) => [h, r[i]])));
}

function getTeams() {
  const sheet = SpreadsheetApp.getActive().getSheetByName("Teams");
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();

  return values.map(r => Object.fromEntries(headers.map((h,i) => [h, r[i]])));
}
