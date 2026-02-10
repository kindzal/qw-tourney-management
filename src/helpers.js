function parseDateTime(text) {
  const now = new Date();

  let date = null;
  let hour = 21;
  let minute = 0;

  // Normalize
  const cleanText = text.replace(/CET|CEST/gi, "").trim();

  // ---- TIME ----
  const time24 = cleanText.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const time12 = cleanText.match(/\b(\d{1,2})\s?(am|pm)\b/i);

  if (time24) {
    hour = Number(time24[1]);
    minute = Number(time24[2]);
  } else if (time12) {
    hour = Number(time12[1]) % 12;
    if (time12[2].toLowerCase() === "pm") hour += 12;
  }

  // ---- DATE: "Thursday 12 Feb" ----
  const namedDate = cleanText.match(
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i
  );

  if (namedDate) {
    const day = Number(namedDate[2]);
    const month = monthToIndex(namedDate[3]);
    let year = now.getFullYear();

    // If date already passed this year → assume next year
    const candidate = new Date(year, month, day);
    if (candidate < now) year++;

    date = new Date(year, month, day);
  }

  // ---- ISO / EU fallback ----
  if (!date) {
    const isoDate = cleanText.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    const euDate = cleanText.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);

    if (isoDate) {
      date = new Date(
        Number(isoDate[1]),
        Number(isoDate[2]) - 1,
        Number(isoDate[3])
      );
    } else if (euDate) {
      const year = euDate[3] ? Number(euDate[3]) : now.getFullYear();
      date = new Date(
        year,
        Number(euDate[2]) - 1,
        Number(euDate[1])
      );
    }
  }

  // ---- Relative days ----
  if (!date && /tomorrow/i.test(cleanText)) {
    date = new Date(now);
    date.setDate(date.getDate() + 1);
  }

  if (!date && /today/i.test(cleanText)) {
    date = new Date(now);
  }

  if (!date) {
    date = parseWeekday(cleanText, now);
  }

  if (!date) return null;

  date.setHours(hour, minute, 0, 0);
  return formatDate(date);
}

function parseWeekday(text, baseDate) {
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

  const d = new Date(baseDate);
  const diff = (targetDay - d.getDay() + 7) % 7 || 7;

  d.setDate(d.getDate() + (isNext ? diff + 7 : diff));
  return d;
}

function monthToIndex(mon) {
  const months = {
    jan: 0, feb: 1, mar: 2, apr: 3,
    may: 4, jun: 5, jul: 6, aug: 7,
    sep: 8, oct: 9, nov: 10, dec: 11
  };

  return months[mon.toLowerCase()];
}

function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');

  return `${dd}/${mm}/${yyyy} @ ${hh}:${min} CET/CEST`;
}
