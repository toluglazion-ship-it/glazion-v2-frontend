import { Fragment } from 'react';
import { coneFromNumber, type Atmosphere, type ColorantKind, type ConfidenceBand, type FiringQuery, type Oxide, type SearchFilters, type SearchResultItem, type SendMessageRequest } from '@glazion/types';
import { clayBodyLabel, type Tone } from '@glazion/ui';

const ATMOSPHERE_LABEL: Record<Atmosphere, string> = { oxidation: 'Oxidation', reduction: 'Reduction', neutral: 'Neutral' };

export function firingLabel(firing: FiringQuery): string {
  const parts: string[] = [];
  if (firing.coneMin !== null && firing.coneMax !== null && firing.coneMin !== firing.coneMax) {
    parts.push(`Cone ${coneFromNumber(firing.coneMin)}–${coneFromNumber(firing.coneMax)}`);
  } else if (firing.coneMin !== null || firing.coneMax !== null) {
    parts.push(`Cone ${coneFromNumber((firing.coneMin ?? firing.coneMax)!)}`);
  }
  if (firing.atmosphere) parts.push(ATMOSPHERE_LABEL[firing.atmosphere] ?? humanise(firing.atmosphere));
  return parts.join(' · ') || 'Firing not recorded';
}

/** "Porcelain · Cone 6 · Oxidation": what the tile is and how it was fired. */
export function tileFacts(item: SearchResultItem): string {
  return [clayBodyLabel(item.tile.clayBody), firingLabel(item.firing)].filter(Boolean).join(' · ');
}

/** What to call a result: its lab code, or its rank when the recipe isn't shown. */
/** What a result is called: its lab code, else its recipe's name, else its place in the list. */
export const resultName = (item: SearchResultItem) => item.source.recipeCode ?? item.source.recipeName ?? `Tile #${item.rank}`;

/** The recipe's name when the result is titled by its lab code, so both show; null otherwise. */
export const recipeNameUnderCode = (item: SearchResultItem) => (item.source.recipeCode ? item.source.recipeName : null);

/**
 * What "Ask Glazion about this tile" sends: the question as the user sees it, and the result it's about. The API looks
 * the result up and tells Glazion its recipe, so no id shows in the conversation; "Tile #1" would mean nothing there.
 */
export function tileQuestion(searchId: string, item: SearchResultItem): SendMessageRequest {
  const looks = [item.tile.surface, item.tile.colourFamily].filter(Boolean).map((v) => humanise(v).toLowerCase());
  const recipe = [item.source.recipeCode, item.source.recipeName].filter(Boolean).join(', ');
  return {
    content: `Tell me about this tile from my tile search${recipe ? `: ${recipe}` : ''} (${[tileFacts(item), ...looks].join(', ')}).`,
    tile: { searchId, imageId: item.imageId },
  };
}

/** The filters chosen for a search, in words: "Porcelain · Glossy · Blue · only tiles fired this way". */
export function filtersLabel(filters: SearchFilters | undefined, strict = false): string {
  const chosen = [
    ...(filters?.clayBodies ?? []).map((key) => clayBodyLabel(key) ?? humanise(key)),
    ...[...(filters?.tileVariantKeys ?? []), ...(filters?.surface ?? []), ...(filters?.opacity ?? []), ...(filters?.colourFamily ?? [])].map(humanise),
  ];
  return [...chosen, ...(strict ? ['only tiles fired this way'] : [])].join(' · ');
}

/** A UMF amount, the same way everywhere: two decimals, and "<0.01" for a trace that would read 0.00. */
export function formatUmf(value: number): string {
  return value > 0 && value < 0.005 ? '<0.01' : value.toFixed(2);
}

/**
 * A search warning from the API in words, or null for one with nothing to say. Unknown codes
 * (snake_case) are left out rather than shown raw; anything already written as a sentence is kept.
 */
export function warningText(warning: string): string | null {
  let m: RegExpMatchArray | null;
  if (warning === 'flux_total_not_unity') return 'The fluxes in this UMF don’t add up to 1, so it was compared as entered.';
  if ((m = warning.match(/^oxide_outside_vector_schema:(.+)$/))) return `${m[1]} isn’t compared in tile search, so it was left out of the match.`;
  if ((m = warning.match(/^Material (.+) oxide sum > 100%$/))) return `The analysis of ${m[1]} adds up to more than 100%, so its chemistry may be a little off.`;
  if ((m = warning.match(/^Unknown oxide (.+) in material (.+)$/))) return `${m[2]} lists ${m[1]}, which Glazion doesn’t know, so that part was left out.`;
  if (/^UMF undefined: flux sum is zero/.test(warning)) return 'This has no flux, so its chemistry can’t be compared. Add a flux such as a feldspar, whiting or a frit.';
  return /\s/.test(warning) ? warning : null;
}

/** How the tile looks, from its labels: "Glossy blue tile", or just "Tile". */
export function tileLooks(item: SearchResultItem): string {
  const looks = [item.tile.surface, item.tile.colourFamily].filter(Boolean).map((v) => humanise(v).toLowerCase());
  return looks.length > 0 ? `${humanise(looks.join(' '))} tile` : 'Tile';
}

/**
 * What a tile photo shows, for people who can't see it: "Glossy blue tile, porcelain, cone 6 oxidation
 * (P01-B1-001)". A generated image says so first.
 */
export function tileAlt(item: SearchResultItem): string {
  const firing = firingLabel(item.firing);
  const parts = [
    tileLooks(item),
    clayBodyLabel(item.tile.clayBody)?.toLowerCase(),
    firing === 'Firing not recorded' ? null : firing.replace(/ · /g, ' ').toLowerCase(),
  ].filter(Boolean);
  const text = `${parts.join(', ')} (${resultName(item)})`;
  return item.resultType === 'synthetic_preview' ? `Generated preview, not a real tile: ${text}` : text;
}

export const TILE_VARIANTS = [
  { key: 'white', label: 'White' },
  { key: 'off_white', label: 'Off-white' },
  { key: 'pink', label: 'Pink' },
];

export const SURFACES = ['glossy', 'satin', 'matte'];

export const COLOURS = ['clear', 'white', 'blue', 'green', 'red', 'brown', 'yellow'];

const FIELD_LABELS: Record<string, string> = {
  cone: 'Cone',
  atmosphere: 'Atmosphere',
  // One plain name for each thing, used everywhere: the tile's own clay colour is its "body colour", and
  // what's added for colour is "colorants", of two kinds: metallic oxides, which show in the UMF, and stains.
  tileVariant: 'Body colour',
  surface: 'Surface',
  fluxBalance: 'Flux balance',
  silicaAlumina: 'Silica : alumina',
  silicaAluminaRatio: 'Silica : alumina',
  colourants: 'Colorants',
};

/** "off_white" -> "Off-white", "fluxBalance" -> "Flux balance". */
export function humanise(key: string | null | undefined): string {
  if (!key) return '—';
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const variant = TILE_VARIANTS.find((v) => v.key === key);
  if (variant) return variant.label;
  const spaced = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const BAND: Record<ConfidenceBand, { label: string; tone: Tone }> = {
  high: { label: 'Close match', tone: 'ok' },
  // Amber rather than blue, which is kept for links.
  medium: { label: 'Fair match', tone: 'warn' },
  low: { label: 'Weak match', tone: 'neutral' },
};

export const percent = (value: number) => `${Math.round(value * 100)}%`;

/** Renders an oxide formula with its numbers as subscripts: Al2O3 -> Al₂O₃. */
export function OxideName({ oxide }: { oxide: string }) {
  return (
    <>
      {oxide.split(/(\d+)/).map((part, i) => (/^\d+$/.test(part) ? <sub key={i}>{part}</sub> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

export const OXIDE_GROUPS: { title: string; hint: string; oxides: Oxide[] }[] = [
  { title: 'Fluxes', hint: 'In a UMF these add up to 1', oxides: ['Li2O', 'Na2O', 'K2O', 'MgO', 'CaO', 'SrO', 'BaO', 'ZnO'] },
  { title: 'Stabilisers', hint: 'Stiffen the melt', oxides: ['Al2O3', 'B2O3'] },
  { title: 'Glass former', hint: '', oxides: ['SiO2'] },
];

export const OTHER_OXIDES: Oxide[] = ['TiO2', 'ZrO2', 'SnO2', 'Fe2O3', 'Cr2O3', 'CuO', 'CoO', 'MnO', 'NiO', 'P2O5', 'PbO'];

/** The oxides metallic oxide colorants bring, as the API groups them (titanium counts, for rutile). */
export const COLORANT_OXIDES = ['Fe2O3', 'FeO', 'CoO', 'CuO', 'Cr2O3', 'MnO', 'NiO', 'V2O5', 'TiO2'];

export const COLORANT_KIND: Record<ColorantKind, { label: string; tone: Tone }> = {
  metallic_oxide: { label: 'Metallic oxide', tone: 'info' },
  stain: { label: 'Stain', tone: 'warn' },
};
