function postToDiscord(mode = 'post') {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet();
  
  const discordSheet = sheet.getSheetByName('Discord');
      
  // --- Fetch Schedule Sheet Data ---
  const scheduleSheet = sheet.getSheetByName('Schedule');
  const scheduleConfigSheet = sheet.getSheetByName('ScheduleConfig');
  const scheduleData = scheduleSheet.getDataRange().getValues();
  const scheduleConfigData = scheduleConfigSheet.getDataRange().getValues();
  
  // -------------------------------------------------------
  // Read Discord Config (key -> value)
  // -------------------------------------------------------
  const lastRow = discordSheet.getLastRow();
  const configData = discordSheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const config = {};
  configData.forEach(([key, value]) => {
    if (key) config[String(key).trim()] = value;
  });

  const roundNumber = config["Round"];
  if (!roundNumber) {
    throw new Error("Missing 'Round' in Discor config");
  }

  const playOffTreeURL = config["Playoff tree"];
  
  const rankingURL = config["Web App deployment URL"];
  if (!rankingURL) {
    throw new Error("Missing 'Web App deployment URL' in Discor config");
  }

  const webhookUrl = config["Discord web hook"];
  if (!webhookUrl) {
    throw new Error("Missing 'Discord web hook' in Discor config");
  }
  
  // --- Fetch Maps and Deadline from Schedule Config ---
  const roundConfigRow = scheduleConfigData.slice(1).find(row => row[0] == roundNumber);

  if (!roundConfigRow) {
    ui.alert(`Round ${roundNumber} not found in Schedule Config sheet.`);
    return;
  }

  const mapList = roundConfigRow[1]; // Column B (index 1)
  const deadline = roundConfigRow[2]; // Column C (index 2)
  
  // --- Fetch Opponents from Schedule (A:C) ---
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
    'Quarterfinals': 'the Quarterfinals! 🎉',
    'Semifinals': 'the Semifinals! 🚀',
    'Semifinals A': 'the Semifinals A! 🚀',
    'Semifinals B': 'the Semifinals B! 🚀',
    'Final': 'the Final! 🥇',
    'Final A': 'the Final A! 🥇',
    'Final B': 'the Final B! 🥇',
    'Bronze' : 'the Bronze Match! 🥉',
    'Bronze A' : 'the Bronze A Match! 🥉',
    'Bronze B' : 'the Bronze B Match! 🥉',
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

  // --- BUILD MATCH MESSAGE ---
  let matchLines = [];
  const alreadyListed = new Set();
  
  const teamsSheet = sheet.getSheetByName('Teams');
  const lastTeamsRow = teamsSheet.getLastRow();
  const teamsData = teamsSheet.getRange(2, 2, lastTeamsRow - 1, 2).getValues();
  const teams = {};
  teamsData.forEach(([key, value]) => {
    if (key) teams[String(key).trim()] = value;
  });
   
  for (const team in opponents) {
    if (alreadyListed.has(team)) continue;

    const opp = opponents[team];
    if (config["Include players list"] == 'Yes') {
      matchLines.push(`**${team}** (${teams[team]})\n    vs\n**${opp}** (${teams[opp]})\n`);
    } else {
      matchLines.push(`• **${team}** vs **${opp}**`);
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

  if (playoffs && playOffTreeURL) {    
    message += `[Playoff tree](${playOffTreeURL})\n\n`;
  }
  
  message += `[${config["Ranking title"]}](${rankingURL})\n\n`;
  message += `GL HF! 🎮`;

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
  } catch (e) {
    ui.alert('❌ Failed to post to Discord: ' + e.message);
    logPostHistory(message, 'Failed');
  }
}