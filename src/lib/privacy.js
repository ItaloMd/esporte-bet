export function maskEmail(email) {
  const value = String(email || "");
  const [name, domain] = value.split("@");
  if (!domain) return value ? `${value.slice(0, 2)}***` : "—";
  return `${name.slice(0, 2)}***@${domain}`;
}

export function maskCpfShort(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 11) return "***.***.***-**";
  return `***.${digits.slice(3, 6)}.***-${digits.slice(9)}`;
}