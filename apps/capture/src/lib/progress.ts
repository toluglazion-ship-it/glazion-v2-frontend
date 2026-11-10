import { useQuery } from '@tanstack/react-query';
import { myUploadsApi } from '@glazion/api-client';
import { UploadStatus, type UploadDto } from '@glazion/types';
import type { Tone } from '@glazion/ui';
import { useUploadQueue } from './uploadQueue';

// How far each recipe on the Recipes screen has got, so a tester can see which tiles are left.

export type RecipeProgress = 'approved' | 'review' | 'waiting' | 'rejected';

export const PROGRESS: Record<RecipeProgress, { label: string; tone: Tone }> = {
  approved: { label: 'Approved', tone: 'ok' },
  review: { label: 'In review', tone: 'warn' },
  waiting: { label: 'Waiting to upload', tone: 'info' },
  rejected: { label: 'Rejected', tone: 'bad' },
};

/** A recipe shows the furthest any of its photos has got. */
const RANK: Record<RecipeProgress, number> = { approved: 4, review: 3, waiting: 2, rejected: 1 };

function progressOf(status: UploadStatus): RecipeProgress | null {
  switch (status) {
    case UploadStatus.Approved:
    case UploadStatus.Indexing:
    case UploadStatus.Indexed:
      return 'approved';
    case UploadStatus.Uploaded:
    case UploadStatus.Validating:
    case UploadStatus.NeedsReview:
      return 'review';
    case UploadStatus.Rejected:
      return 'rejected';
    default:
      // Not sent yet, failed or cancelled: the photo still to be taken, as far as the tile goes.
      return null;
  }
}

/** Your latest uploads, newest first: up to five pages of 100, plenty for one capture code. */
async function recentUploads(): Promise<UploadDto[]> {
  const all: UploadDto[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const result = await myUploadsApi.list({ pageSize: 100, cursor });
    all.push(...(result.items ?? []));
    cursor = result.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return all;
}

export function useRecipeProgress(): { byRecipe: Map<string, RecipeProgress>; ready: boolean } {
  // Under ['my-uploads'], so a finished upload refreshes it along with the Uploads screen.
  const uploads = useQuery({ queryKey: ['my-uploads', 'by-recipe'], queryFn: recentUploads });
  const queue = useUploadQueue();

  const byRecipe = new Map<string, RecipeProgress>();
  const mark = (recipeId: string, progress: RecipeProgress) => {
    const current = byRecipe.get(recipeId);
    if (!current || RANK[progress] > RANK[current]) byRecipe.set(recipeId, progress);
  };
  for (const upload of uploads.data ?? []) {
    const progress = progressOf(upload.status);
    if (upload.recipeId && progress) mark(upload.recipeId, progress);
  }
  for (const item of queue.items) mark(item.recipeId, 'waiting');
  return { byRecipe, ready: uploads.isSuccess };
}
