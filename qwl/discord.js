function postToDiscord(mode = 'post') {
  const ui = SpreadsheetApp.getUi(); 
  const sheet = SpreadsheetApp.getActiveSpreadsheet();

  // --- Get Round Number from Discord Sheet ---
  const discordSheet = sheet.getSheetByName('Discord');
  const roundNumber = discordSheet.getRange('B1').getValue();   
    
  // --- Get Players Sheet Data ---
  const playersSheet = sheet.getSheetByName('Players');
  const dataRange = playersSheet.getDataRange().getValues();

  // --- Map of Team Codes to Team Names & Emojis ---
  const teamMap = {
    'TEAM1': { name: 'Team1', emoji: 'T1️⃣', color: 4 },
    'TEAM2': { name: 'Team2', emoji: 'T2️⃣', color: 13 },
    'VIOLET': { name: 'Violet', emoji: '🟣', color: 9 },
    'MINT': { name: 'Mint', emoji: '🌿', color: 11 },
    'YELLOW': { name: 'Yellow', emoji: '🟡', color: 12 },
    'GREEN': { name: 'Green', emoji: '🟢', color: 3 },
    'BROWN': { name: 'Brown', emoji: '🟤', color: 1 },
    'PINK': { name: 'Pink', emoji: '🌸', color: 6 },
    'SKYBLUE': { name: 'Skyblue', emoji: '🔵', color: 2 },
    'ORANGE': { name: 'Orange', emoji: '🟠', color: 5 } // Add Team Orange if missing
  };

  // --- Prepare Teams and Players Mapping ---
  const teamsPlayers = {};

  for (let i = 1; i < dataRange.length; i++) { // Skip header
    const teamCode = dataRange[i][0].toUpperCase();
    const playerName = dataRange[i][2];

    if (teamMap[teamCode]) {
      if (!teamsPlayers[teamCode]) {
        teamsPlayers[teamCode] = [];
      }
      teamsPlayers[teamCode].push(playerName);
    }
  }
  
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
  //const formattedDeadline = Utilities.formatDate(deadline, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // --- Fetch Opponents from Schedule (A:C) ---
  const roundSchedule = scheduleData.slice(1).filter(row => row[0] == roundNumber);

  const opponents = {};
  roundSchedule.forEach(row => {
    const team1 = row[1].toUpperCase();
    const team2 = row[2].toUpperCase();
    opponents[team1] = team2;
    opponents[team2] = team1;
  });  
  
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
  
  // --- Prepare Message ---
  const roundEmoji = numberEmojis[roundNumber] || roundNumber;
  
  //let message = `@everyone\n\n**This is ${roundEmoji}**\n\n`;
  let message = `**This is ${roundEmoji}**\n\n`;
  var playoffs = false;
  
  if (['Quarterfinals', 'Semifinals', 'Semifinals A', 'Semifinals B', 'Final', 'Final A', 'Final B', 'Bronze', 'Bronze A', 'Bronze B'].includes(roundNumber)) {
    playoffs = true;
    message += `**📢 Upcoming Playoff Matches This Week!**\n\n`;

    var playoffInstructions = 
      `**🏆 Playoff Match Procedure:**  
      Playoff is BO5 (Best of 5), first to win 3 maps wins. A map can only be played once.  

      1️⃣ Do \`cmd rnd (team1 team2)\` to decide who picks the first map.  
      2️⃣ Each team gets 2 picks each.  
      3️⃣ If a team is down 0-2 in maps, they pick the 3rd map.  
      4️⃣ If it's 1-2 after the 3rd map, the other team picks the 4th map.  
      5️⃣ If it becomes 2-2, do \`cmd rnd (map1 map2)\` to decide the 5th map — unless both teams agree on the decider map.`;
      
  } else {
    //message += `**📢 Upcoming Teams This Week!**\n\n`;
    message += `**📢 Upcoming Game!**\n\n`;
  }
  
  const sortedTeamCodes = Object.keys(teamsPlayers).sort();

  sortedTeamCodes.forEach(code => {
    const { name, emoji, color } = teamMap[code];
    const playersList = teamsPlayers[code].join(', ');

    const opponentCode = opponents[name.toUpperCase()];

    if (opponentCode) {
      const opponentName = opponentCode.charAt(0).toUpperCase() + opponentCode.slice(1).toLowerCase();
      message += `${emoji} **${name}** /color ${color}\nPlayers: ${playersList}\nOpponent: ${opponentName}\n\n`;
    } else {
      //message += `${emoji} **${name}** /color ${color}\nPlayers: ${playersList}\nOpponent: Not found\n\n`;
    }
  });

  message += `**Maps:** ${mapList}\n\n**Date:** ${deadline}\n\n`;
  //message += `\`\`\`diff\n- Use your team's channel to get your team mates availability and start arranging games with your opponent!\n\`\`\`\n\n`;  
  message += `\`\`\`diff\n- When reporting games please include hub game links (URLs) in your report!\n\`\`\`\n\n`;
  
  if (playoffs) {    
    message += `${playoffInstructions}\n\n`;
    message += `❗ Remember: ** Teams stay fixed during playoffs.**\n\n`;
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