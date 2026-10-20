/**
 * How full an account's sync storage is, in whole percent, as Settings shows
 * it: rounded down, so 100 means full, yet never 0 once anything is stored.
 * Over a quota lowered below what is stored, it is more than 100.
 */
export function usedPercent({ used, quota }: { used: number; quota: number }): number {
  if (used <= 0) return 0;
  if (quota <= 0) return 100;
  return Math.max(1, Math.floor((used * 100) / quota));
}
