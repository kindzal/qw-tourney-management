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

      currentDeadline = addDays(currentDeadline, 7);
    });
  }

  // ---- WRITE SHEETS ----
  writeSchedule(scheduleSheet, scheduleRows);
  writeScheduleConfig(configSheet, configRows);

  return "Schedule generated successfully.";
}

function generatePlayoffsStructure(type) {

  if (type === "Single Elimination") {
    return [
      { name: "Quarterfinals", matches: Array(4) },
      { name: "Semifinals", matches: Array(2) },
      { name: "Final", matches: Array(1) },
      { name: "Bronze", matches: Array(1) }
    ];
  }

  if (type === "AB Playoffs") {
    return [
      { name: "Quarterfinals", matches: Array(4) },
      { name: "Semifinals", matches: Array(2) },
      { name: "Semifinals B", matches: Array(2) },
      { name: "Final", matches: Array(1) },
      { name: "Final B", matches: Array(1) },
      { name: "Bronze", matches: Array(1) },
      { name: "Bronze B", matches: Array(1) }
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


