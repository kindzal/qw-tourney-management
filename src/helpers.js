function parseDateTime(text) {
  // Freeze "now" for deterministic tests
  const now = new Date();

  let hour = 21;
  let minute = 0;

  // ---- Extract timezone first (don't break time parsing) ----
  const tzMatch = text.match(/(CET|CEST)/i);
  const explicitTz = tzMatch ? tzMatch[1].toUpperCase() : null;

  // Remove timezone safely (even if attached like 20:45CET)
  const cleanText = text.replace(/(CET|CEST)/gi, "").trim();

  // ---- TIME PARSING (strict priority order) ----

  // 1️⃣ 24-hour format (20:45)
  const time24 = cleanText.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);

  if (time24) {
    hour = Number(time24[1]);
    minute = Number(time24[2]);

  } else {

    // 2️⃣ 12-hour format (9pm)
    const time12 = cleanText.match(/\b(\d{1,2})\s?(am|pm)\b/i);

    if (time12) {
      hour = Number(time12[1]) % 12;
      if (time12[2].toLowerCase() === "pm") hour += 12;

    } else {

      // 3️⃣ Bare hour (21, @21, 21 )
      const timeHourOnly = cleanText.match(/(?:@|\s)([01]?\d|2[0-3])\b/);

      if (timeHourOnly) {
        hour = Number(timeHourOnly[1]);
        minute = 0;
      }
    }
  }

  // ---- DATE PARSING (explicit date wins over weekday) ----

  let date =
    parseNamedDate(cleanText, now) ||
    parseNumericDate(cleanText, now);

  if (!date) {
    date =
      parseRelativeDate(cleanText, now) ||
      parseWeekday(cleanText, now);
  }

  if (!date) return null;

  date.setHours(hour, minute, 0, 0);

  // ---- Timezone inference ----
  const timezone = explicitTz || inferCetOrCest(date);

  return formatDate(date, timezone);
}

function parseNamedDate(text, now) {
  const months = {
    january: 0, february: 1, march: 2, april: 3,
    may: 4, june: 5, july: 6, august: 7,
    september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, mar: 2, apr: 3,
    jun: 5, jul: 6, aug: 7,
    sep: 8, sept: 8, oct: 9, nov: 10, dec: 11
  };

  // 1️⃣ Remove weekday safely (no heavy regex)
  const cleaned = text.replace(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    ""
  );

  // 2️⃣ Match "22nd February" or "February 22nd"
  const match = cleaned.match(
    /\b(\d{1,2})(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\s+(\d{1,2})(st|nd|rd|th)?\b/i
  );

  if (!match) return null;

  let day, month;

  if (match[1]) {
    // 22 February
    day = Number(match[1]);
    month = months[match[3].toLowerCase()];
  } else {
    // February 22
    day = Number(match[5]);
    month = months[match[4].toLowerCase()];
  }

  const year = now.getFullYear();
  return new Date(year, month, day);
}


function parseRelativeDate(text, now) {
  const lower = text.toLowerCase();

  if (lower.includes("today")) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  if (lower.includes("tonight")) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  if (lower.includes("tomorrow")) {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return new Date(
      tomorrow.getFullYear(),
      tomorrow.getMonth(),
      tomorrow.getDate()
    );
  }

  return null;
}

function parseNumericDate(text, now) {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return new Date(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3])
    );
  }

  const eu = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);
  if (eu) {
    const year = eu[3] ? Number(eu[3]) : now.getFullYear();
    return new Date(
      year,
      Number(eu[2]) - 1,
      Number(eu[1])
    );
  }

  return null;
}

function parseWeekday(text, now) {
  const days = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6
  };

  const match = text.match(
    /\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i
  );

  if (!match) return null;

  const isNext = !!match[1];
  const targetDay = days[match[2].toLowerCase()];

  const d = new Date(now);
  const diff = (targetDay - d.getDay() + 7) % 7 || 7;

  d.setDate(d.getDate() + (isNext ? diff + 7 : diff));
  return d;
}

function monthToIndex(mon) {
  return {
    jan: 0, feb: 1, mar: 2, apr: 3,
    may: 4, jun: 5, jul: 6, aug: 7,
    sep: 8, oct: 9, nov: 10, dec: 11
  }[mon.toLowerCase()];
}

function formatDate(date, timezone) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');

  return `${dd}/${mm}/${yyyy} @ ${hh}:${min} ${timezone}`;
}

function inferCetOrCest(date) {
  const year = date.getFullYear();
  const marchLastSunday = lastSundayOfMonth(year, 2);
  const octoberLastSunday = lastSundayOfMonth(year, 9);

  return (date >= marchLastSunday && date < octoberLastSunday)
    ? "CEST"
    : "CET";
}

function lastSundayOfMonth(year, monthIndex) {
  const d = new Date(year, monthIndex + 1, 0);
  while (d.getDay() !== 0) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

function parseScheduledFor(dateStr) {
  // "12/02/2026 @ 21:00 CET"
  const match = dateStr.match(
    /(\d{2})\/(\d{2})\/(\d{4})\s*@\s*(\d{2}):(\d{2})/
  );
  if (!match) return null;

  return {
    day: Number(match[1]),
    month: Number(match[2]),
    year: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5])
  };
}

// Helper function to parse deadline from ScheduleConfig
function parseDeadline(deadlineStr) {
  if (!deadlineStr) return null;
  
  // Convert to string in case it's a Date object or other type
  const str = String(deadlineStr);
  
  // Try format with time: "08/02/2026 23:59:59"
  let match = str.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (match) {
    const [, day, month, year, hour, minute, second] = match;
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second)
    );
  }
  
  // Try format without time: "08/02/2026"
  match = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    // Default to end of day (23:59:59) if no time specified
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      23,
      59,
      59
    );
  }
  
  return null;
}

/**
 * Parses a date value that may be:
 *  - A native Date object (GAS read a date-formatted cell)
 *  - A string in DD/MM/YYYY format
 * Returns a Date set to midnight UTC, or null if unparseable.
 */
function parseDdMmYyyy(value) {
  if (value instanceof Date && !isNaN(value)) return value;

  const match = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const [, dd, mm, yyyy] = match;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
}

/**
 * Returns true if any excluded keyword appears in the matchtag (case-insensitive).
 */
function hasExcludedKeyword(matchtag, excludedKeywords) {
  if (!excludedKeywords || excludedKeywords.length === 0) return false;
  const lower = String(matchtag).toLowerCase();
  return excludedKeywords.some(kw => lower.includes(kw));
}

/**
 * Returns true if [teamA, teamB] (or swapped) matches any entry in scheduledPairs.
 * Both sides are already lower-cased before comparison.
 */
function isScheduledPair(teamNames, scheduledPairs) {
  if (teamNames.length < 2) return false;
  const [a, b] = teamNames;

  return scheduledPairs.some(([pa, pb]) =>
    (pa.toLowerCase() === a.toLowerCase() && pb.toLowerCase() === b.toLowerCase()) || (pa.toLowerCase() === b.toLowerCase() && pb.toLowerCase() === a.toLowerCase())
  );
}

function checkForIssues() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("FIX-ME");
  if (!sheet || sheet.getLastRow() < 2) return false;
  return Boolean(sheet.getRange(2, 1).getValue());
}