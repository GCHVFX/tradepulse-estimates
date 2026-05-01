import Image from "next/image";

interface CompanyEstimateHeaderProps {
  logoUrl?: string | null;
  businessName?: string;
}

export function CompanyEstimateHeader({
  logoUrl,
  businessName,
}: CompanyEstimateHeaderProps) {
  if (!logoUrl && !businessName) return null;

  return (
    <div className="flex items-center gap-4 mb-5">
      {logoUrl && (
        <Image
          src={logoUrl}
          alt={businessName || "Company logo"}
          width={160}
          height={48}
          className="object-contain rounded shrink-0"
          unoptimized
        />
      )}
      {businessName && (
        <p className="text-xl font-bold text-zinc-800 leading-tight">
          {businessName}
        </p>
      )}
    </div>
  );
}
