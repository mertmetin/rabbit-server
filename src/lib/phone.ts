import { z } from "zod";

// Accepts "(613) 555-1234", "613-555-1234", "+1 613 555 1234"; stores "6135551234".
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length === 10 ? digits : null;
}

export const phoneSchema = z
  .string()
  .transform((val, ctx) => {
    const phone = normalizePhone(val);
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "Enter a 10-digit phone number." });
      return z.NEVER;
    }
    return phone;
  });
