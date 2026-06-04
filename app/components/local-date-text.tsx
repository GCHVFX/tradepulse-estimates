"use client";

import { useEffect, useState } from "react";

interface LocalDateTextProps {
  dateStr: string;
  prefix?: string;
  showTime?: boolean;
  className?: string;
}

export function LocalDateText({
  dateStr,
  prefix,
  showTime,
  className,
}: LocalDateTextProps) {
  const [formatted, setFormatted] = useState("");

  useEffect(() => {
    const d = new Date(dateStr);
    const date = new Intl.DateTimeFormat("en-CA", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
    const time = showTime
      ? " at " + d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", hour12: true })
      : "";
    setFormatted(date + time);
  }, [dateStr, showTime]);

  if (!formatted) {
    return <span className={className}>{prefix ? `${prefix}...` : "..."}</span>;
  }

  return (
    <span className={className}>
      {prefix ? `${prefix} ${formatted}` : formatted}
    </span>
  );
}
