/**
 * Every date in this system is a YYYY-MM-DD string resolved in the configured
 * timezone (A10 · Settings), never a raw Date. Streaks depend on it, so the
 * timezone is read from the database and only falls back to the env var.
 */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function fallbackTimezone() {
  return process.env.QUIZ_TIMEZONE || "America/New_York";
}

export function todayInTz(timeZone = fallbackTimezone()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/** Monday-first week containing `date`, as seven YYYY-MM-DD strings. */
export function weekOf(date: string, startsOn: "monday" | "sunday" = "monday"): string[] {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 = Sunday
  const offset = startsOn === "monday" ? (dow === 0 ? -6 : 1 - dow) : -dow;
  const start = addDays(date, offset);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function monthOf(date: string): { first: string; last: string } {
  const [y, m] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { first: `${y}-${pad(m)}-01`, last: `${y}-${pad(m)}-${pad(last)}` };
}
