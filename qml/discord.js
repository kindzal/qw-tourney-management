function postToDiscord(mode = 'post') {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet();

  // --- Get Round Number from Discord Sheet ---
  const discordSheet = sheet.getSheetByName('Discord');
  const roundNumber = discordSheet.getRange('B1').getValue();   
    
  // --- Fetch Schedule Sheet Data ---
  const scheduleSheet = sheet.getSheetByName('Schedule');
  const scheduleConfigSheet = sheet.getSheetByName('ScheduleConfig');
  const scheduleData = scheduleSheet.getDataRange().getValues();
  const scheduleConfigData = scheduleConfigSheet.getDataRange().getValues();
  const playOffTreeURL = discordSheet.getRange('C2').getValue();
  const rankingURL = discordSheet.getRange('C4').getValue();
  const webhookUrl = discordSheet.getRange('C6').getValue();

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

   for (const team in opponents) {
      if (alreadyListed.has(team)) continue;

      const opp = opponents[team];
      matchLines.push(`• **${team}** vs **${opp}**`);
      alreadyListed.add(team);
      alreadyListed.add(opp);
   }
  
  let message = `@everyone\n\n**This is ${roundEmoji}**\n\n`;

  if (playoffs) {           

    message += `**📢 Upcoming Playoff Matches**\n\n${matchLines.join("\n")}\n\n`;  
    
    var gameProcedureInstructions = 
      `**🏆 Playoff Match Procedure**  
      BO5 (Best of 5) - first to win 3 maps wins.

      1️⃣ Do /rnd who to toss first.  
      2️⃣ Then: Team1 toss first, Team2 pick first. Team who lost the map picks next`;
  
  } else {    
    
    message += `**📢 Upcoming Group Stage Matches**\n\n${matchLines.join("\n")}\n\n`;  
    
    var gameProcedureInstructions = 
      `**🎾 Group Stage Match Procedure:**  
      GO3 (Game of 3) - 3 maps to be played.  

      1️⃣ Do /rnd who to toss first.  
      2️⃣ Then: Team1 toss first, Team2 pick first. Map 3: Do RND who toss first`;    

  }
  
  message += `**Maps:** ${mapList}\n\n`;
  if (deadline) message += `**Deadline:** ${deadline}\n\n`;
  
  message += `\`\`\`diff\n- Please make sure when reporting results you include hub game links (URLs) in your report!\n\`\`\`\n\n`;
  message += `\`\`\`diff\n- Also please use consistent /team tags in your games so the matching works correctly!\n\`\`\`\n\n`;
   
  
  message += `${gameProcedureInstructions}\n\n`;    

  if (playoffs) {    
    message += `[Playoff tree](${playOffTreeURL})\n\n`;
  }
  
  message += `[Current Standings & Player Ranking](${rankingURL})\n\n`;
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