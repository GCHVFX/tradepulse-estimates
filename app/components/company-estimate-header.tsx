import Image from "next/image";
import { estimateCompanyName, preparedByLabel } from "@/lib/estimate-identity";

interface CompanyEstimateHeaderProps {
  logoUrl?: string | null;
  businessName?: string;
  showCompanyNameBelowLogo?: boolean;
  preparedBy?: string | null;
}

export function CompanyEstimateHeader({
  logoUrl,
  businessName,
  showCompanyNameBelowLogo = true,
  preparedBy,
}: CompanyEstimateHeaderProps) {
  const displayedBusinessName = estimateCompanyName({
    businessName,
    logoUrl,
    showCompanyNameBelowLogo,
  });
  const preparedByText = preparedByLabel(preparedBy);
  if (!logoUrl && !displayedBusinessName && !preparedByText) return null;

  return (
    <div className="flex flex-col gap-2 mb-5">
      {logoUrl && (
        <Image
          src={logoUrl}
          alt={businessName || "Company logo"}
          width={160}
          height={48}
          className="object-contain object-left rounded"
          unoptimized
        />
      )}
      {displayedBusinessName && (
        <p className="text-xl font-bold text-[#26211B] leading-tight">
          {displayedBusinessName}
        </p>
      )}
      {preparedByText && (
        <p className="text-sm text-[#5C4A2E] leading-tight">
          {preparedByText}
        </p>
      )}
    </div>
  );
}
