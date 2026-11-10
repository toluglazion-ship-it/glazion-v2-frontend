import type { MatchCheckMaterial, OxideComparison, OxideGroup, SearchCheckShown, SearchCheckSummary } from '@glazion/types';
import type { Tone } from '@glazion/ui';

// Match check: what a search was given beside what it suggested (Glazion-v2 docs/match-check.md).

export const QUERY_TYPE_LABEL: Record<SearchCheckSummary['queryType'], string> = {
  raw_recipe: 'Typed recipe',
  recipe: 'Saved recipe',
  umf: 'UMF',
};

export const SHOWN_LABEL: Record<SearchCheckShown, string> = {
  closest: 'Closest match',
  similar: 'Similar glaze',
  ranked: 'Further down the list',
};

/** Colorant is the umbrella: a metallic oxide or a stain. Other kinds are the material list's categories. */
const KIND: Record<string, { label: string; tone: Tone }> = {
  colorant: { label: 'Metallic oxide', tone: 'info' },
  stain: { label: 'Stain', tone: 'warn' },
  silica: { label: 'Silica', tone: 'neutral' },
  clay: { label: 'Clay', tone: 'neutral' },
  feldspar: { label: 'Feldspar', tone: 'neutral' },
  flux: { label: 'Flux', tone: 'neutral' },
  frit: { label: 'Frit', tone: 'neutral' },
  opacifier: { label: 'Opacifier', tone: 'neutral' },
  ash: { label: 'Ash', tone: 'neutral' },
  additive: { label: 'No chemistry', tone: 'neutral' },
  other: { label: 'Other', tone: 'neutral' },
};

export function kindMeta(kind: string | null): { label: string; tone: Tone } | null {
  return kind ? (KIND[kind] ?? { label: kind, tone: 'neutral' }) : null;
}

export const isColorant = (m: MatchCheckMaterial) => m.kind === 'colorant' || m.kind === 'stain';

/** Colorants first: what the eye sees, and what Toluwalope asked to check. */
export const GROUP_ORDER: OxideGroup[] = ['colourant', 'flux', 'stabiliser', 'glass', 'opacifier', 'other'];

export const GROUP_LABEL: Record<OxideGroup, string> = {
  colourant: 'Colorants (metallic oxides)',
  flux: 'Fluxes',
  stabiliser: 'Stabilisers',
  glass: 'Glass former',
  opacifier: 'Opacifiers',
  other: 'Other oxides',
};

export const umfText = (value: number | null) => (value === null ? '—' : value.toFixed(3));

export function diffText(value: number | null): string {
  if (value === null) return '—';
  if (Math.abs(value) < 0.0005) return '0';
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(3)}`;
}

/**
 * How much a difference matters. Colorants are tiny numbers that change the colour completely, so one side having
 * a colouring oxide and the other not is the loudest signal; for the rest, how far apart they are in proportion.
 */
export function diffTone(row: OxideComparison): Tone | null {
  const s = row.searched ?? 0;
  const t = row.tile ?? 0;
  const high = Math.max(Math.abs(s), Math.abs(t));
  if (row.searched === null || row.tile === null || high === 0) return null;
  const share = Math.abs(t - s) / high;
  if (row.group === 'colourant') {
    if ((s === 0) !== (t === 0) && high >= 0.002) return 'bad';
    return share >= 0.3 ? 'warn' : null;
  }
  return share >= 0.25 ? 'bad' : share >= 0.1 ? 'warn' : null;
}

export const scoreText = (score: number | null | undefined) => (score === null || score === undefined ? '—' : `${Math.round(score * 100)}%`);

export function amountText(m: MatchCheckMaterial): string {
  if (m.amount === null) return '—';
  const unit = !m.unit || m.unit === '%' ? '%' : ` ${m.unit}`;
  return `${Number(m.amount.toFixed(3))}${unit}`;
}
