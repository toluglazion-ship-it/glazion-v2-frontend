// AI copies for the in-memory mock (mock.ts), shaped as the API sends them (Glazion-v2 docs/ai-copies.md). A copy is
// "made" a few seconds after it is asked for, from the photo itself, so the admin's waiting state can be seen.
import type { AiCopyDto, ImageAssetDto } from '@glazion/types';
import { uid } from './uid';
import { ApiError } from './index';

const MAKING_MS = 4000;
const copies: (AiCopyDto & { readyAt: number })[] = [];

function view(copy: AiCopyDto & { readyAt: number }): AiCopyDto {
  const { readyAt, ...rest } = copy;
  if ((copy.status === 'Queued' || copy.status === 'Generating') && Date.now() >= readyAt) {
    copy.status = 'Ready';
    copy.completedAt = new Date(readyAt).toISOString();
    copy.width = 1024;
    copy.height = 1024;
    copy.usage = { inputTokens: 1300, outputTokens: 4160, totalTokens: 5460 };
    return view(copy);
  }
  if (copy.status === 'Queued' && Date.now() >= readyAt - MAKING_MS / 2) copy.status = 'Generating';
  return { ...rest, status: copy.status };
}

export function handleAiCopiesRequest(images: ImageAssetDto[], adminId: string, method: string, path: string, body: any): { found: boolean; value?: unknown } {
  const m = path.match(/^\/admin\/images\/([0-9a-f-]{36})\/ai-copies(?:\/([0-9a-f-]{36}|revert))?(?:\/(approve|reject))?$/i);
  if (!m) return { found: false };
  const [, imageId, second, action] = m;
  const image = images.find((i) => i.imageId === imageId);
  if (!image) throw new ApiError(404, 'Image was not found.');
  const mine = () => copies.filter((c) => c.imageId === imageId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const find = (id: string) => {
    const copy = copies.find((c) => c.id === id && c.imageId === imageId);
    if (!copy) throw new ApiError(404, 'No AI copy with this ID for this image.', { code: 'ai_copy_not_found' });
    view(copy);
    return copy;
  };

  if (method === 'GET' && !second) return { found: true, value: mine().map(view) };
  if (method === 'POST' && !second) {
    if (mine().map(view).some((c) => c.status === 'Queued' || c.status === 'Generating'))
      throw new ApiError(409, 'Wait for the copy being made to finish, then make another.', { code: 'ai_copy_in_progress' });
    const copy = {
      id: uid(), imageId, status: 'Queued' as const, model: 'gpt-image-2.5-sunburst', quality: body?.quality || 'high', instruction: body?.instruction?.trim() || null,
      displayUrl: image.displayUrl, thumbnailUrl: image.thumbnailUrl, width: null, height: null, error: null, usage: null, createdBy: adminId,
      createdAt: new Date().toISOString(), completedAt: null, reviewedAt: null, readyAt: Date.now() + MAKING_MS,
    };
    copies.push(copy);
    return { found: true, value: view(copy) };
  }
  if (method === 'POST' && second === 'revert') {
    for (const c of mine()) if (c.status === 'Approved') c.status = 'Ready';
    image.displayCopyId = null;
    return { found: true, value: undefined };
  }
  if (method === 'POST' && action === 'approve') {
    const copy = find(second);
    if (!['Ready', 'Rejected', 'Approved'].includes(copy.status)) throw new ApiError(409, 'Only a finished copy can be approved.', { code: 'ai_copy_not_ready' });
    for (const c of mine()) if (c.status === 'Approved') c.status = 'Ready';
    copy.status = 'Approved';
    copy.reviewedAt = new Date().toISOString();
    image.displayCopyId = copy.id;
    return { found: true, value: view(copy) };
  }
  if (method === 'POST' && action === 'reject') {
    const copy = find(second);
    if (copy.status === 'Queued' || copy.status === 'Generating') throw new ApiError(409, 'Wait for it to finish, then discard it.', { code: 'ai_copy_in_progress' });
    if (copy.status === 'Approved') image.displayCopyId = null;
    copy.status = 'Rejected';
    copy.reviewedAt = new Date().toISOString();
    return { found: true, value: view(copy) };
  }
  return { found: false };
}
