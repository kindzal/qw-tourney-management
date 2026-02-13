/** @OnlyCurrentDoc */
function doPost(e) {
  const action = e.parameter?.action || "reports";

  switch (action) {
    case "reports":
      return handleReports(e);
    case "schedule":
      return handleSchedule(e);
    default:
      return ContentService.createTextOutput("Unknown action");
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function handleReports(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch {
    return ContentService.createTextOutput("Invalid JSON payload.");
  }

  const urls = Array.isArray(data.urls) ? data.urls : [];
  const REQUIRED_PREFIX = "https://hub.quakeworld.nu/games/?gameId=";

  const filtered = urls
    .filter(u => typeof u === "string" && u.startsWith(REQUIRED_PREFIX))
    .slice(0, 10);

  if (filtered.length === 0) {
    return ContentService.createTextOutput("No valid URLs to process.");
  }

  // Enqueue each URL as a separate MATCH_REPORT message
  let enqueuedCount = 0;
  filtered.forEach((url, index) => {
    const messageId = `match_${Date.now()}_${index}`;
    const timestamp = new Date().toISOString();
    const payload = { url };
    
    const enqueued = enqueueMessageIfNew(
      messageId,
      timestamp,
      "MATCH_REPORT",
      payload
    );
    
    if (enqueued) enqueuedCount++;
  });

  // After all matches are enqueued, enqueue UPDATE_STATS message
  if (enqueuedCount > 0) {
    const updateStatsMessageId = `update_stats_${Date.now()}`;
    const timestamp = new Date().toISOString();
    
    enqueueMessage(
      updateStatsMessageId,
      timestamp,
      "UPDATE_STATS",
      {}
    );
  }

  // Force flush to ensure writes are committed
  SpreadsheetApp.flush();

  return ContentService.createTextOutput(
    `Queued ${enqueuedCount} match reports${enqueuedCount > 0 ? ' + 1 stats update' : ''}`
  );
}

function getTeamByRoleId(roleId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Teams");
  if (!sheet) {
    throw new Error("Teams sheet not found");
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const roleCol = headers.indexOf("Discord Role ID");
  const nameCol = headers.indexOf("Team Name");

  if (roleCol === -1 || nameCol === -1) {
    throw new Error("Teams sheet missing required columns");
  }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][roleCol]) === String(roleId)) {
      return {
        id: roleId,
        name: data[i][nameCol]
      };
    }
  }

  return null;
}

function getRoleIdByTeamName(teamName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Teams");
  if (!sheet) throw new Error("Teams sheet not found");

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const nameCol = headers.indexOf("Team Name");
  const roleCol = headers.indexOf("Discord Role ID");

  if (nameCol === -1 || roleCol === -1) {
    throw new Error("Teams sheet missing required columns");
  }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][nameCol]) === String(teamName)) {
      return data[i][roleCol];
    }
  }

  return null;
}

function handleScheduleGameReport(payload) {
  const { teams, scheduledAt, rawText } = payload;

  if (!teams || teams.length < 2) {
    throw new Error("Invalid team data");
  }

  const teamA = getTeamByRoleId(teams[0].id);
  const teamB = getTeamByRoleId(teams[1].id);

  if (!teamA || !teamB) {
    throw new Error("One or more team role IDs are not registered");
  }

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName("Schedule");

  if (!sheet) {
    throw new Error("Schedule sheet not found");
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const team1Col = headers.indexOf("Team1");
  const team2Col = headers.indexOf("Team2");
  const scheduledCol = headers.indexOf("Scheduled For");

  if (team1Col === -1 || team2Col === -1 || scheduledCol === -1) {
    throw new Error("Schedule sheet missing required columns");
  }

  //const scheduledAt = "12/02/26 @ 21:00" //parseDateTime(content);
  const parsedDateTime = parseDateTime(rawText);
  if (!parsedDateTime) {
    return ContentService.createTextOutput(`No valid date found: ${parsedDateTime}.`);
  }

  for (let i = 1; i < data.length; i++) {
    const rowTeam1 = String(data[i][team1Col]);
    const rowTeam2 = String(data[i][team2Col]);
    const scheduledValue = data[i][scheduledCol];

    const sameMatch =
      (rowTeam1 === teamA.name && rowTeam2 === teamB.name) ||
      (rowTeam1 === teamB.name && rowTeam2 === teamA.name);

    let canUpdate = true;

    if (scheduledValue) {
      const parsed = parseScheduledFor(scheduledValue);
      if (parsed) {
        const now = new Date();
        const scheduledDate = new Date(parsed.year, parsed.month - 1, parsed.day);
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        // Allow update if scheduled date is today or in the future
        canUpdate = scheduledDate >= today;
      }
    }

    if (sameMatch && canUpdate) {
      sheet
        .getRange(i + 1, scheduledCol + 1)
        .setValue(parsedDateTime);

      return;
    }
  }

  throw new Error(
    `No matching schedule row found for teams ${teamA.name} vs ${teamB.name}`
  );
}

function postPreview() {
  postToDiscord('preview');
}

// --- Function to Log Post History ---
function logPostHistory(message, status) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet();
  const historySheet = sheet.getSheetByName('PostHistory');

  if (!historySheet) {
    SpreadsheetApp.getUi().alert('❌ "PostHistory" sheet not found. Please create it first.');
    return;
  }

  const timestamp = new Date();
  const preview = message.length > 1200 ? message.substring(0, 1200) + '...' : message;

  historySheet.appendRow([timestamp, status, preview]);
}

function handleMatchReport(payload) {
  const { url } = payload;
  
  if (!url) {
    throw new Error("Missing URL in MATCH_REPORT payload");
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const gamesSheet = spreadsheet.getSheetByName("Games");
  const importedGamesSheet = spreadsheet.getSheetByName("ImportedURLs");
  
  if (!gamesSheet) {
    throw new Error("Sheet 'Games' not found");
  }
  if (!importedGamesSheet) {
    throw new Error("Sheet 'ImportedURLs' not found");
  }

  // Check if URL was already imported
  const importedUrlsLastRow = importedGamesSheet.getLastRow();
  const importedUrls = new Set(
    importedUrlsLastRow > 0 
      ? importedGamesSheet.getRange(1, 1, importedUrlsLastRow, 1).getValues().flat().filter(String)
      : []
  );

  if (importedUrls.has(url)) {
    Logger.log("URL already imported, skipping: " + url);
    return; // Not an error, just skip
  }

  // Import the single match
  importSingleMatch(url, gamesSheet, importedGamesSheet);
}

function importSingleMatch(url, gamesSheet, importedGamesSheet) {
  const gameIdMatch = url.match(/gameId=(\d+)/);
  if (!gameIdMatch) {
    Logger.log("Invalid URL format: " + url);
    throw new Error("Invalid URL format: " + url);
  }
  const gameId = gameIdMatch[1];
  
  const apiEndpoint = 'https://ncsphkjfominimxztjip.supabase.co/functions/v1/gameinfo';
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ gameId: gameId })
  };
  
  let apiUrl;
  try {
    const response = UrlFetchApp.fetch(apiEndpoint, options);
    const jsonData = JSON.parse(response.getContentText());
    
    if (jsonData.ktxstats_url) {
      apiUrl = jsonData.ktxstats_url;
      Logger.log("Extracted API URL: " + apiUrl);
    } else {
      Logger.log("ktxstats_url not found for gameId: " + gameId);
      throw new Error("ktxstats_url not found for gameId: " + gameId);
    }
  } catch (e) {
    Logger.log("Error fetching data for gameId " + gameId + ": " + e.message);
    throw e;
  }
  
  let jsonData;
  try {
    const response = UrlFetchApp.fetch(apiUrl);
    jsonData = JSON.parse(response.getContentText());
  } catch (e) {
    Logger.log("Error fetching game data from " + apiUrl + ": " + e.message);
    throw e;
  }
  
  const date = jsonData.date;
  const map = jsonData.map;
  const hostname = jsonData.hostname;
  const matchtag = jsonData.matchtag;
  const players = jsonData.players;
  
  const teamScores = {};    
  
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const team = quakeNameToStandard(player.team);
    if (!teamScores[team]) {
      teamScores[team] = 0;
    }
    teamScores[team] += player.stats.frags;      
  }
  
  const teams = Object.keys(teamScores);
  const winningTeam = teamScores[teams[0]] > teamScores[teams[1]] ? teams[0] : teams[1];
  
  const rowData = [];
  
  players.sort((a, b) => b.stats.frags - a.stats.frags); // Sort players by frags (highest first)
  
  players.forEach(function(player) {
    const name = quakeNameToStandard(player.name).replace(/=/g, "");
    const team = quakeNameToStandard(player.team);
    const frags = player.stats.frags;
    const deaths = player.stats.deaths;
    const tk = player.stats.tk;
    const spawnFrags = player.stats["spawn-frags"];
    const kills = player.stats.kills;
    const suicides = player.stats.suicides;
    
    const eff = (kills + deaths) > 0 ? (kills / (kills + deaths) * 100).toFixed(2) + "%" : "0%";
    
    const sgAttacks = player.weapons.sg?.acc?.attacks || 0;
    const sgHits = player.weapons.sg?.acc?.hits || 0;
    const sgAccuracy = sgAttacks > 0 ? (sgHits / sgAttacks * 100).toFixed(2) + "%" : "0%";
    
    const rlAttacks = player.weapons.rl?.acc?.attacks || 0;
    const rlHits = player.weapons.rl?.acc?.hits || 0;
    const rlAccuracy = rlAttacks > 0 ? (rlHits / rlAttacks * 100).toFixed(2) + "%" : "0%";
          
    const lgAttacks = player.weapons.lg?.acc?.attacks || 0;
    const lgHits = player.weapons.lg?.acc?.hits || 0;
    const lgAccuracy = lgAttacks > 0 ? (lgHits / lgAttacks * 100).toFixed(2) + "%" : "0%";
    const lgAttacksFlag = lgAttacks ? 1 : 0;
    
    const rlPickups = player.weapons.rl?.pickups?.taken || 0;
    const rlKills = player.weapons.rl?.kills?.enemy || 0;
    const rlDropped = player.weapons.rl?.pickups?.dropped || 0;
    
    const lgPickups = player.weapons.lg?.pickups?.taken || 0;
    const lgKills = player.weapons.lg?.kills?.enemy || 0;
    const lgDropped = player.weapons.lg?.pickups?.dropped || 0;
    
    const mapWon = team === winningTeam ? 1 : 0;
    
    const ga = player.items?.ga?.took || 0;
    const ya = player.items?.ya?.took || 0;
    const ra = player.items?.ra?.took || 0;
    const p = player.items?.p?.took || 0;
    const q = player.items?.q?.took || 0;      
    const r = player.items?.r?.took || 0;
    const mh = player.items?.health_100?.took || 0;
    
    const ewep = player.dmg?.["enemy-weapons"] || 0;
    const given = player.dmg?.given || 0;
    const self = player.dmg?.self || 0;
    const taken = player.dmg?.taken || 0;
    const toDie = player.dmg?.["taken-to-die"] || 0;
    
    rowData.push([url, date, map, hostname, matchtag, mapWon, frags, team, name, eff, kills, deaths, suicides, tk, given, taken, ewep, toDie, ga, ya, ra, mh, sgAccuracy, lgAttacksFlag, lgAccuracy, rlHits, lgPickups, lgKills, lgDropped, rlPickups, rlKills, rlDropped, q, p, r, self]);
  });
  
  if (rowData.length > 0) {
    const lastRow = Math.max(gamesSheet.getLastRow(), 1) + 1;
    gamesSheet.getRange(lastRow, 1, rowData.length, rowData[0].length).setValues(rowData);
    
    // Add URL to ImportedURLs sheet
    const importedLastRow = Math.max(importedGamesSheet.getLastRow(), 1) + 1;
    importedGamesSheet.getRange(importedLastRow, 1, 1, 1).setValues([[url]]);
    
    Logger.log("Successfully imported: " + url);
  }
}

function updateStats() {
  Logger.log("Running updateStats (UPDATE_STATS handler)");
  updatePlayerAndStandinsStats();
  updateTeamStats();
}

function quakeNameToStandard(name) {
  var bytes = name.split('').map(char => char.charCodeAt(0));
  var convertedName = '';
  
  bytes.forEach(ch => {
    if (ch >= 128) ch -= 128;
    if (ch < 16 || (ch >= 29 && ch <= 31)) {
      convertedName += '_';
    } else if (ch === 16) {
      convertedName += '[';
    } else if (ch === 17) {
      convertedName += ']';
    } else if (ch >= 18 && ch <= 27) {
      convertedName += String.fromCharCode(ch - 18 + 48);
    } else if (ch === 28) {
      convertedName += '•';
    } else {
      convertedName += String.fromCharCode(ch);
    }
  });
  
  return convertedName;
}

function updatePlayerAndStandinsStats() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet();
  updatePlayerStats(sheet.getSheetByName('Players'), sheet.getSheetByName('Games'), sheet.getSheetByName('UnmatchedPlayers'), sheet.getSheetByName('Standins'));
  updatePlayerStats(sheet.getSheetByName('Standins'), sheet.getSheetByName('Games'));
}

function updatePlayerStats(p, g, u, x) {  
  var winRateWeight = 0.05;
  var avgFragsWeight = 0.75;

  var playersSheet = p;  
  var gamesSheet = g;  
  var unmatchedPlayersSheet = u; 
  var standinsSheet = x; 
  
  if (!playersSheet || !gamesSheet) {
    Logger.log("One or more sheets not found!");
    return;
  }

  var playersData = playersSheet.getDataRange().getValues();

  if (standinsSheet) 
    var playersDataEx = playersSheet.getDataRange().getValues().concat(standinsSheet.getDataRange().getValues().slice(1));
  else
    var playersDataEx = playersSheet.getDataRange().getValues();

  var gamesData = gamesSheet.getDataRange().getValues();
      
  var playerStats = {};
  var unmatchedPlayers = [];
  var passNo = 0;
  
  // Initialize player stats for each player
  for (var i = 1; i < playersData.length; i++) {
    var gameNicks = String(playersData[i][1]).split(',');
    var gameNicksLower = gameNicks.map(nick => nick.toLowerCase()); // Convert all game nicks to lowercase      
    var player = playersData[i][2];
    
    playerStats[player] = {
      totalFrags: 0,
      mapsPlayed: 0,
      mapsWon: 0,
      avgFrags: 0,
      winRate: 0,
      avgEff: 0,
      avgSG: 0,
      avgLG: 0,
      avgRLTaken: 0,
      avgRLDropped: 0,
      avgRLKilled: 0,
      avgRLTakenToDropped: 0,
      avgRLTakenToKilled: 0,
      avgTK: 0,
      avgBores: 0,
      avgDmg: 0,
      avgEWEP: 0,
      avgQuads: 0,      
      lgUsed: 0,
      gameNicks: gameNicks.join(',')
    };
    
    // Calculate stats based on games played
    for (var j = 1; j < gamesData.length; j++) {
      var gameNick = String(gamesData[j][8]).toLowerCase(); // Convert to lowercase for case-insensitive comparison
      //var gameNicksLower = gameNicks.map(nick => nick.toLowerCase()); // Convert all game nicks to lowercase      

      if (gameNicksLower.includes(gameNick)) {
        playerStats[player].totalFrags += gamesData[j][6];
        playerStats[player].mapsPlayed++;
        if (gamesData[j][5] == 1) {
          playerStats[player].mapsWon++;
        }
        if (gamesData[j][23] == 1) {
          playerStats[player].avgLG += gamesData[j][24];
          playerStats[player].lgUsed++;
        }
        playerStats[player].avgEff += gamesData[j][9];
        playerStats[player].avgSG += gamesData[j][22];
        playerStats[player].avgRLTaken += gamesData[j][29];
        playerStats[player].avgRLKilled += gamesData[j][30];
        playerStats[player].avgRLDropped += gamesData[j][31];
        playerStats[player].avgTK += gamesData[j][13];
        playerStats[player].avgBores += gamesData[j][12];
        playerStats[player].avgDmg += gamesData[j][14];        
        playerStats[player].avgEWEP += gamesData[j][16];
        playerStats[player].avgQuads += gamesData[j][32];        
        playerStats[player].team = gamesData[j][7];
      }

      // Build a list of unique game nicks
      if (unmatchedPlayersSheet && !passNo && unmatchedPlayers.indexOf(gameNick,1) == -1) {
        unmatchedPlayers.push(gameNick);
      }
    }

    // Don't process game nicks again
    passNo = 1;
    
    // Calculate averages and win rate
    if (playerStats[player].mapsPlayed > 0) {
      playerStats[player].avgFrags = playerStats[player].totalFrags / playerStats[player].mapsPlayed;
      playerStats[player].winRate = (playerStats[player].mapsWon / playerStats[player].mapsPlayed * 100);

      playerStats[player].avgEff = playerStats[player].avgEff / playerStats[player].mapsPlayed * 100;
      playerStats[player].avgSG = playerStats[player].avgSG / playerStats[player].mapsPlayed * 100;
      playerStats[player].avgRLTaken = playerStats[player].avgRLTaken / playerStats[player].mapsPlayed;
      playerStats[player].avgRLKilled = playerStats[player].avgRLKilled / playerStats[player].mapsPlayed;
      playerStats[player].avgRLDropped = playerStats[player].avgRLDropped / playerStats[player].mapsPlayed;
      playerStats[player].avgTK = playerStats[player].avgTK / playerStats[player].mapsPlayed;
      playerStats[player].avgBores = playerStats[player].avgBores / playerStats[player].mapsPlayed;
      playerStats[player].avgDmg = playerStats[player].avgDmg / playerStats[player].mapsPlayed;
      playerStats[player].avgEWEP = playerStats[player].avgEWEP / playerStats[player].mapsPlayed;
      playerStats[player].avgQuads = playerStats[player].avgQuads / playerStats[player].mapsPlayed;      
     
      if (playerStats[player].lgUsed > 0) {
       playerStats[player].avgLG = playerStats[player].avgLG / playerStats[player].lgUsed * 100; 
      }
    }    
    
    // Calculate rank based on weighted averages
    //playerStats[player].rank = ((playerStats[player].winRate * winRateWeight) + (playerStats[player].avgFrags * avgFragsWeight)).toFixed(0);
    //playerStats[player].rank = ((playerStats[player].winRate * winRateWeight) + (playerStats[player].avgFrags)).toFixed(0);
    playerStats[player].rank = ((playerStats[player].winRate * winRateWeight) + (playerStats[player].avgFrags) + (playerStats[player].avgDmg / 1000) + (playerStats[player].avgEWEP / 1000) - playerStats[player].avgTK + playerStats[player].avgRLKilled).toFixed(0);
    //playerStats[player].rank = (100 * ((playerStats[player].avgEff * 0.35) + (playerStats[player].avgFrags) + (playerStats[player].avgDmg / 1000) + (playerStats[player].avgEWEP / 1000) - playerStats[player].avgTK + playerStats[player].avgRLKilled)).toFixed(0);
    
    // Format appropriately
    playerStats[player].avgFrags = playerStats[player].avgFrags.toFixed(0);
    playerStats[player].avgEff = playerStats[player].avgEff.toFixed(0) + "%";
    playerStats[player].avgSG = playerStats[player].avgSG.toFixed(0) + "%";
    playerStats[player].avgLG = playerStats[player].avgLG.toFixed(0) + "%";
    playerStats[player].winRate = playerStats[player].winRate.toFixed(0) + "%";
    playerStats[player].avgRLTaken = playerStats[player].avgRLTaken.toFixed(0);
    playerStats[player].avgRLKilled = playerStats[player].avgRLKilled.toFixed(0);
    playerStats[player].avgRLDropped = playerStats[player].avgRLDropped.toFixed(0);
    playerStats[player].avgTK = playerStats[player].avgTK.toFixed(0);
    playerStats[player].avgBores = playerStats[player].avgBores.toFixed(0);
    playerStats[player].avgDmg = playerStats[player].avgDmg.toFixed(0);
    playerStats[player].avgEWEP = playerStats[player].avgEWEP.toFixed(0);
    playerStats[player].avgQuads = playerStats[player].avgQuads.toFixed(0);   
  }

  // Find any unmatched game nicks
  for (var j = unmatchedPlayers.length - 1; j >= 0; j--) {
    var nick = unmatchedPlayers[j]; // Convert to lowercase for comparison

    for (var i = 0; i < playersDataEx.length; i++) { // Start from 0 for full iteration
      var gameNicks = String(playersDataEx[i][1]).split(',');
      var gameNicksLower = gameNicks.map(n => n.toLowerCase()); // Convert all game nicks to lowercase      

      if (gameNicksLower.includes(nick)) {
        unmatchedPlayers.splice(j, 1); // Remove the matched nick
        break; // Exit inner loop once found
      }
    }
  }
  
  // Sort players by rank
  var sortedPlayers = Object.entries(playerStats).sort((a, b) => b[1].rank - a[1].rank);
  
  // Clear all existing player data (columns B to L) in PlayersNew sheet
  playersSheet.getRange(2, 2, playersData.length - 1, playersData[0].length - 1).clearContent();
  
  // Rewrite the sorted player data starting from row 2
  for (var i = 0; i < sortedPlayers.length; i++) {
    var player = sortedPlayers[i][0];    
    var stats = sortedPlayers[i][1];
    
    // Find the row corresponding to the player name in the PlayersNew sheet
    var rowIndex = i + 2;  // Start from row 2 (because row 1 is the header)
    
    // Set the player data in the sheet
    playersSheet.getRange(rowIndex, 1).setValue(stats.team); // Team
    playersSheet.getRange(rowIndex, 2).setValue(stats.gameNicks); // Game Nicks
    playersSheet.getRange(rowIndex, 3).setValue(player); // Player Name    
    playersSheet.getRange(rowIndex, 4).setValue(stats.totalFrags); // Total Frags
    playersSheet.getRange(rowIndex, 5).setValue(stats.mapsPlayed); // Maps Played
    playersSheet.getRange(rowIndex, 6).setValue(stats.mapsWon); // Maps Won
    playersSheet.getRange(rowIndex, 7).setValue(stats.winRate); // Win Rate
    playersSheet.getRange(rowIndex, 8).setValue(stats.avgFrags); // Avg Frags
    playersSheet.getRange(rowIndex, 9).setValue(stats.rank); // Rank
    playersSheet.getRange(rowIndex, 10).setValue(stats.avgEff); // Avg Eff
    playersSheet.getRange(rowIndex, 11).setValue(stats.avgSG); // Avg SG
    playersSheet.getRange(rowIndex, 12).setValue(stats.avgLG); // Avg LG
    playersSheet.getRange(rowIndex, 13).setValue(stats.avgRLTaken); // Avg RL Taken
    playersSheet.getRange(rowIndex, 14).setValue(stats.avgRLKilled); // Avg RL Killed
    playersSheet.getRange(rowIndex, 15).setValue(stats.avgRLDropped); // Avg RL Dropped
    playersSheet.getRange(rowIndex, 16).setValue(stats.avgTK); // Avg Tks
    playersSheet.getRange(rowIndex, 17).setValue(stats.avgBores); // Avg Bores
    playersSheet.getRange(rowIndex, 18).setValue(stats.avgDmg); // Avg Damage
    playersSheet.getRange(rowIndex, 19).setValue(stats.avgEWEP); // Avg EWEP
    playersSheet.getRange(rowIndex, 20).setValue(stats.avgQuads); // Avg Quads    
  }

  if (unmatchedPlayersSheet) {    
    // clear unmatchedPlayersSheet
    unmatchedPlayersSheet.getRange("A2:A100").clear();
    // Rewrite unmatched players sheet
    for (var i = 0; i < unmatchedPlayers.length; i++) {
      unmatchedPlayersSheet.getRange(i + 2, 1).setValue(unmatchedPlayers[i]);
    }
  }  
}

function populateTeamPlayers() {
  
   // --- Confirm Before Updating ---
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('Are you sure you want to update Players for each team from the Players tab?', ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) {
    ui.alert('Update cancelled.');
    return;
  }

  const ss = SpreadsheetApp.getActive();

  const playersSheet = ss.getSheetByName('Players');
  const teamsSheet = ss.getSheetByName('Teams');

  if (!playersSheet || !teamsSheet) {
    throw new Error('Players or Teams sheet not found');
  }

  // -------------------------------
  // Read Players data (skip header)
  // -------------------------------
  const playersLastRow = playersSheet.getLastRow();
  if (playersLastRow < 2) return;

  const playersData = playersSheet
    .getRange(2, 1, playersLastRow - 1, 3)
    .getValues();

  // Build map: Team -> [Players]
  const playersByTeam = {};
  playersData.forEach(([team, , player]) => {
    if (!team || !player) return;

    const teamKey = String(team).trim();
    if (!playersByTeam[teamKey]) {
      playersByTeam[teamKey] = [];
    }

    playersByTeam[teamKey].push(String(player).trim());
  });

  // -------------------------------
  // Read Teams data (skip header)
  // -------------------------------
  const teamsLastRow = teamsSheet.getLastRow();
  if (teamsLastRow < 2) return;

  const teamsData = teamsSheet
    .getRange(2, 1, teamsLastRow - 1, 3)
    .getValues();

  // Build output for Players column
  const output = teamsData.map(([teamTag]) => {
    if (!teamTag) return [''];

    const teamKey = String(teamTag).trim();
    const players = playersByTeam[teamKey] || [];

    return [players.join(', ')];
  });

  // -------------------------------
  // Write Players column (Column C)
  // -------------------------------
  teamsSheet
    .getRange(2, 3, output.length, 1)
    .clearContent()
    .setValues(output);
}

function updateTeamStats() {

  const MATCH_WINDOW_MINUTES = 240;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const gamesSheet = ss.getSheetByName("Games");
  const teamsSheet = ss.getSheetByName("Teams");
  const scheduleSheet = ss.getSheetByName("Schedule");
  const otherConfigSheet = ss.getSheetByName("OtherConfig");

   const teamGamesHeader = ["#", "Stage", "Round", "TeamA", "MapsWonA", "Score", "TeamB", "MapsWonB", "AllMapsJSON", "Date"];
  // -------------------------------------------------------
  // Check/Create TeamGames sheet
  // -------------------------------------------------------
  let teamGamesSheet = ss.getSheetByName("TeamGames");
  if (!teamGamesSheet) {
    teamGamesSheet = ss.insertSheet("TeamGames");    
    teamGamesSheet.getRange(1, 1, 1, teamGamesHeader.length)
      .setNumberFormat("@STRING@")
      .setValues([teamGamesHeader]);
  }  
  
  // -------------------------------------------------------
  // Check/Create WOTeamGames sheet
  // -------------------------------------------------------
  let woTeamGamesSheet = ss.getSheetByName("WOTeamGames");
  if (!woTeamGamesSheet) {
    woTeamGamesSheet = ss.insertSheet("WOTeamGames");    
    woTeamGamesSheet.getRange(1, 1, 1, teamGamesHeader.length)
      .setNumberFormat("@STRING@")
      .setValues([teamGamesHeader]);
  }

  const standingseader = ["#", "Team", "Games", "Maps", "Diff"];  
  // -------------------------------------------------------
  // Check/Create Standings sheet
  // -------------------------------------------------------
  const standingsSheet = ss.getSheetByName("Standings");  
  if (!standingsSheet) {
    standingsSheet = ss.insertSheet("Standings");    
    standingsSheet.getRange(1, 1, 1, standingseader.length)
      .setNumberFormat("@STRING@")
      .setValues([standingseader]);
  }
  
  // -------------------------------------------------------
  // Check/Create MapStats sheet
  // -------------------------------------------------------
  const mapStatsHeader = [
    "Map Name",
    "Played",
    "Total Frags",
    "Avg Frags",
    "Dominant Team",
    "Highest Frag Game",
    "Most One-Sided Game"
  ];

  let mapStatsSheet = ss.getSheetByName("MapStats");

  if (!mapStatsSheet) {
    mapStatsSheet = ss.insertSheet("MapStats");

    mapStatsSheet
      .getRange(1, 1, 1, mapStatsHeader.length)
      .setNumberFormat("@STRING@")
      .setValues([mapStatsHeader]);

  } else {
    // Ensure headers are correct if sheet already exists
    mapStatsSheet
      .getRange(1, 1, 1, mapStatsHeader.length)
      .setNumberFormat("@STRING@")
      .setValues([mapStatsHeader]);
  }

  // -------------------------------------------------------
  // Playoffs start date
  // -------------------------------------------------------
  const configData = otherConfigSheet.getRange(2,1,otherConfigSheet.getLastRow()-1,2).getValues();
  const config = {};
  configData.forEach(([k,v]) => { if(k) config[String(k).trim()] = v; });

  const rawPlayoffsDate = config["Playoffs start date"];
  if (!rawPlayoffsDate) throw new Error("Missing 'Playoffs start date'");
  
  let playoffsStartDate;

  if (rawPlayoffsDate instanceof Date) {
    playoffsStartDate = rawPlayoffsDate;
  } else {
    const [dd,mm,yyyy] = String(rawPlayoffsDate).split("/");
    playoffsStartDate = new Date(Number(yyyy), Number(mm)-1, Number(dd));
  }

  // -------------------------------------------------------
  // Load Games
  // -------------------------------------------------------
  const gamesData = gamesSheet.getDataRange().getValues();
  const headers = gamesData[0];
  const rows = gamesData.slice(1);

  const urlCol = headers.indexOf("URL");
  const dateCol = headers.indexOf("Date");
  const teamCol = headers.indexOf("Team");
  const mapWonCol = headers.indexOf("Map Won");
  const mapNameCol = headers.indexOf("Map");
  const fragsCol = headers.indexOf("Frags");

  // -------------------------------------------------------
  // Team lookup
  // -------------------------------------------------------
  const teamsData = teamsSheet.getDataRange().getValues().slice(1);
  const teamNameLookup = {};
  teamsData.forEach(([tag,name]) => {
    if(tag) teamNameLookup[tag] = name || tag;
  });

  // -------------------------------------------------------
  // Schedule entries
  // -------------------------------------------------------
  const scheduleData = scheduleSheet.getDataRange().getValues().slice(1);
  const scheduleEntries = [];

  scheduleData.forEach(([round,a,b])=>{
    if(!round||!a||!b) return;
    scheduleEntries.push({
      round,
      teamA:String(a).trim().toLowerCase(),
      teamB:String(b).trim().toLowerCase(),
      matched:false
    });
  });

  // -------------------------------------------------------
  // Group rows by map URL
  // -------------------------------------------------------
  const mapGroups = {};
  rows.forEach(r=>{
    const url = r[urlCol];
    if(!mapGroups[url]) mapGroups[url]=[];
    mapGroups[url].push(r);
  });

  // -------------------------------------------------------
  // Build map objects
  // -------------------------------------------------------
  const maps = [];

  for(const [url, mapRows] of Object.entries(mapGroups)){

    const rawDate = mapRows[0][dateCol];
    let mapDate;

    if(rawDate instanceof Date){
      mapDate = rawDate;
    }else{
      const iso = String(rawDate)
        .replace(" ", "T")
        .replace(/ ([+-]\d{2})(\d{2})$/, "$1:$2");
      mapDate = new Date(iso);
    }

    const teams = {};
    mapRows.forEach(r=>{
      if(!teams[r[teamCol]]) teams[r[teamCol]]={won:false, frags:0};
      if(r[mapWonCol]==1) teams[r[teamCol]].won=true;
      teams[r[teamCol]].frags += Number(r[fragsCol])||0;
    });

    maps.push({
      mapName: mapRows[0][mapNameCol],
      mapUrl: url,
      mapDate,
      teams
    });
  }

  maps.sort((a,b)=>a.mapDate-b.mapDate);

  // -------------------------------------------------------
  // MATCH DETECTION (90 min window)
  // -------------------------------------------------------
  const matches = [];

  maps.forEach(map=>{

    const teamTags = Object.keys(map.teams);
    if(teamTags.length!==2) return;

    const teamSet = teamTags.sort().join("|");

    let matched=false;

    for(const m of matches){
      const mSet = m.teams.slice().sort().join("|");
      const timeDiff = Math.abs(map.mapDate - m.matchDate)/60000;

      if(mSet===teamSet && timeDiff<=MATCH_WINDOW_MINUTES){
        m.maps.push(map);
        if(map.mapDate < m.matchDate) m.matchDate = map.mapDate;
        matched=true;
        break;
      }
    }

    if(!matched){
      matches.push({
        teams: teamTags,
        maps:[map],
        matchDate: map.mapDate,
        isWalkover:false
      });
    }

  });

  // -------------------------------------------------------
  // Convert matches to scores
  // -------------------------------------------------------
  matches.forEach(m=>{
    m.scores={};
    m.teams.forEach(t=>m.scores[t]=0);

    m.maps.forEach(map=>{
      Object.entries(map.teams).forEach(([t,data])=>{
        if(data.won) m.scores[t]++;
      });
    });

    m.isPlayoff = m.matchDate >= playoffsStartDate;
  });

  // -------------------------------------------------------
  // WALKOVER INJECTION
  // -------------------------------------------------------
  if(woTeamGamesSheet.getLastRow()>1){

    const woData = woTeamGamesSheet.getDataRange().getValues();
    const woHeaders = woData[0];
    const woRows = woData.slice(1);
    const idx={};
    woHeaders.forEach((h,i)=>idx[h.trim()]=i);

    woRows.forEach(row=>{

      const stage = String(row[idx["Stage"]]||"").trim();
      const teamAName = String(row[idx["TeamA"]]||"").trim();
      const teamBName = String(row[idx["TeamB"]]||"").trim();
      const mapsWonA = Number(row[idx["MapsWonA"]])||0;
      const mapsWonB = Number(row[idx["MapsWonB"]])||0;
      const rawDate = row[idx["Date"]];

      if(!teamAName||!teamBName) return;

      let teamATag=null, teamBTag=null;
      for(const [tag,name] of Object.entries(teamNameLookup)){
        if(name===teamAName) teamATag=tag;
        if(name===teamBName) teamBTag=tag;
      }
      if(!teamATag||!teamBTag) return;

      let matchDate;
      if(rawDate instanceof Date){
        matchDate=rawDate;
      }else{
        const iso = String(rawDate)
          .replace(" ", "T")
          .replace(/ ([+-]\d{2})(\d{2})$/, "$1:$2");
        matchDate=new Date(iso);
      }

      matches.push({
        teams:[teamATag,teamBTag],
        maps:[],
        matchDate,
        isPlayoff: stage==="Playoff",
        isWalkover:true,
        scores:{
          [teamATag]:mapsWonA,
          [teamBTag]:mapsWonB
        }
      });
    });
  }

  // -------------------------------------------------------
  // Load Full Tournament Map Pool
  // -------------------------------------------------------
  const rawTournamentMaps = config["Tournament maps"] || "";

  const tournamentMaps = String(rawTournamentMaps)
    .split(",")
    .map(m => m.trim())
    .filter(m => m.length > 0);

  // -------------------------------------------------------
  // MAP STATS
  // -------------------------------------------------------
  const mapStats = {};

  matches.forEach(m => {
    if (m.isWalkover) return; // ignore walkovers

    m.maps.forEach(map => {

      const mapName = map.mapName || "Unknown";

      if (!mapStats[mapName]) {
        mapStats[mapName] = {
          played: 0,
          totalFrags: 0,
          teamWins: {},
          dominantTeam: null,
          highestFragGame: null,
          highestFragTotal: -1,
          mostOneSidedGame: null,
          biggestFragDiff: -1
        };
      }

      const stats = mapStats[mapName];
      stats.played++;

      const teamTags = Object.keys(map.teams);
      if (teamTags.length !== 2) return;

      const [teamA, teamB] = teamTags;
      const dataA = map.teams[teamA];
      const dataB = map.teams[teamB];

      const fragsA = dataA.frags || 0;
      const fragsB = dataB.frags || 0;

      const totalFrags = fragsA + fragsB;
      stats.totalFrags += totalFrags;

      // ----------------------------------
      // Track map wins per team
      // ----------------------------------
      let winner = null;
      if (dataA.won) winner = teamA;
      if (dataB.won) winner = teamB;

      if (winner) {
        if (!stats.teamWins[winner]) {
          stats.teamWins[winner] = 0;
        }
        stats.teamWins[winner]++;
      }

      // ----------------------------------
      // Highest frag game
      // ----------------------------------
      if (totalFrags > stats.highestFragTotal) {
        stats.highestFragTotal = totalFrags;
        stats.highestFragGame = {
          gameUrl: map.mapUrl,
          teamNameA: teamNameLookup[teamA] || teamA,
          teamNameB: teamNameLookup[teamB] || teamB,
          fragsA,
          fragsB
        };
      }

      // ----------------------------------
      // Most one-sided game
      // ----------------------------------
      const fragDiff = Math.abs(fragsA - fragsB);

      if (fragDiff > stats.biggestFragDiff) {
        stats.biggestFragDiff = fragDiff;
        stats.mostOneSidedGame = {
          gameUrl: map.mapUrl,
          teamNameA: teamNameLookup[teamA] || teamA,
          teamNameB: teamNameLookup[teamB] || teamB,
          fragsA,
          fragsB
        };
      }

    });
  });

     // -------------------------------------------------------
  // Build Output (Include Unplayed Maps)
  // -------------------------------------------------------
  const mapStatsOutput = [mapStatsHeader];

  // Ensure every tournament map exists in mapStats
  tournamentMaps.forEach(mapName => {
    if (!mapStats[mapName]) {
      mapStats[mapName] = {
        played: 0,
        totalFrags: 0,
        teamWins: {},
        dominantTeam: null,
        highestFragGame: null,
        mostOneSidedGame: null
      };
    }
  });

  Object.entries(mapStats)
    .sort((a, b) => b[1].played - a[1].played)
    .forEach(([mapName, stats]) => {

      // ----------------------------------
      // Determine dominant team
      // ----------------------------------
      let dominantTeamTag = null;
      let maxWins = 0;

      Object.entries(stats.teamWins).forEach(([teamTag, wins]) => {
        if (wins > maxWins) {
          maxWins = wins;
          dominantTeamTag = teamTag;
        }
      });

      if (dominantTeamTag && stats.played > 0) {
        const dominantTeamName =
          teamNameLookup[dominantTeamTag] || dominantTeamTag;

        const percentage = ((maxWins / stats.played) * 100).toFixed(2);

        stats.dominantTeam = {
          teamName: dominantTeamName,
          wins: maxWins,
          winPercentage: Number(percentage)
        };
      } else {
        stats.dominantTeam = null;
      }

      const avgFrags =
        stats.played > 0
          ? (stats.totalFrags / stats.played).toFixed(2)
          : "0";

      mapStatsOutput.push([
        mapName,
        stats.played,
        stats.totalFrags,
        avgFrags,
        stats.dominantTeam ? JSON.stringify(stats.dominantTeam) : "",
        stats.highestFragGame ? JSON.stringify(stats.highestFragGame) : "",
        stats.mostOneSidedGame ? JSON.stringify(stats.mostOneSidedGame) : ""
      ]);
    });

  mapStatsSheet.clearContents()
    .getRange(1, 1, mapStatsOutput.length, mapStatsHeader.length)
    .setNumberFormat("@STRING@")
    .setValues(mapStatsOutput);

  // -------------------------------------------------------
  // STANDINGS
  // -------------------------------------------------------
  const teamStats={};
  const headToHead={};

  matches.forEach(m=>{
    if(m.isPlayoff) return;

    const [a,b]=m.teams;
    const scoreA=m.scores[a];
    const scoreB=m.scores[b];

    if(!teamStats[a]) teamStats[a]={mapWins:0,mapLosses:0,gameWins:0,gameLosses:0};
    if(!teamStats[b]) teamStats[b]={mapWins:0,mapLosses:0,gameWins:0,gameLosses:0};

    teamStats[a].mapWins+=scoreA;
    teamStats[a].mapLosses+=scoreB;
    teamStats[b].mapWins+=scoreB;
    teamStats[b].mapLosses+=scoreA;

    if(scoreA!==scoreB){
      const winner=scoreA>scoreB?a:b;
      const loser=winner===a?b:a;
      teamStats[winner].gameWins++;
      teamStats[loser].gameLosses++;
      headToHead[`${winner}|${loser}`]=winner;
    }
  });

  const sortedTeams = Object.entries(teamStats)
    .map(([tag,s])=>({
      teamTag:tag,
      teamName:teamNameLookup[tag]||tag,
      ...s,
      diff:s.mapWins-s.mapLosses
    }))
    .sort((a,b)=>{
      if(b.gameWins!==a.gameWins) return b.gameWins-a.gameWins;
      if(b.diff!==a.diff) return b.diff-a.diff;
      if(headToHead[`${a.teamTag}|${b.teamTag}`]) return -1;
      if(headToHead[`${b.teamTag}|${a.teamTag}`]) return 1;
      return 0;
    });

  const standingsOutput=[["#","Team","Games","Maps","Diff"]];
  sortedTeams.forEach((t,i)=>{
    standingsOutput.push([
      i+1,
      t.teamName,
      `${t.gameWins}-${t.gameLosses}`,
      `${t.mapWins}-${t.mapLosses}`,
      t.diff>0?`+${t.diff}`:String(t.diff)
    ]);
  });

  standingsSheet.clearContents()
    .getRange(1,1,standingsOutput.length,5)
    .setNumberFormat("@STRING@")
    .setValues(standingsOutput);

  // -------------------------------------------------------
  // TEAMGAMES OUTPUT
  // -------------------------------------------------------
  matches.sort((a,b)=>a.matchDate-b.matchDate);

  const output=[teamGamesHeader];
  let rowNum=1;

  matches.forEach(m=>{

    const [a,b]=m.teams;
    const fullA=teamNameLookup[a]||a;
    const fullB=teamNameLookup[b]||b;

    const teamALower=fullA.toLowerCase();
    const teamBLower=fullB.toLowerCase();

    let matchedEntry=null;
    for(const entry of scheduleEntries){
      if(entry.matched) continue;
      const match=(entry.teamA===teamALower && entry.teamB===teamBLower)
        ||(entry.teamA===teamBLower && entry.teamB===teamALower);
      if(match){
        matchedEntry=entry;
        entry.matched=true;
        break;
      }
    }

    let allMapsJSON="[]";

    if(!m.isWalkover){
      allMapsJSON = JSON.stringify(
        m.maps.map(map=>({
          mapName:map.mapName,
          teamAFrags:map.teams[a]?.frags||0,
          teamBFrags:map.teams[b]?.frags||0,
          gameUrl:map.mapUrl,
          mapDate:map.mapDate
        }))
      );
    }

    output.push([
      rowNum++,
      m.isPlayoff?"Playoff":"Group",
      matchedEntry?matchedEntry.round:"",
      fullA,
      m.scores[a],
      `${m.scores[a]}-${m.scores[b]}`,
      fullB,
      m.scores[b],
      allMapsJSON,
      m.matchDate
    ]);
  });

  teamGamesSheet.clearContents()
    .getRange(1,1,output.length,teamGamesHeader.length)
    .setNumberFormat("@STRING@")
    .setValues(output);

}

// ─────────────────────────────────────────────
// Main entry point — attach a trigger to this
// ─────────────────────────────────────────────
function autoImportGames() {

  const now = new Date();
  
  // Get current hour (0–23)
  const currentHour = now.getHours();

  // Exit if current time is before 19:00 or after 23:59
  if (currentHour < 19 || currentHour > 23) return;
  
  // ── 1. Load config ──────────────────────────────────────────────────────
  const cfg = loadAutoImportConfig();
  if (!cfg) return; // logged inside

  // ── 2. Load already-imported URLs (Set for O(1) lookup) ─────────────────
  const importedUrls = loadImportedUrls();

  // ── 3. Load schedule team pairs ─────────────────────────────────────────
  const scheduledPairs = loadScheduledTeamPairs();

  // ── 4. Query Hub API ─────────────────────────────────────────────────────
  const games = fetchHubGames(cfg);
  if (!games || games.length === 0) {
    Logger.log("autoImportGames: no games returned from API");
    return;
  }
  Logger.log(`autoImportGames: ${games.length} games returned from API`);

  // ── 5. Filter & enqueue ──────────────────────────────────────────────────
  let enqueuedCount = 0;

  games.forEach(game => {

    const url = GAME_URL_PREFIX + game.id;

    // a) Already imported?
    if (importedUrls.has(url)) {
      Logger.log(`autoImport: skip (already imported) ${url}`);
      return;
    }

    // b) Excluded keyword in matchtag?
    if (hasExcludedKeyword(game.matchtag, cfg.excludedKeywords)) {
      Logger.log(`autoImport: skip (excluded keyword) matchtag="${game.matchtag}"`);
      return;
    }

    // c) Timestamp within tournament window?
    const gameDate = new Date(game.timestamp);
    if (gameDate < cfg.tournamentStart || gameDate > cfg.tournamentEnd) {
      Logger.log(`autoImport: skip (outside tournament window) ${game.timestamp}`);
      return;
    }

    // d) Team pair exists in schedule?
    const teamNames = game.teams.map(t => quakeNameToStandard(t.name).toLowerCase());
    if (!isScheduledPair(teamNames, scheduledPairs)) {
      Logger.log(`autoImport: skip (no schedule entry) teams=${teamNames.join(" vs ")}`);
      return;
    }

    // ── Passed all filters — enqueue ──────────────────────────────────────
    const messageId = `auto_match_${game.id}`;
    const enqueued  = enqueueMessageIfNew(
      messageId,
      new Date().toISOString(),
      "MATCH_REPORT",
      { url }
    );

    if (enqueued) {
      enqueuedCount++;
      Logger.log(`autoImport: enqueued game ${game.id} (${teamNames.join(" vs ")})`);
    }
  });

  // ── 6. Enqueue a single UPDATE_STATS after all new matches ───────────────
  if (enqueuedCount > 0) {
    enqueueMessage(
      `update_stats_auto_${Date.now()}`,
      new Date().toISOString(),
      "UPDATE_STATS",
      {}
    );
    Logger.log(`autoImportGames: enqueued ${enqueuedCount} new game(s) + UPDATE_STATS`);
  } else {
    Logger.log("autoImportGames: no new games to enqueue");
  }
}

/*
function parseDateTime(input) {
  if (!input) return null;
  
  // Regex to match formats like:
  // 12/02/26 @ 21:00
  // 12/02/2026 @ 21:00
  // 12/2/26 @ 9:00 PM
  // etc.
  
  const patterns = [
    // DD/MM/YY or DD/MM/YYYY @ HH:MM [AM/PM]
    /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*@\s*(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i,
    // MM-DD-YY or MM-DD-YYYY @ HH:MM [AM/PM]
    /(\d{1,2})-(\d{1,2})-(\d{2,4})\s*@\s*(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i,
  ];
  
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      let [_, part1, part2, year, hour, minute, meridiem] = match;
      
      // Convert 2-digit year to 4-digit
      if (year.length === 2) {
        year = `20${year}`;
      }
      
      // Handle 12-hour format
      hour = parseInt(hour);
      if (meridiem) {
        if (meridiem.toUpperCase() === 'PM' && hour !== 12) {
          hour += 12;
        } else if (meridiem.toUpperCase() === 'AM' && hour === 12) {
          hour = 0;
        }
      }
      
      // Assuming DD/MM/YYYY format (adjust if needed)
      const day = parseInt(part1);
      const month = parseInt(part2);
      
      // Format as DD/MM/YY @ HH:MM
      const shortYear = year.slice(-2);
      const formattedHour = String(hour).padStart(2, '0');
      const formattedMinute = String(minute).padStart(2, '0');
      const formattedDay = String(day).padStart(2, '0');
      const formattedMonth = String(month).padStart(2, '0');
      
      return `${formattedDay}/${formattedMonth}/${shortYear} @ ${formattedHour}:${formattedMinute}`;
    }
  }
  
  return null;
}

function parseScheduledFor(scheduledValue) {
  if (!scheduledValue) return null;
  
  // Try to match DD/MM/YY @ HH:MM format
  const match = String(scheduledValue).match(/(\d{1,2})\/(\d{1,2})\/(\d{2})\s*@\s*(\d{1,2}):(\d{2})/);
  
  if (match) {
    const [_, day, month, year, hour, minute] = match;
    return {
      day: parseInt(day),
      month: parseInt(month),
      year: 2000 + parseInt(year), // Convert YY to YYYY
      hour: parseInt(hour),
      minute: parseInt(minute)
    };
  }
  
  return null;
}
*/