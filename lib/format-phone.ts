export function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** Format only a complete E.164 +1 number for customer-facing display. */
export function formatPhoneDisplay(value: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(value.trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : value;
}
