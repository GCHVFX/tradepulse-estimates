interface EstimateCompanyNameOptions {
  businessName?: string | null;
  logoUrl?: string | null;
  showCompanyNameBelowLogo?: boolean;
}

export function estimateCompanyName({
  businessName,
  logoUrl,
  showCompanyNameBelowLogo = true,
}: EstimateCompanyNameOptions): string {
  const name = businessName?.trim() ?? "";
  if (!name || (logoUrl && !showCompanyNameBelowLogo)) return "";
  return name;
}

export function preparedByLabel(preparedBy?: string | null): string {
  const name = preparedBy?.trim() ?? "";
  return name ? `Prepared by ${name}` : "";
}
