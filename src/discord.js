function postToDiscord(mode = 'post', roundNumber = null) {
  const ui = SpreadsheetApp.getUi();
  
  // Round is now passed as parameter (from sidebar dropdown)
  if (!roundNumber) {
    throw new Error("Round not specified. Please select a round from the dropdown.");
  }
  
  // Build the message
  const { message, webhookUrl } = buildScheduleMessage(roundNumber);

  // --- Preview Mode ---
  if (mode === 'preview') {
    ui.showModalDialog(
      HtmlService.createHtmlOutput(`<pre style="white-space: pre-wrap;">${message}</pre>`)
        .setWidth(700)
        .setHeight(820),
      'Discord Post Preview'
    );
    return;
  }

  // --- Confirm Before Posting ---
  const response = ui.alert('Are you sure you want to post this update to Discord?', ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) {
    ui.alert('Post cancelled.');
    return;
  }

  // --- Post to Discord --- 
  try {
    const payload = JSON.stringify({ content: message });

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: payload,
    };

    UrlFetchApp.fetch(webhookUrl, options);

    ui.alert('Message successfully posted to Discord! ✅');
    logPostHistory(message, 'Success');
    
    // Mark this round's Schedule Info as Sent
    markScheduleInfoSent(roundNumber);
  } catch (e) {
    ui.alert('❌ Failed to post to Discord: ' + e.message);
    logPostHistory(message, 'Failed');
  }
}

/**
 * Builds the Discord schedule message for a given round.
 * @param {string} roundNumber - The round to build message for
 * @returns {Object} - { message: string, webhookUrl: string }
 */
function buildScheduleMessage(roundNumber) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const discordSheet = ss.getSheetByName('Discord');
  const scheduleSheet = ss.getSheetByName('Schedule');
  const scheduleConfigSheet = ss.getSheetByName('ScheduleConfig');
  const scheduleData = scheduleSheet.getDataRange().getValues();
  const scheduleConfigData = scheduleConfigSheet.getDataRange().getValues();
  
  // Read Discord Config (key -> value)
  const lastRow = discordSheet.getLastRow();
  const configData = discordSheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const config = {};
  configData.forEach(([key, value]) => {
    if (key) config[String(key).trim()] = value;
  });
  
  // Read URL and webhook from Configuration tab
  const globalConfig = getConfiguration();
  
  const rankingURL = globalConfig["Discord Web App URL"] || globalConfig["Web App Deployment URL"];
  if (!rankingURL) {
    throw new Error("Missing 'Discord Web App URL' or 'Web App Deployment URL' in Configuration tab");
  }

  const webhookUrl = globalConfig["Discord Schedule Channel Webhook"];
  if (!webhookUrl) {
    throw new Error("Missing 'Discord Schedule Channel Webhook' in Configuration tab");
  }
  
  // Fetch Maps and Deadline from Schedule Config
  const roundConfigRow = scheduleConfigData.slice(1).find(row => row[0] == roundNumber);

  if (!roundConfigRow) {
    throw new Error(`Round ${roundNumber} not found in Schedule Config sheet.`);
  }

  const mapList = roundConfigRow[1];
  const deadline = roundConfigRow[2];
  
  // Fetch Opponents from Schedule
  const roundSchedule = scheduleData.slice(1).filter(row => row[0] == roundNumber);
  
  const numberEmojis = {
    0: 'round 0️⃣',
    1: 'round 1️⃣',
    2: 'round 2️⃣',
    3: 'round 3️⃣',
    4: 'round 4️⃣',
    5: 'round 5️⃣',
    6: 'round 6️⃣',
    7: 'round 7️⃣',
    8: 'round 8️⃣',
    9: 'round 9️⃣',
    10: 'round 🔟',
    11: 'round 1️⃣1️⃣',
    12: 'round 1️⃣2️⃣',
    13: 'round 1️⃣3️⃣',
    14: 'round 1️⃣4️⃣',
    15: 'round 1️⃣5️⃣',
    16: 'round 1️⃣6️⃣',
    17: 'round 1️⃣7️⃣',
    18: 'round 1️⃣8️⃣',
    19: 'round 1️⃣9️⃣',
    20: 'round 2️⃣0️⃣',
    'Quarterfinals': 'the Quarterfinals! 🎉',
    'Semifinals': 'the Semifinals! 🚀',
    'Semifinals A': 'the Semifinals A! 🚀',
    'Semifinals B': 'the Semifinals B! 🚀',
    'Final': 'the Final! 🥇',
    'Final A': 'the Final A! 🥇',
    'Final B': 'the Final B! 🥇',
    'Bronze': 'the Bronze Match! 🥉',
    'Bronze A': 'the Bronze A Match! 🥉',
    'Bronze B': 'the Bronze B Match! 🥉',
  };
  
  var playoffs = false;
  if (['Quarterfinals', 'Semifinals', 'Semifinals A', 'Semifinals B', 'Final', 'Final A', 'Final B', 'Bronze', 'Bronze A', 'Bronze B'].includes(roundNumber)) playoffs = true;

  const roundEmoji = numberEmojis[roundNumber] || roundNumber;
  
  const opponents = {};
  roundSchedule.forEach(row => {
    const team1 = row[1];
    const team2 = row[2];
    opponents[team1] = team2;
    opponents[team2] = team1;
  });

  // BUILD MATCH MESSAGE
  let matchLines = [];
  const alreadyListed = new Set();
  
  // Read teams and role IDs in one go
  const teamsSheet = ss.getSheetByName('Teams');
  const lastTeamsRow = teamsSheet.getLastRow();
  const teamsData = teamsSheet.getRange(2, 2, lastTeamsRow - 1, 5).getValues();
  const teams = {};
  const teamRoles = {};
  teamsData.forEach(([name, players, roleId]) => {
    if (name) teams[String(name).trim()] = players;
    if (name && roleId) teamRoles[String(name).trim()] = roleId;
  });

  for (const team in opponents) {
    if (alreadyListed.has(team)) continue;

    const opp = opponents[team];
    // Replace team name with Discord role mention if roleId is set
    const teamMention = teamRoles[team] ? `<@&${teamRoles[team]}>` : `**${team}**`;
    const oppMention = teamRoles[opp] ? `<@&${teamRoles[opp]}>` : `**${opp}**`;
    if (config["Include players list"] == 'Yes') {
      matchLines.push(`${teamMention} (${teams[team]})\n    vs\n${oppMention} (${teams[opp]})\n`);
    } else {
      matchLines.push(`• ${teamMention} vs ${oppMention}`);
    }
    alreadyListed.add(team);
    alreadyListed.add(opp);
  }
  
  let message = '';

  if (config["Everyone spam"] == 'Yes')
    message += '@everyone\n\n';
  
  message += `**This is ${roundEmoji}**\n\n`;

  if (playoffs) {
    message += (config["Playoff msg"]);
    message += `\n\n${matchLines.join("\n")}\n\n`;
    
    if (config["Playoff match procedure"]) {
      message += `**🏆 Playoff Match Procedure**\n`;
      message += config["Playoff match procedure"];
    }
  } else {
    message += (config["Group stage msg"]);
    message += `\n\n${matchLines.join("\n")}\n\n`;
    
    if (config["Group match procedure"]) {
      message += `**🎾 Group Stage Match Procedure**\n`;
      message += config["Group match procedure"];
    }
  }
  message += `\n\n`;
  message += `**Maps:** ${mapList}\n\n`;
  if (deadline) message += `${config["Deadline msg"]} ${deadline}\n\n`;
  
  if (config["Reporting prompt"])
    message += `\`\`\`diff\n- ${config["Reporting prompt"]}\n\`\`\`\n`;

  if (config["Scheduling prompt"])
    message += `\`\`\`diff\n- ${config["Scheduling prompt"]}\n\`\`\`\n`;

  if (config["Team tags prompt"])
    message += `\`\`\`diff\n- ${config["Team tags prompt"]}\n\`\`\`\n`;
  
  message += `[${config["Ranking title"]}](${rankingURL})\n\n`;
  message += `GL HF! 🎮`;

  return { message, webhookUrl };
}

/**
 * Mark a round's 'Schedule Info Sent' column as 'Yes' in ScheduleConfig
 */
function markScheduleInfoSent(roundNumber) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("ScheduleConfig");
  
  if (!sheet) return;
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const roundIdx = headers.indexOf("Round");
  const sentIdx = headers.indexOf("Schedule Info Sent");
  
  if (roundIdx === -1 || sentIdx === -1) return;
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][roundIdx]).trim() === String(roundNumber).trim()) {
      sheet.getRange(i + 1, sentIdx + 1).setValue("Yes");
      break;
    }
  }
}

/**
 * Automatic Discord schedule posting - designed for time-based triggers.
 * Finds the current round (deadline >= today), then checks if Schedule Info Sent = 'No'.
 * Only posts if not yet sent.
 * 
 * @returns {Object} - Result with status and message
 */
function autoPostScheduleToDiscord() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const scheduleConfigSheet = ss.getSheetByName('ScheduleConfig');
  
  if (!scheduleConfigSheet) {
    Logger.log('autoPostScheduleToDiscord: ScheduleConfig sheet not found');
    return { success: false, message: 'ScheduleConfig sheet not found' };
  }
  
  const now = new Date();
  const data = scheduleConfigSheet.getDataRange().getValues();
  const headers = data[0];
  
  const roundIdx = headers.indexOf('Round');
  const deadlineIdx = headers.indexOf('Deadline');
  const sentIdx = headers.indexOf('Schedule Info Sent');
  
  if (roundIdx === -1 || deadlineIdx === -1) {
    Logger.log('autoPostScheduleToDiscord: Required columns not found');
    return { success: false, message: 'Required columns not found' };
  }
  
  // Find the current round (deadline is today or in the future)
  let targetRound = null;
  let targetSent = null;
  
  for (let i = 1; i < data.length; i++) {
    const round = data[i][roundIdx];
    const deadlineVal = data[i][deadlineIdx];
    const sent = sentIdx !== -1 ? String(data[i][sentIdx] || 'No').trim() : 'No';
    
    if (!round || round === '') continue;
    
    // Parse deadline and treat it as end-of-day (23:59:59)
    const deadline = parseDeadline(deadlineVal);
    if (!deadline) continue;
    deadline.setHours(23, 59, 59, 999);
    
    if (deadline >= now) {
      targetRound = String(round).trim();
      targetSent = sent;
      break; // Found the current round
    }
  }
  
  if (!targetRound) {
    Logger.log('autoPostScheduleToDiscord: No current or upcoming rounds found');
    return { success: false, message: 'No current or upcoming rounds found' };
  }
  
  // Check if already sent for this round
  if (targetSent === 'Yes') {
    Logger.log(`autoPostScheduleToDiscord: Round ${targetRound} schedule info already sent`);
    return { success: false, message: `Round ${targetRound} schedule info already sent` };
  }
  
  // Post the schedule for the target round
  try {
    postToDiscordSilent(targetRound);
    Logger.log(`autoPostScheduleToDiscord: Successfully posted schedule for round ${targetRound}`);
    return { success: true, message: `Posted schedule for round ${targetRound}` };
  } catch (e) {
    Logger.log(`autoPostScheduleToDiscord: Failed to post - ${e.message}`);
    return { success: false, message: e.message };
  }
}

/**
 * Silent version of postToDiscord - no UI prompts, designed for triggers.
 * Posts the schedule message for the specified round.
 * 
 * @param {string} roundNumber - The round to post
 */
function postToDiscordSilent(roundNumber) {
  const { message, webhookUrl } = buildScheduleMessage(roundNumber);

  // Post to Discord (no confirmation needed for trigger)
  const payload = JSON.stringify({ content: message });

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: payload,
  };

  UrlFetchApp.fetch(webhookUrl, options);

  logPostHistory(message, 'Success (Auto)');
  
  // Mark this round's Schedule Info as Sent
  markScheduleInfoSent(roundNumber);
}

function sendAvailabilityRequestsToDiscord() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Teams');
  const data = sheet.getDataRange().getValues();
  const ui = SpreadsheetApp.getUi();

  // --- Confirm Before Posting ---
  const response = ui.alert('Are you sure you want to post this to Discord?', ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) {
    ui.alert('Post cancelled.');
    return;
  }

  const DAYS = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday'
  ];

  // Start from row 2 (skip headers)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    const teamName = row[1];              // Team Name
    const roleId = row[4];                // Discord Role ID
    const webhookUrl = row[5];            // Discord Channel Webhook

    if (!webhookUrl || !roleId) continue;

    // 1️⃣ First message: role ping + instructions
    const introPayload = {
      content: `<@&${roleId}> react with 👍🏻👎🏻 to the days you are available/unavailable 👇.`
    };

    _postToDiscord(webhookUrl, introPayload);

    Utilities.sleep(800); // small delay to keep order clean

    // 2️⃣ One message per day
    DAYS.forEach(day => {
      const dayPayload = {
        content: day
      };

      _postToDiscord(webhookUrl, dayPayload);
      Utilities.sleep(500);
    });
  }
}

function _postToDiscord(webhookUrl, payload) {
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  UrlFetchApp.fetch(webhookUrl, options);
}

function getDiscordWebhookUrl() {
  const config = getConfiguration();
  const webhookUrl = config["Discord Schedule Channel Webhook"];
  
  if (!webhookUrl) {
    throw new Error("Missing 'Discord Schedule Channel Webhook' in Configuration tab");
  }
  
  return webhookUrl;
}

function sendTodayGameReminders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Schedule");
  if (!sheet) throw new Error("Schedule sheet not found");

  const webhookUrl = getDiscordWebhookUrl();
  const now = new Date();

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const team1Col = headers.indexOf("Team1");
  const team2Col = headers.indexOf("Team2");
  const scheduledCol = headers.indexOf("Scheduled For");
  const reminderCol = headers.indexOf("Reminder Sent");

  if ([team1Col, team2Col, scheduledCol, reminderCol].includes(-1)) {
    throw new Error("Schedule sheet missing required columns");
  }

  const gamesToday = [];
  const rowsToUpdate = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][reminderCol] == "Yes") continue;

    const parsed = parseScheduledFor(data[i][scheduledCol]);
    if (!parsed) continue;

    const isToday =
      parsed.day === now.getDate() &&
      parsed.month === now.getMonth() + 1 &&
      parsed.year === now.getFullYear();

    if (!isToday) continue;

    const isTonight = parsed.hour >= 17;
    const when = isTonight ? "tonight" : "today";

    const roleA = getRoleIdByTeamName(data[i][team1Col]);
    const roleB = getRoleIdByTeamName(data[i][team2Col]);

    const timePart = data[i][scheduledCol].split("@")[1].trim();

    gamesToday.push(
      `• <@&${roleA}> vs <@&${roleB}> — ${when} @ ${timePart}`
    );

    rowsToUpdate.push(i + 1);
  }

  if (!gamesToday.length) return;

  const message =
    `🔥 **Game Reminder** 🔥\n\n` +
    gamesToday.join("\n");

  UrlFetchApp.fetch(webhookUrl, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ content: message })
  });

  // Mark reminders as sent
  rowsToUpdate.forEach(row =>
    sheet.getRange(row, reminderCol + 1).setValue("Yes")
  );
}

function sendUnscheduledGamesReminder() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const scheduleSheet = ss.getSheetByName("Schedule");
  const configSheet = ss.getSheetByName("ScheduleConfig");
  
  if (!scheduleSheet) throw new Error("Schedule sheet not found");
  if (!configSheet) throw new Error("ScheduleConfig sheet not found");

  const webhookUrl = getDiscordWebhookUrl();
  const now = new Date();

  // Check if today is Wednesday or later (0=Sunday, 1=Monday, ..., 6=Saturday)
  const dayOfWeek = now.getDay();
  // Convert to Monday=1, Tuesday=2, Wednesday=3, ..., Sunday=7
  const mondayBasedDay = dayOfWeek === 0 ? 7 : dayOfWeek;
  
  if (mondayBasedDay < 3) return; // Exit if before Wednesday

  // Get current round based on deadline
  const configData = configSheet.getDataRange().getValues();
  const configHeaders = configData[0];
  const roundCol = configHeaders.indexOf("Round");
  const deadlineCol = configHeaders.indexOf("Deadline");

  if ([roundCol, deadlineCol].includes(-1)) {
    throw new Error("ScheduleConfig sheet missing required columns");
  }

  let currentRound = null;
  for (let i = 1; i < configData.length; i++) {
    const deadlineStr = configData[i][deadlineCol];
    const deadline = parseDeadline(deadlineStr);
    
    if (deadline && now <= deadline) {
      currentRound = configData[i][roundCol];
      break;
    }
  }

  if (currentRound === null) return; // No active round found

  // Find unscheduled games in current round
  const scheduleData = scheduleSheet.getDataRange().getValues();
  const scheduleHeaders = scheduleData[0];
  
  const roundColSchedule = scheduleHeaders.indexOf("Round");
  const team1Col = scheduleHeaders.indexOf("Team1");
  const team2Col = scheduleHeaders.indexOf("Team2");
  const scheduledCol = scheduleHeaders.indexOf("Scheduled For");

  if ([roundColSchedule, team1Col, team2Col, scheduledCol].includes(-1)) {
    throw new Error("Schedule sheet missing required columns");
  }

  const unscheduledGames = [];

  for (let i = 1; i < scheduleData.length; i++) {
    const round = scheduleData[i][roundColSchedule];
    const scheduledValue = scheduleData[i][scheduledCol];

    // Check if this row is in current round and not scheduled
    if (round == currentRound && !scheduledValue) {
      const roleA = getRoleIdByTeamName(scheduleData[i][team1Col]);
      const roleB = getRoleIdByTeamName(scheduleData[i][team2Col]);

      unscheduledGames.push(
        `• <@&${roleA}> vs <@&${roleB}>`
      );
    }
  }

  if (!unscheduledGames.length) return; // No unscheduled games

  const message =
    `⚠️ **Unscheduled Games - Round ${currentRound}** ⚠️\n\n` +
    `The following games still need to be scheduled:\n\n` +
    unscheduledGames.join("\n") +
    `\n\nPlease schedule your matches soon!`;

  UrlFetchApp.fetch(webhookUrl, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ content: message })
  });
}
  
function sendFixMeNotification() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── Read webhook from Configuration ───────────────────────────────────
  const configSheet = ss.getSheetByName("Configuration");
  if (!configSheet) return;

  const configData = configSheet.getRange(2, 1, configSheet.getLastRow() - 1, 2).getValues();
  const config = {};
  configData.forEach(([k, v]) => { if (k) config[String(k).trim()] = v; });

  const webhook = config["Discord admin channel webhook"];
  if (!webhook) return;

  const webAppTitle = config["WebApp title"] || "Tournament";

  // ── Read FIX-ME and group by Issue type ───────────────────────────────
  const fixMeSheet = ss.getSheetByName("FIX-ME");
  if (!fixMeSheet || fixMeSheet.getLastRow() < 2) return;

  const rows = fixMeSheet
    .getRange(2, 1, fixMeSheet.getLastRow() - 1, 2)
    .getValues();

  const counts = {};
  rows.forEach(([issue]) => {
    if (!issue || issue.startsWith("No issues")) return;
    counts[issue] = (counts[issue] || 0) + 1;
  });

  if (Object.keys(counts).length === 0) return;

  // ── Build message ─────────────────────────────────────────────────────
  const sheetUrl = ss.getUrl() + "#gid=" + fixMeSheet.getSheetId();

  const summary = Object.entries(counts)
    .map(([issue, count]) => `• ${issue}: **${count}**`)
    .join("\n");

  const message = [
    `⚠️ **[${webAppTitle}] Tournament Issues Found**`,
    "",
    summary,
    "",
    `Open [QWadmin](${sheetUrl}), navigate to FIX-ME tab and follow the instructions there.` 
  ].join("\n");

  // ── Post to Discord ───────────────────────────────────────────────────
  UrlFetchApp.fetch(webhook, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ content: message })
  });

  Logger.log(`sendFixMeNotification: posted ${Object.values(counts).reduce((a, b) => a + b, 0)} issue(s) to Discord`);    
}