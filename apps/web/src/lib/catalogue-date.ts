/**
 * Format the catalogue's verification date without timezone drift.
 *
 * The stored value is a calendar date (`YYYY-MM-DD`), not a timestamp. Parsing
 * it as local midnight and formatting west of UTC would show the previous day;
 * this formatter pins the interpretation and the output to UTC.
 */
export const formatCatalogueVerifiedAt = (value?: string | null): string => {
  if (!value) return "";

  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + "T00:00:00Z" : value);

  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
};
