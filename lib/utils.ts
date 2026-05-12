import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format an amount in the Finnish/European convention: "5 294,22 €"
 * (thin space thousands separator, comma decimal, suffixed currency).
 *
 * Designed for an AP tool used by Finnish bookkeepers — the standard
 * en-GB "€5,294.22" reads as foreign and creates a tiny "this wasn't
 * built for me" friction point. Match the convention of the audience.
 */
export function formatEuro(amount: number | null | undefined, currency: string | null = "EUR"): string {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("fi-FI", {
    style: "currency",
    currency: currency || "EUR",
    maximumFractionDigits: 2,
  }).format(amount);
}