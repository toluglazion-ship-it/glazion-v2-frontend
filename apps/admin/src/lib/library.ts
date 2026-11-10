import type { ApprovalStatus, ChemistryStatus, ImportRecordStatus, JobStatus } from '@glazion/types';
import type { Tone } from '@glazion/ui';

interface Meta {
  label: string;
  tone: Tone;
}

const meta = <K extends string>(map: Record<K, Meta>) => (value: K | null | undefined): Meta =>
  (value && map[value]) || { label: value ?? '—', tone: 'neutral' };

export const approvalMeta = meta<ApprovalStatus>({
  Pending: { label: 'Waiting', tone: 'warn' },
  Approved: { label: 'Approved', tone: 'ok' },
  Rejected: { label: 'Rejected', tone: 'bad' },
  Superseded: { label: 'Replaced', tone: 'neutral' },
});

export const chemistryMeta = meta<ChemistryStatus>({
  Linked: { label: 'Chemistry linked', tone: 'ok' },
  Missing: { label: 'No chemistry', tone: 'warn' },
  Pending: { label: 'Working it out', tone: 'neutral' },
  Invalid: { label: 'Chemistry invalid', tone: 'bad' },
});

export const recordStatusMeta = meta<ImportRecordStatus>({
  Registered: { label: 'Waiting for file', tone: 'neutral' },
  Uploaded: { label: 'Uploaded', tone: 'info' },
  Validated: { label: 'Checked', tone: 'ok' },
  NeedsReview: { label: 'Needs a look', tone: 'warn' },
  Failed: { label: 'Failed', tone: 'bad' },
});

export const jobStatusMeta = meta<JobStatus>({
  Queued: { label: 'Queued', tone: 'neutral' },
  Running: { label: 'Running', tone: 'info' },
  Succeeded: { label: 'Done', tone: 'ok' },
  Failed: { label: 'Failed', tone: 'bad' },
  DeadLetter: { label: 'Gave up', tone: 'bad' },
});

/** The API keeps some lists as JSON text. Anything that isn't a list of strings reads as empty. */
export function parseList(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))) : [];
  } catch {
    return [];
  }
}

/** "tile not centred" -> "Tile not centred", "glare" -> "Glare". */
export const sentence = (text: string) => {
  const spaced = text.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/**
 * The tile code in a file name, written the way the register writes it: "p01-b1-2 front.jpg"
 * gives "P01-B1-002" (and "p01-b1-1200" gives "P01-B1-1200"). Null when the name has no code.
 */
export function codeFromFileName(fileName: string): string | null {
  const match = fileName.match(/(?<![A-Za-z])([A-Za-z]\d{2,3})[-_ ]?([Bb]\d{1,3})[-_ ](\d{1,4})(?!\d)/);
  if (!match) return null;
  return `${match[1].toUpperCase()}-${match[2].toUpperCase()}-${match[3].padStart(3, '0')}`;
}

/** Hex SHA-256 of a file, so the server can spot a photo it already has. */
export async function sha256Hex(file: Blob): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Not available outside a secure context; the server takes the file without it.
    return null;
  }
}

/** Orton cones as the forms list them, low to high. Below cone 1 they travel as negatives (06 -> -6). */
export const CONES = ['010', '09', '08', '07', '06', '05', '04', '03', '02', '01', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

export const coneToNumber = (cone: string) => (cone.startsWith('0') ? -Number(cone.slice(1)) : Number(cone));
export const coneFromNumber = (value: number) => (value < 0 ? `0${-value}` : String(value));

export function firingText(coneMin: number | null, coneMax: number | null, atmosphere: string | null): string {
  const parts: string[] = [];
  if (coneMin !== null && coneMax !== null && coneMin !== coneMax) parts.push(`Cone ${coneFromNumber(coneMin)}–${coneFromNumber(coneMax)}`);
  else if (coneMin !== null || coneMax !== null) parts.push(`Cone ${coneFromNumber((coneMin ?? coneMax)!)}`);
  if (atmosphere) parts.push(sentence(atmosphere.toLowerCase()));
  return parts.join(' · ') || 'Not recorded';
}

export const TILE_BODIES = [
  { key: 'white', label: 'White' },
  { key: 'off_white', label: 'Off-white' },
  { key: 'pink', label: 'Pink' },
];

export const tileBodyLabel = (key: string | null) => TILE_BODIES.find((t) => t.key === key)?.label ?? (key ? sentence(key) : '—');
