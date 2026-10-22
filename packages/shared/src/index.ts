import { z } from "zod";

export const cardConditionSchema = z.enum([
  "raw_near_mint",
  "raw_lightly_played",
  "raw_moderately_played",
  "raw_heavily_played",
  "raw_damaged",
  "graded",
]);

export type CardCondition = z.infer<typeof cardConditionSchema>;

export const gradingCompanySchema = z.enum(["PSA", "BGS", "CGC", "TAG"]);

export type GradingCompany = z.infer<typeof gradingCompanySchema>;

export const pokemonCardRefSchema = z.object({
  name: z.string(),
  setCode: z.string(),
  number: z.string(),
  rarity: z.string().optional(),
  variant: z.string().optional(),
});

export type PokemonCardRef = z.infer<typeof pokemonCardRefSchema>;

export const scanCandidateSchema = z.object({
  card: pokemonCardRefSchema,
  confidence: z.number().min(0).max(1),
});

export type ScanCandidate = z.infer<typeof scanCandidateSchema>;

export const collectionItemSchema = z.object({
  id: z.string().uuid().optional(),
  card: pokemonCardRefSchema,
  quantity: z.number().int().positive().default(1),
  condition: cardConditionSchema,
  purchasePriceCents: z.number().int().nonnegative().optional(),
  binderId: z.string().uuid().optional(),
});

export type CollectionItem = z.infer<typeof collectionItemSchema>;

export const priceQuoteSchema = z.object({
  source: z.string(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().default("USD"),
  condition: cardConditionSchema.optional(),
  updatedAt: z.string().datetime(),
});

export type PriceQuote = z.infer<typeof priceQuoteSchema>;
