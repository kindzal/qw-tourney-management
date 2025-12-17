function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("DataImport");
  if (!sheet) {
    return ContentService.createTextOutput("Sheet 'DataImport' not found.");
  }

  // Parse JSON body
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput("Invalid JSON payload.");
  }

  const urls = data.urls;
  if (!Array.isArray(urls)) {
    return ContentService.createTextOutput("Payload must contain an array 'urls'.");
  }

  // Required URL prefix
  const REQUIRED_PREFIX = "https://hub.quakeworld.nu/games/?gameId=";

  // Filter URLs to include only valid ones
  const filteredUrls = urls.filter(url => 
    typeof url === "string" && url.startsWith(REQUIRED_PREFIX)
  );

  // Limit to first 10 valid URLs
  const limitedUrls = filteredUrls.slice(0, 10);

  // Prepare values for writing (each URL in its own row)
  const values = limitedUrls.map(url => [url]);

  // Target range A1:A30
  const maxRows = 30;
  const column = 1;

  // Get existing values in A1:A30
  const existing = sheet
    .getRange(1, column, maxRows, 1)
    .getValues()
    .flat();

  // Find first empty row (0-based index)
  const firstEmptyIndex = existing.findIndex(v => !v);

  if (firstEmptyIndex === -1) {
    // No space left in A1:A30
    throw new Error("DataImport A1:A30 is full");
  }

  // How many URLs can we write?
  const spaceLeft = maxRows - firstEmptyIndex;
  const valuesToWrite = values.slice(0, spaceLeft);

  // Write URLs starting at first empty row
  sheet
    .getRange(firstEmptyIndex + 1, column, valuesToWrite.length, 1)
    .setValues(valuesToWrite);

  // Force Google Sheets to apply all writes BEFORE calling functions
  //SpreadsheetApp.flush();

  return ContentService.createTextOutput(
    "Accepted " + limitedUrls.length + " valid URLs. importDataFromWeb executed."
  );
}

function processPendingReports() {
  
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("DataImport");
  
  // Check if A1 has data
  const hasData = sheet.getRange("A1").getValue();

  if (!hasData) {
    // Nothing to process
    return;
  }

  // Only run if there is data
  importDataFromWeb();
  updateStats();
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

function importDataFromWeb() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var dataSheet = spreadsheet.getSheetByName("DataImport");
  var gamesSheet = spreadsheet.getSheetByName("Games");
  var importedGamesSheet = spreadsheet.getSheetByName("ImportedURLs");
  
  if (!dataSheet) {
    Logger.log("Sheet 'DataImport' not found");
    return;
  }
  if (!gamesSheet) {
    Logger.log("Sheet 'Games' not found");
    return;
  }
  
  var urls = dataSheet.getRange("A1:A30").getValues().flat(); // Get URLs from column A, rows 1 to 30  
  
  urls.forEach(function(url, index) {
    if (!url) return; // Skip empty cells

    var importedUrls = new Set(importedGamesSheet.getRange("A1:A100").getValues().flat().filter(String)); // Store imported URLs in a Set for quick lookup

    if (importedUrls.has(url)) {
      Logger.log("URL already imported, clearing: " + url);
      dataSheet.getRange(index + 1, 1).setValue(''); // Clear the URL if it has already been imported
      return;
    }
    
    var gameIdMatch = url.match(/gameId=(\d+)/);
    if (!gameIdMatch) {
      Logger.log("Invalid URL format: " + url);
      return;
    }
    var gameId = gameIdMatch[1];
    
    var apiEndpoint = 'https://ncsphkjfominimxztjip.supabase.co/functions/v1/gameinfo';
    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ gameId: gameId })
    };
    
    try {
      var response = UrlFetchApp.fetch(apiEndpoint, options);
      var jsonData = JSON.parse(response.getContentText());
      
      if (jsonData.ktxstats_url) {
        var apiUrl = jsonData.ktxstats_url;
        Logger.log("Extracted API URL: " + apiUrl);
      } else {
        Logger.log("ktxstats_url not found for gameId: " + gameId);
      }
    } catch (e) {
      Logger.log("Error fetching data for gameId " + gameId + ": " + e.message);
    }
    
    var response = UrlFetchApp.fetch(apiUrl);
    var jsonData = JSON.parse(response.getContentText());
    
    var date = jsonData.date;
    var map = jsonData.map;
    var hostname = jsonData.hostname;
    var matchtag = jsonData.matchtag;
    var players = jsonData.players;
    
    var teamScores = {};    
    
    for (var i = 0; i < players.length; i++) {
      var player = players[i];
      var team = quakeNameToStandard(player.team);
      if (!teamScores[team]) {
        teamScores[team] = 0;
      }
      teamScores[team] += player.stats.frags;      
    }
    
    var teams = Object.keys(teamScores);
    var winningTeam = teamScores[teams[0]] > teamScores[teams[1]] ? teams[0] : teams[1];
    
    var rowData = [];
    var importedGamesRowData = [];
    
    players.sort((a, b) => b.stats.frags - a.stats.frags); // Sort players by frags (highest first)
    
    players.forEach(function(player) {
      var name = quakeNameToStandard(player.name).replace(/=/g, "");
      var team = quakeNameToStandard(player.team);
      var frags = player.stats.frags;
      var deaths = player.stats.deaths;
      var tk = player.stats.tk;
      var spawnFrags = player.stats["spawn-frags"];
      var kills = player.stats.kills;
      var suicides = player.stats.suicides;
      
      var eff = (kills + deaths) > 0 ? (kills / (kills + deaths) * 100).toFixed(2) + "%" : "0%";
      
      var sgAttacks = player.weapons.sg && player.weapons.sg.acc && player.weapons.sg.acc.attacks ? player.weapons.sg.acc.attacks : 0;
      var sgHits = player.weapons.sg && player.weapons.sg.acc && player.weapons.sg.acc.hits ? player.weapons.sg.acc.hits : 0;
      var sgAccuracy = sgAttacks > 0 ? (sgHits / sgAttacks * 100).toFixed(2) + "%" : "0%";
      
      var rlAttacks = player.weapons.rl && player.weapons.rl.acc && player.weapons.rl.acc.attacks ? player.weapons.rl.acc.attacks : 0;
      var rlHits = player.weapons.rl && player.weapons.rl.acc && player.weapons.rl.acc.hits ? player.weapons.rl.acc.hits : 0;
      var rlAccuracy = rlAttacks > 0 ? (rlHits / rlAttacks * 100).toFixed(2) + "%" : "0%";
            
      var lgAttacks = player.weapons.lg && player.weapons.lg.acc && player.weapons.lg.acc.attacks ? player.weapons.lg.acc.attacks : 0;
      var lgHits = player.weapons.lg && player.weapons.lg.acc && player.weapons.lg.acc.hits ? player.weapons.lg.acc.hits : 0;
      var lgAccuracy = lgAttacks > 0 ? (lgHits / lgAttacks * 100).toFixed(2) + "%" : "0%";

      if (lgAttacks) 
        lgAttacks = 1;
      else
        lgAttacks = 0;

      var rlPickups = player.weapons.rl?.pickups?.taken || 0;
      var rlKills = player.weapons.rl?.kills?.enemy || 0;
      var rlDropped = player.weapons.rl?.pickups?.dropped || 0;
      
      var lgPickups = player.weapons.lg?.pickups?.taken || 0;
      var lgKills = player.weapons.lg?.kills?.enemy || 0;
      var lgDropped = player.weapons.lg?.pickups?.dropped || 0;
      
      var mapWon = team === winningTeam ? 1 : 0;
      
      var ga = player.items?.ga?.took || 0;
      var ya = player.items?.ya?.took || 0;
      var ra = player.items?.ra?.took || 0;
      var p = player.items?.p?.took || 0;
      var q = player.items?.q?.took || 0;      
      var r = player.items?.r?.took || 0;
      var mh = player.items?.health_100?.took || 0;
      
      var ewep = player.dmg?.["enemy-weapons"] || 0;
      var given = player.dmg?.given || 0;
      var self = player.dmg?.self || 0;
      var taken = player.dmg?.taken || 0;
      var toDie = player.dmg?.["taken-to-die"] || 0;
      
      rowData.push([url, date, map, hostname, matchtag, mapWon, frags, team, name, eff, kills, deaths, suicides, tk, given, taken, ewep, toDie, ga, ya, ra, mh, sgAccuracy, lgAttacks, lgAccuracy, rlHits, lgPickups, lgKills, lgDropped, rlPickups, rlKills, rlDropped, q, p, r, self]);
    });
    
    if (rowData.length > 0) {
      var lastRow = Math.max(gamesSheet.getLastRow(), 1) + 1;
      gamesSheet.getRange(lastRow, 1, rowData.length, rowData[0].length).setValues(rowData);

      // Clear the corresponding A cell after successful import
      dataSheet.getRange(index + 1, 1).setValue(''); 
      
      lastRow = Math.max(importedGamesSheet.getLastRow(), 1) + 1;
      importedGamesRowData.push([url]);
      importedGamesSheet.getRange(lastRow, 1, importedGamesRowData.length, importedGamesRowData[0].length).setValues(importedGamesRowData);
    }
  });
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

function updateStats() {
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
  updateTeams();
}

function updateTeams() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const gamesSheet = ss.getSheetByName("Games");
  const standingsSheet = ss.getSheetByName("Standings");
  const teamGamesSheet = ss.getSheetByName("TeamGames");
  const teamsSheet = ss.getSheetByName("Teams");

  const gamesData = gamesSheet.getDataRange().getValues();
  const headers = gamesData[0];
  const data = gamesData.slice(1); // Exclude header

  const urlCol = headers.indexOf("URL");
  const serverCol = headers.indexOf("Server");
  const matchTagCol = headers.indexOf("Match Tag");
  const dateCol = headers.indexOf("Date");
  const teamCol = headers.indexOf("Team");
  const mapWonCol = headers.indexOf("Map Won");
  const mapNameCol = headers.indexOf("Map");

  // -------------------------------------------------------
  // Build team lookup table (teamTag → teamName)
  // -------------------------------------------------------
  const teamsData = teamsSheet.getDataRange().getValues().slice(1); // remove header
  const teamNameLookup = {};

  teamsData.forEach(row => {
    const tag = row[0];
    const name = row[1];
    if (tag) teamNameLookup[tag] = name || tag;
  });

  const teamStats = {};
  const mapGroups = {};
  const gameMaps = {};
  const gameToMapTeams = {}; // game ID -> { teamA: X maps, teamB: Y maps }
  
  // Step 1: Group rows by URL (each map)
  for (const row of data) {
    const url = row[urlCol];
    if (!mapGroups[url]) mapGroups[url] = [];
    mapGroups[url].push(row);
  }

  // Step 2: Count map wins/losses per team
  for (const [url, rows] of Object.entries(mapGroups)) {
    const gameId = rows[0][serverCol] + "|" + rows[0][matchTagCol] + "|" + String(rows[0][dateCol]).substring(0, 10);
    
    const teamMapWon = {};
    
    if (!gameMaps[gameId]) gameMaps[gameId] = { maps: [], mapDate: rows[0][dateCol] }; // store date
    gameMaps[gameId].maps.push({ mapName: rows[0][mapNameCol], mapUrl: rows[0][urlCol], mapDate: rows[0][dateCol] });
           
    for (const row of rows) {
      const team = row[teamCol];
      const mapWon = row[mapWonCol] == 1;
      if (!teamMapWon.hasOwnProperty(team)) {
        teamMapWon[team] = mapWon;
      }
    }

    for (const [team, won] of Object.entries(teamMapWon)) {
      if (!teamStats[team]) {
        teamStats[team] = { mapWins: 0, mapLosses: 0, gameWins: 0, gameLosses: 0 };
      }
      if (won) {
        teamStats[team].mapWins += 1;
      } else {
        teamStats[team].mapLosses += 1;
      }

      if (!gameToMapTeams[gameId]) gameToMapTeams[gameId] = {};
      if (!gameToMapTeams[gameId][team]) gameToMapTeams[gameId][team] = 0;
      if (won) gameToMapTeams[gameId][team] += 1;
    }
  }

  // Step 3: Determine game wins/losses from map scores
  for (const [gameId, teamScores] of Object.entries(gameToMapTeams)) {
    const teams = Object.keys(teamScores);
    if (teams.length !== 2) continue; // skip malformed games

    const [teamA, teamB] = teams;
    const scoreA = teamScores[teamA];
    const scoreB = teamScores[teamB];

    if (scoreA === scoreB) continue; // draw or error, skip

    const winner = scoreA > scoreB ? teamA : teamB;
    const loser = scoreA > scoreB ? teamB : teamA;

    teamStats[winner].gameWins += 1;
    teamStats[loser].gameLosses += 1;    
  }

  // Step 4: Prepare sorted stats
  const sortedTeams = Object.entries(teamStats)
    .map(([team, stats]) => ({
      teamTag: team,
      teamName: teamNameLookup[team] || team, // NEW
      ...stats,
      diff: stats.mapWins - stats.mapLosses,
    }))
    .sort((a, b) => {
      if (b.diff !== a.diff) return b.diff - a.diff;
      return b.gameWins - a.gameWins;
    });

  // Step 5: Write standings table
  const standingsOutput = [["#", "Team", "Games", "Maps", "Diff"]];
  sortedTeams.forEach((entry, index) => {
    standingsOutput.push([
      index + 1,
      entry.teamName, // NEW
      `${entry.gameWins}-${entry.gameLosses}`,
      `${entry.mapWins}-${entry.mapLosses}`,
      entry.diff,
    ]);
  });

  standingsSheet.clearContents();
  standingsSheet
    .getRange(1, 1, standingsOutput.length, standingsOutput[0].length)
    .setValues(standingsOutput);
    
  // ---------------------------------------------
  // TeamGames with hyperlink maps (sorted by date)
  // ---------------------------------------------
  teamGamesSheet.clearContents();

  const maxMaps = Math.max(
    ...Object.values(gameMaps).map(g => g.maps.length)
  );

  const tgHeader = ["#", "Team A", "Score", "Team B"];
  for (let i = 1; i <= maxMaps; i++) tgHeader.push("Map " + i);

  const tgOutput = [tgHeader];
  let gameIndex = 1;

  // SORT gameMaps by mapDate
  const sortedGameEntries = Object.entries(gameMaps).sort(
    ([, a], [, b]) => new Date(a.mapDate) - new Date(b.mapDate)
  );

  for (const [gameId, gameData] of sortedGameEntries) {
    const maps = gameData.maps;
    const scores = gameToMapTeams[gameId];
    if (!scores) continue;

    const teams = Object.keys(scores);
    if (teams.length !== 2) continue;

    const [teamA, teamB] = teams;

    const fullA = teamNameLookup[teamA] || teamA;
    const fullB = teamNameLookup[teamB] || teamB;

    const scoreStr = `${scores[teamA]}-${scores[teamB]}`;

    // Sort maps by mapDate ascending
    maps.sort((a, b) => new Date(a.mapDate) - new Date(b.mapDate));
    
    // Build each map as a hyperlink formula
    const mapCells = maps.map(m =>
      `=HYPERLINK("${m.mapUrl}", "${m.mapName}")`
    );

    // Pad empty columns
    while (mapCells.length < maxMaps) mapCells.push("");

    tgOutput.push([
      gameIndex++,
      fullA,
      scoreStr,
      fullB,
      ...mapCells
    ]);
  }

  // Write TeamGames sheet (must use setValues for formulas)
  teamGamesSheet
    .getRange(1, 1, tgOutput.length, tgOutput[0].length).setNumberFormat("@STRING@")
    .setValues(tgOutput);

  // Optional: auto-resize
  try {
    teamGamesSheet.autoResizeColumns(1, 9);
    standingsSheet.autoResizeColumns(1, 9);
  } catch (e) {
    // ignore
  }
}