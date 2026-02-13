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
