import { z } from 'zod';

export const routeRequestSchema = z.strictObject({
  profile: z.enum(['driving', 'walking', 'cycling', 'transit']),
  waypoints: z
    .array(
      z.strictObject({
        lat: z.number().finite().min(-90).max(90),
        lng: z.number().finite().min(-180).max(180),
        amapId: z
          .string()
          .regex(/^[A-Za-z0-9]{1,64}$/)
          .optional(),
      }),
    )
    .min(2)
    .max(30),
});
export type RouteRequest = z.infer<typeof routeRequestSchema>;
export type RouteProfile = RouteRequest['profile'];
export type RoutePoint = [number, number]; // TREK uses [latitude, longitude].
export interface RouteLeg {
  distance: number;
  duration: number;
  note?: string;
}
export interface RouteResult extends RouteLeg {
  coordinates: RoutePoint[];
  legs: RouteLeg[];
}
