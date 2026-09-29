// Sales tax by province, in basis points (1300 = 13%). GST + provincial part.
// Only products marked taxable are taxed; basic groceries are zero-rated.
// Rates should be reviewed by an accountant before launch.
const RATES_BP: Record<string, number> = {
  ON: 1300, // HST
  NS: 1400, // HST
  NB: 1500, // HST
  NL: 1500, // HST
  PE: 1500, // HST
  QC: 1498, // GST 5% + QST 9.975%
  BC: 1200, // GST 5% + PST 7%
  MB: 1200, // GST 5% + RST 7%
  SK: 1100, // GST 5% + PST 6%
  AB: 500,
  NT: 500,
  NU: 500,
  YT: 500,
};

export function taxRateBp(provinceCode: string): number {
  const rate = RATES_BP[provinceCode.toUpperCase()];
  if (rate === undefined) throw new Error(`Unknown province: ${provinceCode}`);
  return rate;
}

// Tax on the taxable subtotal, rounded once to the nearest cent.
export function taxCents(taxableSubtotalCents: number, provinceCode: string): number {
  return Math.round((taxableSubtotalCents * taxRateBp(provinceCode)) / 10_000);
}
