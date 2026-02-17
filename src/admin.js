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
