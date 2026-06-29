import type { DateRange } from '../CreatePlan';

export function enumerateDates(range: DateRange): string[] {
  if (!range.start) return [];
  if (!range.end) return [range.start];
  const dates: string[] = [];
  const cursor = new Date(range.start);
  const end = new Date(range.end);
  while (cursor <= end) {
    dates.push(cursor.toISOString().split('T')[0]);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
