export interface CsvLabourRateRow {
  name: string;
  category: string;
  unit: string;
  price: number;
}

export function isHourlyLabourRow(name: string, category: string, unit: string): boolean {
  if (!/\blabou?r\b/i.test(`${name} ${category}`)) return false;
  const normalizedUnit = unit.trim().toLowerCase().replace(/\s+/g, " ");
  return ["hour", "hours", "hr", "hrs", "hourly", "per hour", "$/hr", "$ / hr"].includes(normalizedUnit);
}

export function findSingleHourlyLabourRate(
  rows: CsvLabourRateRow[]
): { index: number; rate: number } | null {
  const matches = rows.flatMap((row, index) => {
    if (!isHourlyLabourRow(row.name, row.category, row.unit) || !Number.isFinite(row.price) || row.price <= 0) {
      return [];
    }
    return [{ index, rate: row.price }];
  });
  return matches.length === 1 ? matches[0] : null;
}
