// Board display values only. Shared validation with the server; no policy or
// broker settings live here. Dates are calendar dates, independent of timezone.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validateBoardSettings(value) {
  if (!object(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'accountStart')) return 'Expected only accountStart.';
  const start = value.accountStart;
  if (start === null) return null;
  if (!object(start) || Object.keys(start).length !== 2 || !Object.hasOwn(start, 'amountEur') || !Object.hasOwn(start, 'date')) return 'Account start needs an amount in EUR and a date.';
  if (typeof start.amountEur !== 'number' || !Number.isFinite(start.amountEur) || start.amountEur <= 0 ||
      !/^\d+(?:\.\d{1,2})?$/.test(String(start.amountEur)) || !Number.isSafeInteger(Math.round(start.amountEur * 100))) return 'Enter a positive EUR amount with at most two decimal places and safely representable cents.';
  if (typeof start.date !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(start.date)) return 'Enter a real calendar date as YYYY-MM-DD.';
  const date = new Date(`${start.date}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== start.date) return 'Enter a real calendar date as YYYY-MM-DD.';
  return null;
}
