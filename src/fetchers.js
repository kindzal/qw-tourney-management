/**
 * Queries the QW Hub REST API and returns the raw game array.
 */
function fetchHubGames(cfg) {
  // Format tournament start as YYYY-MM-DD for the timestamp filter
  const pad  = n => String(n).padStart(2, "0");
  const d    = cfg.tournamentStart;
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const params = [
    `select=id,timestamp,matchtag,teams`,
    `mode=eq.${encodeURIComponent(cfg.mode)}`,
    `matchtag=ilike.${encodeURIComponent("%" + cfg.ilike + "%")}`,
    `order=timestamp.desc`,
    `offset=0`,
    `timestamp=gte.${dateStr}`
  ].join("&");

  const url = `${HUB_API_BASE}?${params}`;

  try {
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: {
        "apikey":        HUB_API_KEY,
        "Authorization": `Bearer ${HUB_API_KEY}`,
        "Content-Type":  "application/json"
      },
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    if (code !== 200) {
      Logger.log(`autoImport: Hub API returned HTTP ${code}: ${response.getContentText()}`);
      return null;
    }

    return JSON.parse(response.getContentText());

  } catch (e) {
    Logger.log("autoImport: error calling Hub API: " + e.message);
    return null;
  }
}