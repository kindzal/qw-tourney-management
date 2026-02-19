function assertEquals(expected, actual) {
  if (expected !== actual) {
    throw new Error(`Assertion failed.
      Expected: ${expected}
      Actual:   ${actual}`);
  }
}

function testEnqueue() {
  enqueueMessageIfNew(
    "TEST-1",
    new Date().toISOString(),
    "SCHEDULE_GAME_REPORT",
    {
      teams: [{ id: "1438192225266831360", name: "violet" }, { id: "1438192783344009348", name:"green" }],
      scheduledAt: "10/02/26",
      rawText: "@VioletTeamPlayers vs @GreenTeamPlayers Thursday 12 Feb @ 21:00CET"
    }
  );
}

function testParseDateTime() {
  let result = parseDateTime("Sunday 22nd February @ 20:45CET");
  assertEquals("22/02/2026 @ 20:45 CET", result);

  result = parseDateTime("Sunday 22nd Feb @ 20:49CET");
  assertEquals("22/02/2026 @ 20:49 CET", result);

  result = parseDateTime("february 12th 21 cet");
  assertEquals("12/02/2026 @ 21:00 CET", result);

  result = parseDateTime("February 14th @ 20:30 cet");
  assertEquals("14/02/2026 @ 20:30 CET", result);

  result = parseDateTime("Thursday 12 Feb @ 21:00CET");
  assertEquals("12/02/2026 @ 21:00 CET", result);

  result = parseDateTime("this Friday @ 21:00");
  assertEquals("20/02/2026 @ 21:00 CET", result);

  result = parseDateTime("Friday 13 Feb @21:00CET");
  assertEquals("13/02/2026 @ 21:00 CET", result);

  result = parseDateTime("Friday 13 Feb @21:00CET");
  assertEquals("13/02/2026 @ 21:00 CET", result);

  result = parseDateTime("February 15th  @ 20:30 cet");
  assertEquals("15/02/2026 @ 20:30 CET", result);

  result = parseDateTime("tonight  @ 20:15 cet");
  assertEquals("13/02/2026 @ 20:15 CET", result);

  result = parseDateTime("today  @ 20:05 cet");
  assertEquals("13/02/2026 @ 20:05 CET", result);

  result = parseDateTime("tomorrow  @ 22:30 cet");
  assertEquals("14/02/2026 @ 22:30 CET", result);

  result = parseDateTime("tuesday  @ 22:30 cet");
  assertEquals("17/02/2026 @ 22:30 CET", result);
}

function testLevenshteinDistance() {
  // Identical strings
  assertEquals(0, levenshteinDistance("hello", "hello"));
  assertEquals(0, levenshteinDistance("Flamer", "flamer")); // Case insensitive
  
  // Empty strings
  assertEquals(5, levenshteinDistance("hello", ""));
  assertEquals(5, levenshteinDistance("", "world"));
  assertEquals(0, levenshteinDistance("", ""));
  
  // Single character edits
  assertEquals(1, levenshteinDistance("cat", "bat"));   // substitution
  assertEquals(1, levenshteinDistance("cat", "cats"));  // insertion
  assertEquals(1, levenshteinDistance("cats", "cat"));  // deletion
  
  // Multiple edits
  assertEquals(3, levenshteinDistance("kitten", "sitting"));
  assertEquals(2, levenshteinDistance("book", "back"));
}

function testLevenshteinSimilarity() {
  // Identical strings = 100%
  assertEquals(100, levenshteinSimilarity("hello", "hello"));
  assertEquals(100, levenshteinSimilarity("Flamer", "flamer"));
  
  // Completely different (same length)
  assertEquals(0, levenshteinSimilarity("abc", "xyz"));
  
  // Partial similarity - fl4m3r vs Flamer (6 chars each, 2 different = 66.67%)
  const similarity = levenshteinSimilarity("fl4m3r", "Flamer");
  if (similarity < 60 || similarity > 70) {
    throw new Error(`Expected similarity between 60-70%, got: ${similarity}`);
  }
}

function testFuzzySearch() {
  const playerNames = ["Flamer", "Shadow", "Phoenix", "Storm", "Blaze", "Frost"];
  
  // Exact match
  let result = fuzzySearch("Flamer", playerNames, 100);
  assertEquals("Flamer", result.match);
  assertEquals(100, result.similarity);
  
  // Close match with leet speak (fl4m3r -> Flamer)
  result = fuzzySearch("fl4m3r", playerNames, 65);
  assertEquals("Flamer", result.match);
  
  // Case insensitive match
  result = fuzzySearch("SHADOW", playerNames, 80);
  assertEquals("Shadow", result.match);
  
  // Typo match (Phenix -> Phoenix)
  result = fuzzySearch("Phenix", playerNames, 70);
  assertEquals("Phoenix", result.match);
  
  // No match above threshold
  result = fuzzySearch("CompletelyDifferent", playerNames, 80);
  assertEquals(null, result);
  
  // Partial name match
  result = fuzzySearch("Blaz", playerNames, 70);
  assertEquals("Blaze", result.match);
}

function testFuzzySearchAll() {
  const names = ["John", "Jon", "Johnny", "Jane", "Joan"];
  
  // Should find multiple matches for "Jon"
  const results = fuzzySearchAll("Jon", names, 60);
  
  // Should have at least 2 matches (Jon, John)
  if (results.length < 2) {
    throw new Error(`Expected at least 2 matches, got: ${results.length}`);
  }
  
  // First result should be exact match "Jon"
  assertEquals("Jon", results[0].match);
  assertEquals(100, results[0].similarity);
  
  // Results should be sorted by similarity descending
  for (let i = 1; i < results.length; i++) {
    if (results[i].similarity > results[i - 1].similarity) {
      throw new Error("Results not sorted by similarity descending");
    }
  }
}

function testFuzzySearchGameNicks() {
  // Real-world examples for game nick to player matching
  const players = [
    "Flamer", "DarkShadow", "IcePhoenix", "StormRider", 
    "BlazeMaster", "FrostBite", "NightHawk", "ThunderBolt"
  ];
  
  // Leet speak variations
  let result = fuzzySearch("fl4m3r", players, 50);
  assertEquals("Flamer", result.match);
  
  result = fuzzySearch("D4rkSh4dow", players, 50);
  assertEquals("DarkShadow", result.match);
  
  // Missing characters
  result = fuzzySearch("Flamr", players, 70);
  assertEquals("Flamer", result.match);
  
  // Extra characters
  result = fuzzySearch("Flamerr", players, 70);
  assertEquals("Flamer", result.match);
  
  // Abbreviated
  result = fuzzySearch("Storm", players, 50);
  assertEquals("StormRider", result.match);
}

function testCleanGameNick() {
  // Remove reconnect suffixes
  assertEquals("Flamer", cleanGameNick("Flamer(1)"));
  assertEquals("Flamer", cleanGameNick("Flamer (1)"));
  assertEquals("Flamer", cleanGameNick("Flamer(2)"));
  assertEquals("Flamer", cleanGameNick("Flamer (99)"));
  
  // No suffix - unchanged
  assertEquals("Flamer", cleanGameNick("Flamer"));
  assertEquals("fl4m3r", cleanGameNick("fl4m3r"));
  
  // Edge cases
  assertEquals("", cleanGameNick(""));
  assertEquals("", cleanGameNick(null));
  
  // Parentheses in middle should NOT be removed
  assertEquals("Flame(r)", cleanGameNick("Flame(r)"));
  assertEquals("Test(1)Nick", cleanGameNick("Test(1)Nick"));
}

function testFuzzyMatchPlayer() {
  const players = [
    { name: "Flamer", nicks: ["fl4m3r", "flames"] },
    { name: "Shadow", nicks: ["sh4dow", "darkone"] },
    { name: "Phoenix", nicks: ["ph03n1x"] },
    { name: "Storm", nicks: [] }
  ];
  
  // Exact match on player name
  let result = fuzzyMatchPlayer("Flamer", players, 65);
  assertEquals("Flamer", result.player);
  assertEquals(100, result.similarity);
  
  // Match on registered game nick
  result = fuzzyMatchPlayer("fl4m3r", players, 65);
  assertEquals("Flamer", result.player);
  assertEquals("fl4m3r", result.matchedOn);
  assertEquals(100, result.similarity);
  
  // Match with reconnect suffix stripped - "fl4m3r(1)" -> matches "fl4m3r"
  result = fuzzyMatchPlayer("fl4m3r(1)", players, 65);
  assertEquals("Flamer", result.player);
  assertEquals("fl4m3r", result.matchedOn);
  
  // Fuzzy match on nick with typo
  result = fuzzyMatchPlayer("flam3r", players, 65);
  assertEquals("Flamer", result.player);
  
  // Fuzzy match on player name with leet speak
  result = fuzzyMatchPlayer("Ph0enix", players, 65);
  assertEquals("Phoenix", result.player);
  
  // No match below threshold
  result = fuzzyMatchPlayer("CompletelyDifferent", players, 65);
  assertEquals(null, result);
  
  // Match with spaces in reconnect suffix
  result = fuzzyMatchPlayer("sh4dow (2)", players, 65);
  assertEquals("Shadow", result.player);
  assertEquals("sh4dow", result.matchedOn);
}

function testBuildPlayerList() {
  const sheetData = [
    ["Team", "Game Nicks", "Player", "Other"],  // Header row
    ["Red", "fl4m3r,flames", "Flamer", "data"],
    ["Blue", "sh4dow", "Shadow", "data"],
    ["Red", "", "Storm", "data"]  // Player with no nicks
  ];
  
  const players = buildPlayerList(sheetData);
  
  assertEquals(3, players.length);
  
  assertEquals("Flamer", players[0].name);
  assertEquals(2, players[0].nicks.length);
  assertEquals("fl4m3r", players[0].nicks[0]);
  assertEquals("flames", players[0].nicks[1]);
  
  assertEquals("Shadow", players[1].name);
  assertEquals(1, players[1].nicks.length);
  
  assertEquals("Storm", players[2].name);
  assertEquals(0, players[2].nicks.length);
}

function testBuildTeamList() {
  const sheetData = [
    ["Team Tag", "Team Name", "Other"],  // Header row
    ["RED‡r3d", "Red Devils", "data"],
    ["BLU", "Blue Angels", "data"],
    ["", "No Tag Team", "data"]  // Team with no tags
  ];
  
  const teams = buildTeamList(sheetData);
  
  assertEquals(3, teams.length);
  
  assertEquals("Red Devils", teams[0].name);
  assertEquals(2, teams[0].tags.length);
  assertEquals("RED", teams[0].tags[0]);
  assertEquals("r3d", teams[0].tags[1]);
  
  assertEquals("Blue Angels", teams[1].name);
  assertEquals(1, teams[1].tags.length);
  assertEquals("BLU", teams[1].tags[0]);
  
  assertEquals("No Tag Team", teams[2].name);
  assertEquals(0, teams[2].tags.length);
}

function testFuzzyMatchTeam() {
  const teams = [
    { name: "Red Devils", tags: ["RED", "r3d", "devils"] },
    { name: "Blue Angels", tags: ["BLU", "angels"] },
    { name: "Green Goblins", tags: ["GRN"] },
    { name: "Yellow", tags: [] }
  ];
  
  // Exact match on team name
  let result = fuzzyMatchTeam("Red Devils", teams, 65);
  assertEquals("Red Devils", result.team);
  assertEquals(100, result.similarity);
  
  // Match on registered tag
  result = fuzzyMatchTeam("RED", teams, 65);
  assertEquals("Red Devils", result.team);
  assertEquals("RED", result.matchedOn);
  assertEquals(100, result.similarity);
  
  // Fuzzy match on tag with leet speak
  result = fuzzyMatchTeam("r3d", teams, 65);
  assertEquals("Red Devils", result.team);
  assertEquals("r3d", result.matchedOn);
  
  // Fuzzy match on team name with typo
  result = fuzzyMatchTeam("Blue Angles", teams, 70);
  assertEquals("Blue Angels", result.team);
  
  // Match on partial tag
  result = fuzzyMatchTeam("angel", teams, 65);
  assertEquals("Blue Angels", result.team);
  
  // No match below threshold
  result = fuzzyMatchTeam("CompletelyDifferent", teams, 65);
  assertEquals(null, result);
  
  // Case insensitive match
  result = fuzzyMatchTeam("red", teams, 65);
  assertEquals("Red Devils", result.team);
}

function testStripEmojis() {
  // Basic emoji removal - emojis replaced with spaces, then trimmed
  assertEquals("TeamName", stripEmojis("🔥TeamName"));
  assertEquals("TeamName", stripEmojis("TeamName🏆"));
  assertEquals("TeamName", stripEmojis("🇧🇷TeamName🔥"));
  
  // Multiple emojis - replaced with spaces
  assertEquals("Hello World", stripEmojis("👋Hello🌍World🎉"));
  
  // No emojis
  assertEquals("PlainText", stripEmojis("PlainText"));
  
  // Only emojis - becomes empty after trim
  assertEquals("", stripEmojis("🔥🏆🎮"));
  
  // Empty string
  assertEquals("", stripEmojis(""));
  
  // Null/undefined handling
  assertEquals("", stripEmojis(null));
  assertEquals("", stripEmojis(undefined));
  
  // Flag emojis (country flags)
  assertEquals("Brasil", stripEmojis("🇧🇷Brasil"));
  
  // Mixed content with spaces - multiple spaces collapsed to single
  assertEquals("Seleção Nordeste Brasil", stripEmojis("🇧🇷 Seleção Nordeste Brasil 🔥"));
  
  // Tournament team names with leading emojis
  assertEquals("Pink", stripEmojis("🌸 Pink"));
  assertEquals("Mint", stripEmojis("🌿 Mint"));
  assertEquals("Green", stripEmojis("🟢 Green"));
  assertEquals("Violet", stripEmojis("🟣 Violet"));
  assertEquals("Brown", stripEmojis("🟤 Brown"));
  assertEquals("Yellow", stripEmojis("🟡 Yellow"));
}

function testCleanTeamNameForLogo() {
  // Basic cleaning - lowercase and remove spaces/special chars
  assertEquals("teamname", cleanTeamNameForLogo("TeamName"));
  assertEquals("teamname", cleanTeamNameForLogo("Team Name"));
  assertEquals("teamname", cleanTeamNameForLogo("TEAM NAME"));
  
  // Remove diacritics/accented characters
  assertEquals("selecaonordestebrasil", cleanTeamNameForLogo("Seleção Nordeste Brasil"));
  assertEquals("selecaonordestebrasil", cleanTeamNameForLogo("seleção nordeste brasil"));
  
  // Strip emojis first, then clean
  assertEquals("selecaonordestebrasil", cleanTeamNameForLogo("🇧🇷 Seleção Nordeste Brasil"));
  assertEquals("teamfire", cleanTeamNameForLogo("🔥Team Fire🔥"));
  
  // Numbers should be preserved
  assertEquals("team123", cleanTeamNameForLogo("Team 123"));
  assertEquals("4kings", cleanTeamNameForLogo("4 Kings"));
  
  // Special characters removed
  assertEquals("teamalpha", cleanTeamNameForLogo("Team-Alpha"));
  assertEquals("teambeta", cleanTeamNameForLogo("Team.Beta"));
  assertEquals("teamgamma", cleanTeamNameForLogo("Team_Gamma"));
  assertEquals("teamdelta", cleanTeamNameForLogo("Team'Delta"));
  
  // Various accented characters
  assertEquals("cafe", cleanTeamNameForLogo("Café"));
  assertEquals("nino", cleanTeamNameForLogo("Niño"));
  assertEquals("uber", cleanTeamNameForLogo("Über"));
  assertEquals("naive", cleanTeamNameForLogo("Naïve"));
  
  // Empty/null handling
  assertEquals("", cleanTeamNameForLogo(""));
  assertEquals("", cleanTeamNameForLogo(null));
  assertEquals("", cleanTeamNameForLogo(undefined));
  
  // Only emojis results in empty
  assertEquals("", cleanTeamNameForLogo("🔥🏆🎮"));
  
  // Tournament team names with leading emojis
  assertEquals("pink", cleanTeamNameForLogo("🌸 Pink"));
  assertEquals("mint", cleanTeamNameForLogo("🌿 Mint"));
  assertEquals("green", cleanTeamNameForLogo("🟢 Green"));
  assertEquals("violet", cleanTeamNameForLogo("🟣 Violet"));
  assertEquals("brown", cleanTeamNameForLogo("🟤 Brown"));
  assertEquals("yellow", cleanTeamNameForLogo("🟡 Yellow"));
}

function testBuildTeamLogoUrl() {
  const BASE = 'https://cdn.jsdelivr.net/gh/kindzal/my-assets@master/images/clan-logos/optimised/';
  
  // Standard team name
  assertEquals(BASE + "teamname.png", buildTeamLogoUrl("TeamName"));
  assertEquals(BASE + "teamname.png", buildTeamLogoUrl("Team Name"));
  
  // Brazilian team with accents and emojis
  assertEquals(BASE + "selecaonordestebrasil.png", buildTeamLogoUrl("🇧🇷 Seleção Nordeste Brasil"));
  assertEquals(BASE + "selecaonordestebrasil.png", buildTeamLogoUrl("Seleção Nordeste Brasil"));
  
  // Team with emojis
  assertEquals(BASE + "teamfire.png", buildTeamLogoUrl("🔥Team Fire"));
  assertEquals(BASE + "champions.png", buildTeamLogoUrl("🏆 Champions 🏆"));
  
  // Numbers preserved
  assertEquals(BASE + "team123.png", buildTeamLogoUrl("Team 123"));
  assertEquals(BASE + "4kings.png", buildTeamLogoUrl("4 Kings"));
  
  // Various accents
  assertEquals(BASE + "cafe.png", buildTeamLogoUrl("Café"));
  assertEquals(BASE + "nino.png", buildTeamLogoUrl("Niño"));
  
  // Empty/null returns fallback
  assertEquals(BASE + "fallback.png", buildTeamLogoUrl(""));
  assertEquals(BASE + "fallback.png", buildTeamLogoUrl(null));
  assertEquals(BASE + "fallback.png", buildTeamLogoUrl(undefined));
  
  // Only emojis returns fallback
  assertEquals(BASE + "fallback.png", buildTeamLogoUrl("🔥🏆🎮"));
  
  // Tournament team names with leading emojis
  assertEquals(BASE + "pink.png", buildTeamLogoUrl("🌸 Pink"));
  assertEquals(BASE + "mint.png", buildTeamLogoUrl("🌿 Mint"));
  assertEquals(BASE + "green.png", buildTeamLogoUrl("🟢 Green"));
  assertEquals(BASE + "violet.png", buildTeamLogoUrl("🟣 Violet"));
  assertEquals(BASE + "brown.png", buildTeamLogoUrl("🟤 Brown"));
  assertEquals(BASE + "yellow.png", buildTeamLogoUrl("🟡 Yellow"));
}