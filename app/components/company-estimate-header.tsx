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
    <div className="mb-5 flex items-center gap-3">
      {logoUrl ? (
        <Image
          src={logoUrl}
          alt={businessName || "Company logo"}
          width={64}
          height={64}
          className="object-contain max-h-16 max-w-16 rounded-lg bg-white/5 p-1"
          unoptimized
        />
      ) : null}
      <div className="min-w-0">
        {businessName ? (
          <p className="text-white text-lg font-semibold leading-tight truncate">
            {businessName}
          </p>
        ) : (
          <p className="text-zinc-400 text-sm">Estimate</p>
        )}
        <p className="text-zinc-500 text-sm">Estimate</p>
      </div>
    </div>
  );
}
