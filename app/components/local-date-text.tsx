"use client";

import { useEffect, useState } from "react";

interface LocalDateTextProps {
  dateStr: string;
  prefix?: string;
  className?: string;
}

export function LocalDateText({
  dateStr,
  prefix,
  className,
}: LocalDateTextProps) {
  const [formatted, setFormatted] = useState("");

  useEffect(() => {
    const value = new Intl.DateTimeFormat("en-CA", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(dateStr));

    setFormatted(value);
  }, [dateStr]);

  if (!formatted) {
    return <span className={className}>{prefix ? `${prefix}...` : "..."}</span>;
  }

  return (
    <span className={className}>
      {prefix ? `${prefix} ${formatted}` : formatted}
    </span>
  );
}
