export function formatTimelineTime(value: number): string {
  if (value === 0) return "0";
  const sign = value < 0 ? "−" : "";
  const absolute = Math.abs(value);
  if (absolute < 1000) return `${sign}${absolute} ms`;
  const minutes = Math.floor(absolute / 60_000);
  const seconds = ((absolute % 60_000) / 1000).toFixed(1);
  return minutes ? `${sign}${minutes}:${seconds.padStart(4, "0")}` : `${sign}${seconds}s`;
}
