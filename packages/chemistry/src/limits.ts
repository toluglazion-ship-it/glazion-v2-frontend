import limits from './data/glaze-limits.json';
import type { GlazeLimit } from './types';

export const GLAZE_LIMITS: GlazeLimit[] = limits;

/** Cones that have target ranges, in the order they appear in the data. */
export const LIMIT_CONES: string[] = [...new Set(GLAZE_LIMITS.map((limit) => limit.cone))];

export function limitsForCone(cone: string): GlazeLimit[] {
  return GLAZE_LIMITS.filter((limit) => limit.cone === cone);
}
