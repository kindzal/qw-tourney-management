function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Tournament Tools')
    .addItem('Open Control Panel', 'openSidebar')
    .addToUi();
  hideSheets();
}

function onSelectionChange(e) {
  const sheet = e.range.getSheet().getName();
  
  PropertiesService.getDocumentProperties()
    .setProperty('ACTIVE_SHEET', sheet);
}

function getActiveSheetName() {
  return SpreadsheetApp.getActiveSpreadsheet()
    .getActiveSheet()
    .getName();
}

function openSidebar() {
  /*const html = HtmlService
    .createHtmlOutputFromFile('admin-sidebar')
    .setTitle('Tournament Control Panel');*/

  const template = HtmlService.createTemplateFromFile('admin.sidebar');
  const html = template.evaluate()
    .setTitle('Tournament Control Panel');    
    
  SpreadsheetApp.getUi().showSidebar(html);
}

function hideSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // List of sheet names you want to hide
  const sheetsToHide = ['MapStats', 'Games', 'Standings', 'TeamGames','ImportedURLs','MsgQueue'];
  
  sheetsToHide.forEach(name => {
    let sheet = ss.getSheetByName(name);
    // Check if sheet exists and is not already hidden to avoid errors
    if (sheet && !sheet.isSheetHidden()) {
      sheet.hideSheet();
    }
  });
}

function switchTab(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (sheet) {
    sheet.activate(); // This physically moves the user to that tab
  } else {
    SpreadsheetApp.getUi().alert("Sheet '" + sheetName + "' not found.");
  }
}
// Manual import function - reads URLs from DataImport sheet and enqueues them to MsgQueue
function importDataFromWeb() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = spreadsheet.getSheetByName("DataImport");
  
  if (!dataSheet) {
    Logger.log("Sheet 'DataImport' not found");
    return;
  }
  
  const urls = dataSheet.getRange("A1:A30").getValues().flat();
  let enqueuedCount = 0;
  
  urls.forEach((url, index) => {
    if (!url) return; // Skip empty cells
    
    const messageId = `manual_match_${Date.now()}_${index}`;
    const timestamp = new Date().toISOString();
    const payload = { url };
    
    const enqueued = enqueueMessageIfNew(
      messageId,
      timestamp,
      "MATCH_REPORT",
      payload
    );
    
    if (enqueued) {
      enqueuedCount++;
      // Clear the URL from DataImport after successful enqueue
      dataSheet.getRange(index + 1, 1).setValue('');
    } else {
      Logger.log(`URL already in queue or imported: ${url}`);
    }
  });
  
  // Enqueue UPDATE_STATS message if any matches were enqueued
  if (enqueuedCount > 0) {
    const updateStatsMessageId = `update_stats_manual_${Date.now()}`;
    const timestamp = new Date().toISOString();
    
    enqueueMessage(
      updateStatsMessageId,
      timestamp,
      "UPDATE_STATS",
      {}
    );
  }
  
  SpreadsheetApp.flush();
  
  Logger.log(`✅ Enqueued ${enqueuedCount} URLs from DataImport to MsgQueue`);
  
  if (enqueuedCount > 0) {
    SpreadsheetApp.getUi().alert(
      `✅ Success!\n\n` +
      `Enqueued ${enqueuedCount} match reports to MsgQueue.\n\n` +
      `They will be processed automatically by the trigger.`
    );
  } else {
    SpreadsheetApp.getUi().alert(
      `ℹ️ No URLs to process.\n\n` +
      `Either DataImport is empty or all URLs are already queued/imported.`
    );
  }
}

function generateRoundRobin(teams, isDouble) {

  const list = [...teams];
  if (list.length % 2 !== 0) {
    list.push("BYE");
  }

  const rounds = [];
  const n = list.length;

  for (let round = 0; round < n - 1; round++) {

    const matches = [];

    for (let i = 0; i < n / 2; i++) {
      const home = list[i];
      const away = list[n - 1 - i];

      if (home !== "BYE" && away !== "BYE") {
        matches.push([home, away]);
      }
    }

    rounds.push(matches);

    // rotate
    list.splice(1, 0, list.pop());
  }

  if (isDouble) {
    const reverseRounds = rounds.map(r =>
      r.map(match => [match[1], match[0]])
    );
    return rounds.concat(reverseRounds);
  }

  return rounds;
}

function generateSchedule(data) {
  const ss = SpreadsheetApp.getActive();
  const scheduleSheet = ss.getSheetByName("Schedule");
  const configSheet = ss.getSheetByName("ScheduleConfig");

  const teams = getTeams();
  if (teams.length < 2) {
    throw new Error("Not enough teams.");
  }

  const config = getConfiguration();
  const mapsFormatted = formatMaps(config["Tournament maps"]);

  const groupRounds = generateRoundRobin(teams, data.groupStage === "Double Round Robin");

  const scheduleRows = [];
  const configRows = [];

  // ---- GROUP STAGE ----
  let roundNumber = 1;
  let currentDeadline = getFirstSundayAfter(config["Tournament start"]);

  groupRounds.forEach(roundMatches => {

    const roundLabel = roundNumber;

    // Schedule sheet
    roundMatches.forEach(match => {
      scheduleRows.push([
        roundLabel,
        match[0],
        match[1],
        "",
        "No"
      ]);
    });

    // ScheduleConfig sheet
    configRows.push([
      roundLabel,
      mapsFormatted + " (" + data.groupStageMode + ")",
      currentDeadline
    ]);

    currentDeadline = addDays(currentDeadline, 7);
    roundNumber++;
  });

  // ---- PLAYOFFS ----
  if (data.playoffsRequired === "Yes") {
    const playoffRounds = generatePlayoffsStructure(data.playoffsType);

    playoffRounds.forEach(round => {

      round.matches.forEach(() => {
        scheduleRows.push([
          round.name,
          "-",
          "-",
          "",
          "No"
        ]);
      });

      configRows.push([
        round.name,
        mapsFormatted + " (" + data.playoffsMode + ")",
        currentDeadline
      ]);

      // Only advance the deadline when moving to a new week
      if (round.advanceWeek) {
        currentDeadline = addDays(currentDeadline, 7);
      }
    });
  }

  // ---- WRITE SHEETS ----
  writeSchedule(scheduleSheet, scheduleRows);
  writeScheduleConfig(configSheet, configRows);

  return "Schedule generated successfully.";
}

function generatePlayoffsStructure(type) {

  // advanceWeek: true  → advance currentDeadline AFTER writing this round's config row
  // advanceWeek: false → share the same deadline as the previous round

  if (type === "Single Elimination") {
    return [
      { name: "Quarterfinals", matches: Array(4).fill(null), advanceWeek: true  },
      { name: "Semifinals",    matches: Array(2).fill(null), advanceWeek: true  },
      { name: "Final",         matches: Array(1).fill(null), advanceWeek: false },
      { name: "Bronze",        matches: Array(1).fill(null), advanceWeek: false }
    ];
  }

  if (type === "AB Playoffs") {
    return [
      { name: "Quarterfinals", matches: Array(4).fill(null), advanceWeek: true  },
      { name: "Semifinals",    matches: Array(2).fill(null), advanceWeek: false },
      { name: "Semifinals B",  matches: Array(2).fill(null), advanceWeek: true  },
      { name: "Final",         matches: Array(1).fill(null), advanceWeek: false },
      { name: "Final B",       matches: Array(1).fill(null), advanceWeek: false },
      { name: "Bronze",        matches: Array(1).fill(null), advanceWeek: false },
      { name: "Bronze B",      matches: Array(1).fill(null), advanceWeek: false }
    ];
  }

  return [];
}

function writeSchedule(sheet, rows) {
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 5).clearContent();
    sheet.getRange(2, 1, lastRow - 1, 5).clearDataValidations();
  }

  if (!rows.length) return;

  sheet.getRange(2, 1, rows.length, 5).setValues(rows);

  const ss = SpreadsheetApp.getActive();
  const teamsSheet = ss.getSheetByName("Teams");

  const teamNames = teamsSheet
    .getRange(2, 2, teamsSheet.getLastRow() - 1, 1)
    .getValues()
    .flat()
    .filter(Boolean);

  // Add "-" placeholder
  teamNames.unshift("-");

  const teamValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(teamNames, true)
    .setAllowInvalid(false)
    .build();

  sheet.getRange(2, 2, rows.length).setDataValidation(teamValidation);
  sheet.getRange(2, 3, rows.length).setDataValidation(teamValidation);

  const reminderValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Yes", "No"], true)
    .setAllowInvalid(false)
    .build();

  sheet.getRange(2, 5, rows.length).setDataValidation(reminderValidation);
}

function writeScheduleConfig(sheet, rows) {
  sheet.getRange(2, 1, sheet.getLastRow(), 3).clearContent();

  if (!rows.length) return;

  sheet.getRange(2, 1, rows.length, 3).setValues(rows);
}

function confirmScheduleOverwrite() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.alert(
    'Confirm Schedule Generation',
    'If Schedule or ScheduleConfig contains data, it will be overwritten. Continue?',
    ui.ButtonSet.YES_NO
  );
  return result === ui.Button.YES;
}

// ═══════════════════════════════════════════════════════════════════════════
// Playoff Population Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check group stage completion status for display in UI
 */
function checkGroupStageStatus() {
  const ss = SpreadsheetApp.getActive();
  const scheduleSheet = ss.getSheetByName("Schedule");
  const teamGamesSheet = ss.getSheetByName("TeamGames");
  
  if (!scheduleSheet || !teamGamesSheet) {
    return { complete: true, warning: null };
  }
  
  const status = checkGroupStageComplete(scheduleSheet, teamGamesSheet);
  
  if (!status.complete) {
    return {
      complete: false,
      warning: `Group stage is not complete. ${status.played} of ${status.expected} games played. Proceed with caution!`
    };
  }
  
  return { complete: true, warning: null };
}

/**
 * Populates playoff matchups in the Schedule sheet based on standings and game results
 */
function populatePlayoffsMatchups() {
  const ss = SpreadsheetApp.getActive();
  const scheduleSheet = ss.getSheetByName("Schedule");
  const standingsSheet = ss.getSheetByName("Standings");
  const teamGamesSheet = ss.getSheetByName("TeamGames");
  const teamsSheet = ss.getSheetByName("Teams");
  
  if (!scheduleSheet || !standingsSheet || !teamGamesSheet || !teamsSheet) {
    return { success: false, message: "Required sheets not found" };
  }

  // Get playoff type from schedule configuration
  const playoffType = getPlayoffType(scheduleSheet);
  
  // Get number of teams
  const numTeams = teamsSheet.getLastRow() - 1;
  
  // Get seeded teams from standings
  const seeds = getSeededTeams(standingsSheet);
  
  if (seeds.length < 4) {
    return { success: false, message: "Not enough teams in standings (minimum 4 required)" };
  }
  
  // Get all team games for determining winners
  const teamGames = getTeamGamesData(teamGamesSheet);
  
  // Populate each playoff stage progressively
  let populated = [];
  
  // 1. Quarterfinals
  const qfResult = populateQuarterfinals(scheduleSheet, seeds, numTeams);
  if (qfResult.populated) {
    populated.push("Quarterfinals");
  }
  
  // 2. Check if all QFs are played before populating semifinals
  const qfRequired = numTeams >= 8 ? 4 : 2;
  const qfGames = teamGames.filter(g => g.round === "Quarterfinals");
  
  if (qfGames.length >= qfRequired) {
    // 3. Semifinals
    const sfResult = populateSemifinals(scheduleSheet, teamGames, seeds, numTeams);
    if (sfResult.populated) {
      populated.push("Semifinals");
    }
    
    // 4. AB Playoffs: Semifinals B
    if (playoffType === "AB Playoffs") {
      const sfbResult = populateSemifinalsB(scheduleSheet, teamGames, seeds, numTeams);
      if (sfbResult.populated) {
        populated.push("Semifinals B");
      }
    }
    
    // 5. Check if all SFs are played before populating finals
    const sfGames = teamGames.filter(g => g.round === "Semifinals");
    
    if (sfGames.length >= 2) {
      // 6. Final and Bronze
      const finalResult = populateFinal(scheduleSheet, teamGames);
      if (finalResult.populated) {
        populated.push("Final");
      }
      
      const bronzeResult = populateBronze(scheduleSheet, teamGames);
      if (bronzeResult.populated) {
        populated.push("Bronze");
      }
      
      // 7. AB Playoffs: Final B and Bronze B
      if (playoffType === "AB Playoffs") {
        const sfbGames = teamGames.filter(g => g.round === "Semifinals B");
        
        if (sfbGames.length >= 2) {
          const finalbResult = populateFinalB(scheduleSheet, teamGames);
          if (finalbResult.populated) {
            populated.push("Final B");
          }
          
          const bronzebResult = populateBronzeB(scheduleSheet, teamGames);
          if (bronzebResult.populated) {
            populated.push("Bronze B");
          }
        }
      }
    }
  }
  
  if (populated.length === 0) {
    return {
      success: true,
      message: "All playoff stages are already populated or cannot be generated yet."
    };
  }
  
  return {
    success: true,
    message: `Successfully populated: ${populated.join(", ")}`
  };
}

/**
 * Get playoff type from schedule
 */
function getPlayoffType(scheduleSheet) {
  const data = scheduleSheet.getDataRange().getValues();
  
  // Check if AB Playoffs rounds exist
  for (let i = 1; i < data.length; i++) {
    const round = data[i][0];
    if (round === "Semifinals B" || round === "Final B" || round === "Bronze B") {
      return "AB Playoffs";
    }
  }
  
  return "Single Elimination";
}

/**
 * Check if group stage is complete
 */
function checkGroupStageComplete(scheduleSheet, teamGamesSheet) {
  const scheduleData = scheduleSheet.getDataRange().getValues();
  const teamGamesData = teamGamesSheet.getDataRange().getValues();
  
  // Count expected group stage games (numeric rounds)
  let expected = 0;
  for (let i = 1; i < scheduleData.length; i++) {
    const round = String(scheduleData[i][0]);
    if (!isNaN(round) && round.trim() !== "") {
      expected++;
    }
  }
  
  // Count played group stage games
  let played = 0;
  for (let i = 1; i < teamGamesData.length; i++) {
    const round = String(teamGamesData[i][2]);
    if (!isNaN(round) && round.trim() !== "") {
      played++;
    }
  }
  
  return {
    complete: played >= expected,
    expected: expected,
    played: played
  };
}

/**
 * Get seeded teams from standings
 */
function getSeededTeams(standingsSheet) {
  const data = standingsSheet.getDataRange().getValues();
  const seeds = [];
  
  // Skip header row, get teams in order
  for (let i = 1; i < data.length; i++) {
    const seed = data[i][0]; // Column A: #
    const team = data[i][1]; // Column B: Team
    
    if (team && team !== "") {
      seeds.push({ seed: seed, team: team });
    }
  }
  
  return seeds;
}

/**
 * Get all team games data
 */
function getTeamGamesData(teamGamesSheet) {
  const data = teamGamesSheet.getDataRange().getValues();
  const games = [];
  
  // Skip header
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    games.push({
      round: row[2],      // Column C: Round
      teamA: row[3],      // Column D: TeamA
      mapsWonA: row[4],   // Column E: MapsWonA
      teamB: row[6],      // Column G: TeamB
      mapsWonB: row[7]    // Column H: MapsWonB
    });
  }
  
  return games;
}

/**
 * Populate Quarterfinals
 */
function populateQuarterfinals(scheduleSheet, seeds, numTeams) {
  const data = scheduleSheet.getDataRange().getValues();
  let populated = false;
  
  // Find Quarterfinals rows
  const qfRows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === "Quarterfinals") {
      qfRows.push(i);
    }
  }
  
  if (qfRows.length < 4) {
    return { populated: false };
  }
  
  // Define matchups based on number of teams
  let matchups = [];
  
  if (numTeams >= 8) {
    // 8 teams: 1v8, 4v5, 2v7, 3v6
    matchups = [
      [seeds[0].team, seeds[7].team],
      [seeds[3].team, seeds[4].team],
      [seeds[1].team, seeds[6].team],
      [seeds[2].team, seeds[5].team]
    ];
  } else if (numTeams >= 6) {
    // 6 teams with byes: 1v-, 3v6, 4v5, -v2
    matchups = [
      [seeds[0].team, "-"],
      [seeds[2].team, seeds[5].team],
      [seeds[3].team, seeds[4].team],
      ["-", seeds[1].team]
    ];
  } else {
    return { populated: false };
  }
  
  // Populate if not already filled
  for (let i = 0; i < 4 && i < qfRows.length; i++) {
    const rowIndex = qfRows[i];
    const team1 = data[rowIndex][1];
    const team2 = data[rowIndex][2];
    
    // Only populate if both teams are blank or "-"
    if ((!team1 || team1 === "" || team1 === "-") && 
        (!team2 || team2 === "" || team2 === "-")) {
      scheduleSheet.getRange(rowIndex + 1, 2).setValue(matchups[i][0]);
      scheduleSheet.getRange(rowIndex + 1, 3).setValue(matchups[i][1]);
      populated = true;
    }
  }
  
  return { populated: populated };
}

/**
 * Get winner of a match
 */
function getWinner(teamGames, round, team1, team2) {
  const game = teamGames.find(g => 
    g.round === round && 
    ((g.teamA === team1 && g.teamB === team2) || (g.teamA === team2 && g.teamB === team1))
  );
  
  if (!game) return null;
  
  if (game.mapsWonA > game.mapsWonB) {
    return game.teamA;
  } else if (game.mapsWonB > game.mapsWonA) {
    return game.teamB;
  }
  
  return null; // Draw or incomplete
}

/**
 * Populate Semifinals
 */
function populateSemifinals(scheduleSheet, teamGames, seeds, numTeams) {
  const data = scheduleSheet.getDataRange().getValues();
  let populated = false;
  
  // Find Semifinals rows
  const sfRows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === "Semifinals") {
      sfRows.push(i);
    }
  }
  
  if (sfRows.length < 2) {
    return { populated: false };
  }
  
  // Get QF matchups from schedule
  const qfRows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === "Quarterfinals") {
      qfRows.push({ team1: data[i][1], team2: data[i][2] });
    }
  }
  
  if (qfRows.length < 4) {
    return { populated: false };
  }
  
  // Determine SF matchups
  let sf1Team1, sf1Team2, sf2Team1, sf2Team2;
  
  if (numTeams >= 8) {
    // SF1: Winner of QF1 vs Winner of QF2
    sf1Team1 = getWinner(teamGames, "Quarterfinals", qfRows[0].team1, qfRows[0].team2);
    sf1Team2 = getWinner(teamGames, "Quarterfinals", qfRows[1].team1, qfRows[1].team2);
    
    // SF2: Winner of QF3 vs Winner of QF4
    sf2Team1 = getWinner(teamGames, "Quarterfinals", qfRows[2].team1, qfRows[2].team2);
    sf2Team2 = getWinner(teamGames, "Quarterfinals", qfRows[3].team1, qfRows[3].team2);
  } else {
    // 6 teams: Seed1 vs Winner of QF2, Winner of QF3 vs Seed2
    sf1Team1 = seeds[0].team;
    sf1Team2 = getWinner(teamGames, "Quarterfinals", qfRows[1].team1, qfRows[1].team2);
    
    sf2Team1 = getWinner(teamGames, "Quarterfinals", qfRows[2].team1, qfRows[2].team2);
    sf2Team2 = seeds[1].team;
  }
  
  // Populate if all teams determined and not already filled
  if (sf1Team1 && sf1Team2) {
    const team1 = data[sfRows[0]][1];
    const team2 = data[sfRows[0]][2];
    
    if ((!team1 || team1 === "" || team1 === "-") && 
        (!team2 || team2 === "" || team2 === "-")) {
      scheduleSheet.getRange(sfRows[0] + 1, 2).setValue(sf1Team1);
      scheduleSheet.getRange(sfRows[0] + 1, 3).setValue(sf1Team2);
      populated = true;
    }
  }
  
  if (sf2Team1 && sf2Team2) {
    const team1 = data[sfRows[1]][1];
    const team2 = data[sfRows[1]][2];
    
    if ((!team1 || team1 === "" || team1 === "-") && 
        (!team2 || team2 === "" || team2 === "-")) {
      scheduleSheet.getRange(sfRows[1] + 1, 2).setValue(sf2Team1);
      scheduleSheet.getRange(sfRows[1] + 1, 3).setValue(sf2Team2);
      populated = true;
    }
  }
  
  return { populated: populated };
}

/**
 * Populate Semifinals B (for AB Playoffs)
 */
function populateSemifinalsB(scheduleSheet, teamGames, seeds, numTeams) {
  const data = scheduleSheet.getDataRange().getValues();
  let populated = false;
  
  // Find Semifinals B rows
  const sfbRows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === "Semifinals B") {
      sfbRows.push(i);
    }
  }
  
  if (sfbRows.length < 2) {
    return { populated: false };
  }
  
  // Get QF matchups and losers
  const qfRows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === "Quarterfinals") {
      qfRows.push({ team1: data[i][1], team2: data[i][2] });
    }
  }
  
  if (qfRows.length < 4) {
    return { populated: false };
  }
  
  // Get losers of QFs
  function getLoser(round, team1, team2) {
    const winner = getWinner(teamGames, round, team1, team2);
    if (!winner) return null;
    if (winner === team1) return team2;
    if (winner === team2) return team1;
    return null;
  }
  
  let sfb1Team1, sfb1Team2, sfb2Team1, sfb2Team2;
  
  if (numTeams >= 8) {
    // SFB1: Loser of QF1 vs Loser of QF2
    sfb1Team1 = getLoser("Quarterfinals", qfRows[0].team1, qfRows[0].team2);
    sfb1Team2 = getLoser("Quarterfinals", qfRows[1].team1, qfRows[1].team2);
    
    // SFB2: Loser of QF3 vs Loser of QF4
    sfb2Team1 = getLoser("Quarterfinals", qfRows[2].team1, qfRows[2].team2);
    sfb2Team2 = getLoser("Quarterfinals", qfRows[3].team1, qfRows[3].team2);
  } else {
    // 6 teams: Loser of QF2, Loser of QF3
    sfb1Team1 = getLoser("Quarterfinals", qfRows[1].team1, qfRows[1].team2);
    sfb1Team2 = getLoser("Quarterfinals", qfRows[2].team1, qfRows[2].team2);
    
    // For 6 teams we might need different logic - skip for now
    sfb2Team1 = null;
    sfb2Team2 = null;
  }
  
  // Populate if all teams determined
  if (sfb1Team1 && sfb1Team2) {
    const team1 = data[sfbRows[0]][1];
    const team2 = data[sfbRows[0]][2];
    
    if ((!team1 || team1 === "" || team1 === "-") && 
        (!team2 || team2 === "" || team2 === "-")) {
      scheduleSheet.getRange(sfbRows[0] + 1, 2).setValue(sfb1Team1);
      scheduleSheet.getRange(sfbRows[0] + 1, 3).setValue(sfb1Team2);
      populated = true;
    }
  }
  
  if (sfb2Team1 && sfb2Team2 && sfbRows.length > 1) {
    const team1 = data[sfbRows[1]][1];
    const team2 = data[sfbRows[1]][2];
    
    if ((!team1 || team1 === "" || team1 === "-") && 
        (!team2 || team2 === "" || team2 === "-")) {
      scheduleSheet.getRange(sfbRows[1] + 1, 2).setValue(sfb2Team1);
      scheduleSheet.getRange(sfbRows[1] + 1, 3).setValue(sfb2Team2);
      populated = true;
    }
  }
  
  return { populated: populated };
}

/**
 * Populate Final
 */
function populateFinal(scheduleSheet, teamGames) {
  const data = scheduleSheet.getDataRange().getValues();
  let populated = false;
  
  // Find Final row
  let finalRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === "Final") {
      finalRow = i;
      break;
    }
  }
  
  if (finalRow === -1) {
    return { populated: false };
  }
  
  // Get SF matchups
  const sfRows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === "Semifinals") {
      sfRows.push({ team1: data[i][1], team2: data[i][2] });
    }
  }
  
  if (sfRows.length < 2) {
    return { populated: false };
  }
  
  // Winner of SF1 vs Winner of SF2
  const finalTeam1 = getWinner(teamGames, "Semifinals", sfRows[0].team1, sfRows[0].team2);
  const finalTeam2 = getWinner(teamGames, "Semifinals", sfRows[1].team1, sfRows[1].team2);
  
  if (finalTeam1 && finalTeam2) {
    const team1 = data[finalRow][1];
    const team2 = data[finalRow][2];
    
    if ((!team1 || team1 === "" || team1 === "-") && 
        (!team2 || team2 === "" || team2 === "-")) {
      scheduleSheet.getRange(finalRow + 1, 2).setValue(finalTeam1);
      scheduleSheet.getRange(finalRow + 1, 3).setValue(finalTeam2);
      populated = true;
    }
  }
  
  return { populated: populated };
}

/**
 * Populate Bronze
 */
function populateBronze(scheduleSheet, teamGames) {
  const data = scheduleSheet.getDataRange().getValues();
  let populated = false;
  
  // Find Bronze row
  let bronzeRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === "Bronze") {
      bronzeRow = i;
      break;
    }
  }
  
  if (bronzeRow === -1) {
    return { populated: false };
  }
  
  // Get SF matchups
  const sfRows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === "Semifinals") {
      sfRows.push({ team1: data[i][1], team2: data[i][2] });
    }
  }
  
  if (sfRows.length < 2) {
    return { populated: false };
  }
  
  // Get losers
  function getLoser(round, team1, team2) {
    const winner = getWinner(teamGames, round, team1, team2);
    if (!winner) return null;
    if (winner === team1) return team2;
    if (winner === team2) return team1;
    return null;
  }
  
  // Loser of SF1 vs Loser of SF2
  const bronzeTeam1 = getLoser("Semifinals", sfRows[0].team1, sfRows[0].team2);
  const bronzeTeam2 = getLoser("Semifinals", sfRows[1].team1, sfRows[1].team2);
  
  if (bronzeTeam1 && bronzeTeam2) {
    const team1 = data[bronzeRow][1];
    const team2 = data[bronzeRow][2];
    
    if ((!team1 || team1 === "" || team1 === "-") && 
        (!team2 || team2 === "" || team2 === "-")) {
      scheduleSheet.getRange(bronzeRow + 1, 2).setValue(bronzeTeam1);
      scheduleSheet.getRange(bronzeRow + 1, 3).setValue(bronzeTeam2);
      populated = true;
    }
  }
  
  return { populated: populated };
}

/**
 * Populate Final B (for AB Playoffs)
 */
function populateFinalB(scheduleSheet, teamGames) {
  const data = scheduleSheet.getDataRange().getValues();
  let populated = false;
  
  // Find Final B row
  let finalbRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === "Final B") {
      finalbRow = i;
      break;
    }
  }
  
  if (finalbRow === -1) {
    return { populated: false };
  }
  
  // Get SFB matchups
  const sfbRows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === "Semifinals B") {
      sfbRows.push({ team1: data[i][1], team2: data[i][2] });
    }
  }
  
  if (sfbRows.length < 2) {
    return { populated: false };
  }
  
  // Winner of SFB1 vs Winner of SFB2
  const finalbTeam1 = getWinner(teamGames, "Semifinals B", sfbRows[0].team1, sfbRows[0].team2);
  const finalbTeam2 = getWinner(teamGames, "Semifinals B", sfbRows[1].team1, sfbRows[1].team2);
  
  if (finalbTeam1 && finalbTeam2) {
    const team1 = data[finalbRow][1];
    const team2 = data[finalbRow][2];
    
    if ((!team1 || team1 === "" || team1 === "-") && 
        (!team2 || team2 === "" || team2 === "-")) {
      scheduleSheet.getRange(finalbRow + 1, 2).setValue(finalbTeam1);
      scheduleSheet.getRange(finalbRow + 1, 3).setValue(finalbTeam2);
      populated = true;
    }
  }
  
  return { populated: populated };
}

/**
 * Populate Bronze B (for AB Playoffs)
 */
function populateBronzeB(scheduleSheet, teamGames) {
  const data = scheduleSheet.getDataRange().getValues();
  let populated = false;
  
  // Find Bronze B row
  let bronzebRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === "Bronze B") {
      bronzebRow = i;
      break;
    }
  }
  
  if (bronzebRow === -1) {
    return { populated: false };
  }
  
  // Get SFB matchups
  const sfbRows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === "Semifinals B") {
      sfbRows.push({ team1: data[i][1], team2: data[i][2] });
    }
  }
  
  if (sfbRows.length < 2) {
    return { populated: false };
  }
  
  // Get losers
  function getLoser(round, team1, team2) {
    const winner = getWinner(teamGames, round, team1, team2);
    if (!winner) return null;
    if (winner === team1) return team2;
    if (winner === team2) return team1;
    return null;
  }
  
  // Loser of SFB1 vs Loser of SFB2
  const bronzebTeam1 = getLoser("Semifinals B", sfbRows[0].team1, sfbRows[0].team2);
  const bronzebTeam2 = getLoser("Semifinals B", sfbRows[1].team1, sfbRows[1].team2);
  
  if (bronzebTeam1 && bronzebTeam2) {
    const team1 = data[bronzebRow][1];
    const team2 = data[bronzebRow][2];
    
    if ((!team1 || team1 === "" || team1 === "-") && 
        (!team2 || team2 === "" || team2 === "-")) {
      scheduleSheet.getRange(bronzebRow + 1, 2).setValue(bronzebTeam1);
      scheduleSheet.getRange(bronzebRow + 1, 3).setValue(bronzebTeam2);
      populated = true;
    }
  }
  
  return { populated: populated };
}

// ═══════════════════════════════════════════════════════════════════════════
// Trigger Management Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check the status of all required triggers and config prerequisites
 * Returns an object indicating what needs to be installed
 */
function checkTriggerStatus() {
  const triggers = ScriptApp.getProjectTriggers();
  const triggerFunctions = triggers.map(t => t.getHandlerFunction());

  // Check which triggers exist
  const hasAutomation = triggerFunctions.includes('processMsgQueue');
  const hasReminders = triggerFunctions.includes('sendTodayGameReminders') && 
                       triggerFunctions.includes('sendUnscheduledGamesReminder');
  const hasAutoImport = triggerFunctions.includes('autoImportGames');
  const hasFixMe = triggerFunctions.includes('sendFixMeNotification');

  // Check config prerequisites
  let missingRoleIds = false;
  let missingAdminWebhook = false;

  // Check if all teams have Discord Role IDs
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Teams");
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const roleCol = headers.indexOf("Discord Role ID");
    const nameCol = headers.indexOf("Team Name");
    
    if (roleCol !== -1 && nameCol !== -1) {
      for (let i = 1; i < data.length; i++) {
        const teamName = data[i][nameCol];
        const roleId = data[i][roleCol];
        if (teamName && !roleId) {
          missingRoleIds = true;
          break;
        }
      }
    } else {
      missingRoleIds = true;
    }
  }

  // Check if Discord admin webhook is configured
  const config = getConfiguration();
  if (!config["Discord admin channel webhook"]) {
    missingAdminWebhook = true;
  }

  return {
    // What needs installation
    needsAutomation: !hasAutomation,
    needsReminders: !hasReminders,
    needsAutoImport: !hasAutoImport,
    needsFixMe: !hasFixMe,
    // What is installed
    hasAutomation,
    hasReminders,
    hasAutoImport,
    hasFixMe,
    // Config issues
    missingRoleIds,
    missingAdminWebhook
  };
}

/**
 * Install the processMsgQueue trigger (every 5 minutes)
 */
function installAutomationTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  
  // Check if trigger already exists
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'processMsgQueue') {
      return '✅ Automation trigger already installed';
    }
  }

  // Create the trigger
  ScriptApp.newTrigger('processMsgQueue')
    .timeBased()
    .everyMinutes(5)
    .create();

  return '✅ Automation trigger installed successfully';
}

/**
 * Install reminder triggers (daily between 10-11am)
 */
function installRemindersTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  const existing = triggers.map(t => t.getHandlerFunction());

  let installed = [];

  // Install sendTodayGameReminders if missing
  if (!existing.includes('sendTodayGameReminders')) {
    ScriptApp.newTrigger('sendTodayGameReminders')
      .timeBased()
      .atHour(10)
      .everyDays(1)
      .create();
    installed.push('sendTodayGameReminders');
  }

  // Install sendUnscheduledGamesReminder if missing
  if (!existing.includes('sendUnscheduledGamesReminder')) {
    ScriptApp.newTrigger('sendUnscheduledGamesReminder')
      .timeBased()
      .atHour(10)
      .everyDays(1)
      .create();
    installed.push('sendUnscheduledGamesReminder');
  }

  if (installed.length === 0) {
    return '✅ Game reminder triggers already installed';
  }

  return `✅ Installed: ${installed.join(', ')}`;
}

/**
 * Install autoImportGames trigger (every 30 minutes)
 */
function installAutoImportTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  
  // Check if trigger already exists
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'autoImportGames') {
      return '✅ Auto import trigger already installed';
    }
  }

  // Create the trigger
  ScriptApp.newTrigger('autoImportGames')
    .timeBased()
    .everyMinutes(30)
    .create();

  return '✅ Auto import trigger installed successfully';
}

/**
 * Install sendFixMeNotification trigger (daily between 10-11am)
 */
function installFixMeTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  
  // Check if trigger already exists
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'sendFixMeNotification') {
      return '✅ Fix-Me notification trigger already installed';
    }
  }

  // Create the trigger
  ScriptApp.newTrigger('sendFixMeNotification')
    .timeBased()
    .atHour(10)
    .everyDays(1)
    .create();

  return '✅ Fix-Me notification trigger installed successfully';
}

/**
 * Uninstall reminder triggers
 */
function uninstallRemindersTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = [];

  for (const trigger of triggers) {
    const funcName = trigger.getHandlerFunction();
    if (funcName === 'sendTodayGameReminders' || funcName === 'sendUnscheduledGamesReminder') {
      ScriptApp.deleteTrigger(trigger);
      removed.push(funcName);
    }
  }

  if (removed.length === 0) {
    return '✅ Game reminder triggers already uninstalled';
  }

  return `✅ Uninstalled: ${removed.join(', ')}`;
}

/**
 * Uninstall autoImportGames trigger
 */
function uninstallAutoImportTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'autoImportGames') {
      ScriptApp.deleteTrigger(trigger);
      return '✅ Auto import trigger uninstalled successfully';
    }
  }

  return '✅ Auto import trigger already uninstalled';
}

/**
 * Uninstall sendFixMeNotification trigger
 */
function uninstallFixMeTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'sendFixMeNotification') {
      ScriptApp.deleteTrigger(trigger);
      return '✅ Fix-Me notification trigger uninstalled successfully';
    }
  }

  return '✅ Fix-Me notification trigger already uninstalled';
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX-ME Issue Fixing Functions
// ═══════════════════════════════════════════════════════════════════════════

function onSelectionChange(e) {
  const sheet = e.range.getSheet();
  
  if (sheet.getName() !== "FIX-ME") {
    PropertiesService.getDocumentProperties()
      .deleteProperty("CURRENT_FIXME_SELECTION");
    return;
  }

  const row = e.range.getRow();
  const issueData = getFixMeIssueForRow(row);

  PropertiesService.getDocumentProperties()
    .setProperty(
      "CURRENT_FIXME_SELECTION",
      JSON.stringify(issueData)
    );
}

function getFixMeIssueForRow(row) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const activeSheet = ss.getSheetByName("FIX-ME");
  
  if (!activeSheet || row < 2) {
    return { canFix: false, message: "Please select a data row (not the header)" };
  }

  const rowData = activeSheet.getRange(row, 1, 1, 2).getValues()[0];
  const issueType = rowData[0];
  const value = rowData[1];

  if (!issueType || !value) {
    return { canFix: false, message: "Selected row is empty" };
  }

  if (issueType !== "Unmatched Player" && issueType !== "Unmatched Team Tag") {
    return { canFix: false, message: "Unknown issue type" };
  }

  const targets = [];

  if (issueType === "Unmatched Player") {
    const playersSheet = ss.getSheetByName("Players");
    if (playersSheet && playersSheet.getLastRow() > 1) {
      const playersData = playersSheet
        .getRange(2, 3, playersSheet.getLastRow() - 1, 1)
        .getValues();

      playersData.forEach((r, i) => {
        if (r[0]) {
          targets.push({
            name: r[0],
            row: i + 2,
            sheet: "Players"
          });
        }
      });
    }

    const standinsSheet = ss.getSheetByName("Standins");
    if (standinsSheet && standinsSheet.getLastRow() > 1) {
      const standinsData = standinsSheet
        .getRange(2, 3, standinsSheet.getLastRow() - 1, 1)
        .getValues();

      standinsData.forEach((r, i) => {
        if (r[0]) {
          targets.push({
            name: r[0] + " (Standin)",
            row: i + 2,
            sheet: "Standins"
          });
        }
      });
    }

  } else {
    const teamsSheet = ss.getSheetByName("Teams");
    if (teamsSheet && teamsSheet.getLastRow() > 1) {
      const teamsData = teamsSheet
        .getRange(2, 2, teamsSheet.getLastRow() - 1, 1)
        .getValues();

      teamsData.forEach((r, i) => {
        if (r[0]) {
          targets.push({
            name: r[0],
            row: i + 2,
            sheet: "Teams"
          });
        }
      });
    }
  }

  if (targets.length === 0) {
    return { 
      canFix: false,
      message: issueType === "Unmatched Player"
        ? "No players or standins found"
        : "No teams found"
    };
  }

  return {
    canFix: true,
    issueType,
    value: String(value).trim(),
    row,
    targets
  };
}

/**
 * Get the currently selected issue from the FIX-ME sheet
 * Returns an object with issue details and list of Players/Teams to choose from
 */
function getSelectedFixMeIssue() {
  const prop = PropertiesService
    .getDocumentProperties()
    .getProperty("CURRENT_FIXME_SELECTION");

  return prop ? JSON.parse(prop) : 
    { canFix: false, message: "No row selected" };
}

/**
 * Refresh the current FIX-ME selection
 * Checks the currently selected row and updates the property
 */
function refreshCurrentFixMeSelection() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const activeSheet = ss.getActiveSheet();
  
  // Only refresh if FIX-ME sheet is active
  if (!activeSheet || activeSheet.getName() !== "FIX-ME") {
    PropertiesService.getDocumentProperties()
      .deleteProperty("CURRENT_FIXME_SELECTION");
    return;
  }
  
  const activeRange = activeSheet.getActiveRange();
  if (!activeRange) {
    PropertiesService.getDocumentProperties()
      .deleteProperty("CURRENT_FIXME_SELECTION");
    return;
  }
  
  const row = activeRange.getRow();
  const issueData = getFixMeIssueForRow(row);
  
  PropertiesService.getDocumentProperties()
    .setProperty(
      "CURRENT_FIXME_SELECTION",
      JSON.stringify(issueData)
    );
}

/**
 * Fix the currently selected issue by adding the tag to the selected Player/Team
 * @param {number} targetRow - The row number in the Players/Standins/Teams sheet to update
 */
function fixSelectedFixMeIssue(targetRow) {
  const issue = getSelectedFixMeIssue();
  
  if (!issue.canFix) {
    throw new Error(issue.message);
  }
  
  // Find the selected target
  const target = issue.targets.find(t => t.row === targetRow);
  if (!target) {
    throw new Error("Invalid target selected");
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(target.sheet);
  
  if (!sheet) {
    throw new Error(`${target.sheet} sheet not found`);
  }
  
  if (issue.issueType === "Unmatched Player") {
    // Update Game Nicks column (column B, index 2)
    const currentNicks = sheet.getRange(targetRow, 2).getValue();
    let newNicks = issue.value;
    
    if (currentNicks) {
      // Check if nick already exists
      const nicksArray = String(currentNicks).toLowerCase().split(',').map(n => n.trim());
      if (nicksArray.includes(issue.value.toLowerCase())) {
        throw new Error(`Game nick "${issue.value}" already exists for ${target.name}`);
      }
      newNicks = currentNicks + ',' + issue.value;
    }
    
    sheet.getRange(targetRow, 2).setValue(newNicks);
    
    // Update stats and return
    updateStats(true);
    
    // Refresh the selection for the currently active row
    refreshCurrentFixMeSelection();
    
    return `✅ Added "${issue.value}" to ${target.name}'s Game Nicks. Stats updated.`;
    
  } else if (issue.issueType === "Unmatched Team Tag") {
    // Update Team Tag column (column A, index 1)
    const currentTags = sheet.getRange(targetRow, 1).getValue();
    let newTags = issue.value;
    
    if (currentTags) {
      // Check if tag already exists
      const tagsArray = String(currentTags).split('‡').map(t => t.trim());
      if (tagsArray.includes(issue.value)) {
        throw new Error(`Team tag "${issue.value}" already exists for ${target.name}`);
      }
      newTags = currentTags + '‡' + issue.value;
    }
    
    sheet.getRange(targetRow, 1).setValue(newTags);
    
    // Update stats and return
    updateStats(true);
    
    // Refresh the selection for the currently active row
    refreshCurrentFixMeSelection();
    
    return `✅ Added "${issue.value}" to ${target.name}'s Team Tags. Stats updated.`;
  }
  
  throw new Error("Unknown issue type");
}
