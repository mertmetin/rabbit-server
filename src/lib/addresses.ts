import { z } from "zod";

const TYPES = ["home", "work", "other"] as const;

const addressSchema = z
  .object({
    address_type: z.enum(TYPES).optional(),
    icon: z.enum(TYPES).optional(),
    label: z.string().trim().max(100).nullish(),
    address_line_1: z.string().trim().min(1).max(255),
    address_line_2: z.string().trim().max(255).nullish(),
    city: z.string().trim().min(1).max(100),
    zone_code: z.string().trim().min(2).max(3).toUpperCase(),
    postal_code: z.string().trim().max(10).nullish(),
    country_code: z.string().trim().length(2).toUpperCase().default("CA"),
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    notes: z.string().trim().max(255).nullish(),
  })
  .transform((a) => ({
    type: a.address_type ?? a.icon ?? "home",
    label: a.label ?? null,
    addressLine1: a.address_line_1,
    addressLine2: a.address_line_2 || null,
    city: a.city,
    provinceCode: a.zone_code,
    postalCode: a.postal_code?.toUpperCase() ?? null,
    countryCode: a.country_code,
    latitude: a.latitude,
    longitude: a.longitude,
    notes: a.notes || null,
  }));

// The app posts `{ address: {...} }`; a bare address object is accepted too.
export const addressBodySchema = z.union([
  z.object({ address: addressSchema }),
  addressSchema.transform((address) => ({ address })),
]);
