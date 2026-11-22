/** Human-readable byte size for storage surfaces. */
export const formatBytes = (value?: number | null) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let unit = 0;

  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }

  return `${amount.toFixed(1).replace(/\.0$/, "")} ${units[unit]}`;
};

/** Percentage for a slice of a total, with a stable zero handling. */
export const sharePercent = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 100) : 0;

/** Display label that keeps a real slice from reading as an empty one. */
export const formatShare = (part: number, total: number) => {
  if (total <= 0 || part <= 0) return "0%";

  const percent = (part / total) * 100;

  return percent < 1 ? "<1%" : `${Math.round(percent)}%`;
};
