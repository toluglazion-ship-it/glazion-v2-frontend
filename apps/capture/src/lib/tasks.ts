import type { MatchCheckMaterial, TileTaskDto } from '@glazion/types';
import { formatDate } from '@glazion/ui';

/** A due date (YYYY-MM-DD) as the calendar day it names, whatever the phone's time zone. */
export const dueText = (dueOn: string | null) => (dueOn ? formatDate(`${dueOn}T12:00:00`) : null);

/** Still with you to make: not started (press Start to see the recipe), or started. */
export const isToMake = (task: TileTaskDto) => task.stage === 'Assigned' || task.stage === 'Started';

/** Made, and your admin is checking it before it is photographed. */
export const isWaitingForCheck = (task: TileTaskDto) => task.stage === 'Done';

/** Checked and approved: photograph it once fired (or again, after a rejected photo). Anyone can, by its code. */
export const isReadyForPhoto = (task: TileTaskDto) => task.stage === 'AwaitingPhoto';

/** "Cone 6 · Oxidation", or null when the recipe has no firing recorded. */
export function firingText(cone: string | null | undefined, atmosphere: string | null | undefined): string | null {
  const parts = [cone ? `Cone ${cone}` : null, atmosphere ? atmosphere[0].toUpperCase() + atmosphere.slice(1) : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** A metallic oxide or a stain: what colours the tile. */
export const isColorant = (m: MatchCheckMaterial) => m.kind === 'colorant' || m.kind === 'stain';

export const kindLabel = (m: MatchCheckMaterial) => (m.kind === 'stain' ? 'Stain' : m.kind === 'colorant' ? 'Metallic oxide' : null);

export function amountText(m: MatchCheckMaterial): string {
  if (m.amount === null) return '—';
  const unit = !m.unit || m.unit === '%' ? '%' : ` ${m.unit}`;
  return `${Number(m.amount.toFixed(3))}${unit}`;
}

/** The sum of a set of rows given in %, or null when they mix units. */
export function totalPercent(rows: MatchCheckMaterial[]): number | null {
  if (rows.some((r) => r.unit && r.unit !== '%')) return null;
  return Number(rows.reduce((sum, r) => sum + (r.amount ?? 0), 0).toFixed(3));
}
