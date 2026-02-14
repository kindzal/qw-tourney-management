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

function updateStatsUI() {
  Logger.log("Running updateStats (UPDATE_STATS handler)");
  updatePlayerAndStandinsStats();
  updateTeamStats();
  SpreadsheetApp.getUi().alert(
      `ℹ️ UpdateStats completed successfully.`
    );
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
