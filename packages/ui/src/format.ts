import { AccountStatus, CLAY_BODIES, UploadStatus, type QualityStatus } from '@glazion/types';

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info';

export function toneClass(tone: Tone): string {
  return tone === 'neutral' ? 'badge' : `badge badge-${tone}`;
}

interface StatusMeta {
  label: string;
  tone: Tone;
}

const UPLOAD_STATUS: Record<UploadStatus, StatusMeta> = {
  [UploadStatus.Created]: { label: 'Created', tone: 'neutral' },
  [UploadStatus.AwaitingUpload]: { label: 'Not uploaded', tone: 'neutral' },
  [UploadStatus.Uploaded]: { label: 'Uploaded', tone: 'info' },
  [UploadStatus.Validating]: { label: 'Checking', tone: 'info' },
  [UploadStatus.NeedsReview]: { label: 'In review', tone: 'warn' },
  [UploadStatus.Approved]: { label: 'Approved', tone: 'ok' },
  [UploadStatus.Rejected]: { label: 'Rejected', tone: 'bad' },
  // Plain words for the search-index steps: the photo is being added to the tile library, then is in it.
  [UploadStatus.Indexing]: { label: 'Adding to library', tone: 'info' },
  [UploadStatus.Indexed]: { label: 'In the library', tone: 'ok' },
  [UploadStatus.Failed]: { label: 'Failed', tone: 'bad' },
  [UploadStatus.Cancelled]: { label: 'Cancelled', tone: 'neutral' },
};

export function uploadStatusMeta(status: UploadStatus): StatusMeta {
  return UPLOAD_STATUS[status] ?? { label: 'Unknown', tone: 'neutral' };
}

const ACCOUNT_STATUS: Record<AccountStatus, StatusMeta> = {
  [AccountStatus.Pending]: { label: 'Pending', tone: 'warn' },
  [AccountStatus.Active]: { label: 'Active', tone: 'ok' },
  [AccountStatus.Suspended]: { label: 'Suspended', tone: 'bad' },
  [AccountStatus.Disabled]: { label: 'Disabled', tone: 'neutral' },
};

export function accountStatusMeta(status: AccountStatus): StatusMeta {
  return ACCOUNT_STATUS[status] ?? { label: 'Unknown', tone: 'neutral' };
}

const QUALITY_STATUS: Record<QualityStatus, StatusMeta> = {
  Pending: { label: 'Not checked yet', tone: 'neutral' },
  Passed: { label: 'Passed', tone: 'ok' },
  NeedsReview: { label: 'Needs a look', tone: 'warn' },
  Failed: { label: 'Failed', tone: 'bad' },
};

/** The automatic photo check. Null when the server sent nothing. */
export function qualityStatusMeta(status: QualityStatus | null | undefined): StatusMeta | null {
  return status ? (QUALITY_STATUS[status] ?? { label: status, tone: 'neutral' }) : null;
}

/**
 * "Porcelain" for "porcelain"; anything the frontend doesn't know is shown as the server sent it.
 * Photos sent before the switch to "red_body" carry "red", which is the same clay.
 */
export function clayBodyLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.toLowerCase() === 'red' ? 'red_body' : value.toLowerCase();
  return CLAY_BODIES.find((c) => c.value === key)?.label ?? value;
}

/** What to call a recipe in a list: its name, else its tile code. */
export function recipeTitle(recipe: { name: string | null; code?: string | null }): string {
  return recipe.name?.trim() || recipe.code || 'Untitled recipe';
}
