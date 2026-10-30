// All "today" calculations use Nigerian time, so a server in another time zone can't shift the day.
export const TIME_ZONE = "Africa/Lagos";

// Today's date in Lagos as "YYYY-MM-DD".
export function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const toUTC = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

// Whole days from today until an ISO date like "2026-12-01". Negative when past.
export function daysUntil(isoDate: string, now = new Date()) {
  return Math.round((toUTC(isoDate) - toUTC(todayISO(now))) / 86_400_000);
}

export function addDays(isoDate: string, days: number) {
  return new Date(toUTC(isoDate) + days * 86_400_000).toISOString().slice(0, 10);
}

export function formatDate(isoDate: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" }) {
  return new Date(toUTC(isoDate)).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}

// When something happened, in plain words: "today 14:05", "yesterday 09:30", "3 days ago", or "28 Oct 2026".
export function whenLabel(timestamp: string, now = new Date()) {
  const at = new Date(timestamp);
  const days = -daysUntil(todayISO(at), now);
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE });
  if (days <= 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  if (days < 7) return `${days} days ago`;
  return formatDate(todayISO(at), { day: "numeric", month: "short", year: "numeric" });
}

export function countdownLabel(days: number) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 0) return `${-days} days ago`;
  return `${days} days`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Builds a date from a day and month (and maybe a year) found in a timetable.
// When the year is missing, picks the year that puts the date closest to today,
// so a date late in a timetable isn't pushed a whole year away.
export function resolveDate(day: number, month: number | string, year: number | null | undefined, today = todayISO()) {
  const m = typeof month === "number" ? month : MONTHS.indexOf(month.slice(0, 3).toLowerCase()) + 1;
  if (!m || m < 1 || m > 12 || !day || day < 1 || day > 31) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (year) return `${year}-${pad(m)}-${pad(day)}`;
  const y = Number(today.slice(0, 4));
  const candidates = [y - 1, y, y + 1].map((yy) => `${yy}-${pad(m)}-${pad(day)}`);
  return candidates.sort((a, b) => Math.abs(toUTC(a) - toUTC(today)) - Math.abs(toUTC(b) - toUTC(today)))[0];
}
