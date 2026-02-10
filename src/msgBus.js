function processMsgQueue(limit = 10) {
  const sheet = ensureMsgQueueSheet();
  const data = sheet.getDataRange().getValues();

  // Skip header
  for (let i = 1; i < data.length && limit > 0; i++) {
    const [
      messageId,
      timestamp,
      type,
      content,
      status,
      processedAt
    ] = data[i];

    if (status && status !== "NEW") continue;

    try {
      const payload = JSON.parse(content);
      routeMessage(type, payload);

      sheet.getRange(i + 1, 5, 1, 2).setValues([[
        "PROCESSED",
        new Date().toISOString()
      ]]);

      limit--;
    } catch (err) {
      sheet.getRange(i + 1, 5, 1, 2).setValues([[
        "ERROR",
        err.message
      ]]);
    }
  }
}

function routeMessage(type, payload) {
  switch (type) {
    case "SCHEDULE_GAME_REPORT":
      handleScheduleGameReport(payload);
      break;

    default:
      throw new Error("Unknown message type: " + type);
  }
}

function ensureMsgQueueSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("MsgQueue");

  if (!sheet) {
    sheet = ss.insertSheet("MsgQueue");
    sheet.getRange(1, 1, 1, 6).setValues([[
      "Message ID",
      "Timestamp",
      "Message Type",
      "Content",
      "Status",
      "Processed At"
    ]]);
  }

  return sheet;
}

function enqueueMessageIfNew(messageId, timestamp, type, contentObj) {
  const sheet = ensureMsgQueueSheet();
  const ids = sheet.getRange(2, 1, sheet.getLastRow(), 1).getValues().flat();

  if (ids.includes(messageId)) return false;

  enqueueMessage(messageId, timestamp, type, contentObj);
  return true;
}

function enqueueMessage(messageId, timestamp, type, contentObj) {
  const sheet = ensureMsgQueueSheet();

  sheet.appendRow([
    messageId,                     // A: Message ID
    timestamp,                     // B: Timestamp
    type,                          // C: Message Type
    JSON.stringify(contentObj),    // D: Content
    "NEW",                          // E: Status
    ""                              // F: Processed At
  ]);
}

function handleSchedule(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch {
    return ContentService.createTextOutput("Invalid JSON payload.");
  }

  const {
    messageId,
    createdAt,
    content,
    roles
  } = data;

  if (!messageId || !createdAt) {
    return ContentService.createTextOutput("Missing message metadata.");
  }

  if (!Array.isArray(roles) || roles.length < 2) {
    return ContentService.createTextOutput("Not enough teams mentioned.");
  } 

  const queuePayload = {
    teams: roles.map(r => ({ id: r.id, name: r.name })),
    rawText: content
  };

  const enqueued = enqueueMessageIfNew(
    messageId,
    createdAt,
    "SCHEDULE_GAME_REPORT",
    queuePayload
  );

  if (!enqueued) {
    return ContentService.createTextOutput("Duplicate message ignored.");
  }

  return ContentService.createTextOutput("Schedule report queued.");
}