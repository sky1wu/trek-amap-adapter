import { z } from 'zod';

const coordinate = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

const rectangle = z
  .object({ low: coordinate, high: coordinate })
  .strict()
  .refine(
    ({ low, high }) => low.latitude <= high.latitude,
    'Rectangle latitude bounds are inverted',
  );

export const locationBiasSchema = z.union([
  z
    .object({
      circle: z.object({ center: coordinate, radius: z.number().min(0).max(50000) }).strict(),
    })
    .strict(),
  z.object({ rectangle }).strict(),
]);

const language = z
  .string()
  .trim()
  .min(1)
  .max(35)
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/)
  .default('zh-CN');
const session = z.string().min(1).max(256);
const keywords = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (s) => [...s].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127),
    'Invalid keyword',
  );

export const textSearchSchema = z
  .object({
    textQuery: keywords,
    languageCode: language,
    locationBias: locationBiasSchema.optional(),
    pageSize: z.number().int().min(1).max(20).default(20),
  })
  .strict();

export const autocompleteSchema = z
  .object({
    input: keywords,
    languageCode: language,
    locationBias: locationBiasSchema.optional(),
    sessionToken: session.optional(),
  })
  .strict();

export const detailsQuerySchema = z
  .object({
    languageCode: language,
    sessionToken: session.optional(),
  })
  .strict();

export const detailsParamsSchema = z.object({
  placeId: z.string().regex(/^amap_[A-Za-z0-9]{1,64}$/),
});

export const fieldMaskSchema = z.string().max(2048).optional();
export type LocationBias = z.infer<typeof locationBiasSchema>;
export type TextSearchRequest = z.infer<typeof textSearchSchema>;
export type AutocompleteRequest = z.infer<typeof autocompleteSchema>;

export function biasCenter(bias: LocationBias | undefined) {
  if (!bias) return undefined;
  if ('circle' in bias) return bias.circle.center;
  const { low, high } = bias.rectangle;
  // Google rectangles may cross the antimeridian.
  const east = high.longitude < low.longitude ? high.longitude + 360 : high.longitude;
  const longitude = (low.longitude + east) / 2;
  return {
    latitude: (low.latitude + high.latitude) / 2,
    longitude: longitude > 180 ? longitude - 360 : longitude,
  };
}
