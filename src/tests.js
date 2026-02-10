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