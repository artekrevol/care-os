export function daysUntil(date: string | Date | null | undefined): number | null {
  if (!date) return null;
  const target = typeof date === "string" ? new Date(date + "T00:00:00Z") : date;
  const today = new Date();
  const diffMs = target.getTime() - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function authStatus(opts: {
  hoursUsed: number;
  hoursTotal: number;
  expirationDate: string;
}): "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "EXHAUSTED" {
  const days = daysUntil(opts.expirationDate);
  if (opts.hoursUsed >= opts.hoursTotal) return "EXHAUSTED";
  if (days != null && days < 0) return "EXPIRED";
  if (days != null && days <= 14) return "EXPIRING_SOON";
  return "ACTIVE";
}

export function docStatus(
  expirationDate: string | null,
): "VALID" | "EXPIRING" | "EXPIRED" | "MISSING" {
  if (!expirationDate) return "MISSING";
  const days = daysUntil(expirationDate);
  if (days == null) return "MISSING";
  if (days < 0) return "EXPIRED";
  if (days <= 30) return "EXPIRING";
  return "VALID";
}
