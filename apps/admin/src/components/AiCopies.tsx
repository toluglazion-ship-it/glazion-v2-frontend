import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, imagesApi } from '@glazion/api-client';
import type { AiCopyDto, AiCopyStatus, ImageAssetDto } from '@glazion/types';
import { Icon, formatDateTime, toast, toneClass, type Tone } from '@glazion/ui';

const STATUS: Record<AiCopyStatus, { label: string; tone: Tone }> = {
  Queued: { label: 'Waiting to be made', tone: 'info' },
  Generating: { label: 'Being made', tone: 'info' },
  Ready: { label: 'Ready to compare', tone: 'warn' },
  Failed: { label: 'Failed', tone: 'bad' },
  Approved: { label: 'Shown instead of the photo', tone: 'ok' },
  Rejected: { label: 'Discarded', tone: 'neutral' },
};

/** Quality is a trade: higher is closer to the photo and costs more (see docs/ai-copies.md). */
const QUALITIES = [
  { value: 'high', label: 'High (recommended)' },
  { value: 'xhigh', label: 'Higher' },
  { value: 'max', label: 'Best, slowest' },
  { value: 'medium', label: 'Medium, cheaper' },
];

const making = (c: AiCopyDto) => c.status === 'Queued' || c.status === 'Generating';

/**
 * The photo's AI copies: make one (a new photo of the same glaze, from this photo), compare it beside the photo, and
 * show it instead of the photo everywhere, or discard it and try again with an instruction.
 */
export default function AiCopies({ image }: { image: ImageAssetDto }) {
  const queryClient = useQueryClient();
  const [instruction, setInstruction] = useState('');
  const [quality, setQuality] = useState('high');
  const [picked, setPicked] = useState<string | null>(null);

  const copies = useQuery({
    queryKey: ['images', image.imageId, 'ai-copies'],
    queryFn: () => imagesApi.aiCopies(image.imageId),
    // While one is being made, check every few seconds; it takes about a minute.
    refetchInterval: (query) => (query.state.data?.some(making) ? 3000 : false),
  });
  const list = copies.data ?? [];
  const busy = list.some(making);
  const shown = list.find((c) => c.status === 'Approved');
  const compared = list.find((c) => c.id === picked) ?? list.find((c) => c.status === 'Ready' || c.status === 'Approved') ?? list[0];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['images', image.imageId, 'ai-copies'] });
    queryClient.invalidateQueries({ queryKey: ['images'] });
  };
  const make = useMutation({
    mutationFn: () => imagesApi.makeAiCopy(image.imageId, { instruction: instruction.trim() || null, quality }),
    onSuccess: (copy) => {
      setPicked(copy.id);
      setInstruction('');
      refresh();
    },
  });
  const approve = useMutation({
    mutationFn: (copyId: string) => imagesApi.approveAiCopy(image.imageId, copyId),
    onSuccess: () => {
      toast('The AI copy is now shown instead of the photo');
      refresh();
    },
  });
  const reject = useMutation({ mutationFn: (copyId: string) => imagesApi.rejectAiCopy(image.imageId, copyId), onSuccess: refresh });
  const revert = useMutation({
    mutationFn: () => imagesApi.revertAiCopy(image.imageId),
    onSuccess: () => {
      toast('The photo is shown again');
      refresh();
    },
  });
  const failure = make.error ?? approve.error ?? reject.error ?? revert.error;
  const original = image.downloadUrl ?? image.displayUrl;

  return (
    <section className="ai-copies" aria-label="AI copy">
      <div className="ai-copies-head">
        <div>
          <h3 className="section-label">AI copy</h3>
          <p className="muted">
            A new photo of the same glaze, made by AI from this one, to show the public instead of a photo that isn’t ours. Compare it closely before using it.
          </p>
        </div>
        {shown && (
          <button className="btn btn-sm btn-secondary" onClick={() => revert.mutate()} disabled={revert.isPending}>
            {revert.isPending && <span className="spinner" />}
            Show the photo again
          </button>
        )}
      </div>

      {failure && (
        <div className="alert" role="alert">
          <Icon name="alert" size={18} />
          <span>{errorMessage(failure)}</span>
        </div>
      )}

      {compared && (
        <div className="ai-compare">
          <figure>
            <div className="ai-compare-image">{original ? <img src={original} alt="The photo" /> : <Icon name="image" size={28} />}</div>
            <figcaption>The photo</figcaption>
          </figure>
          <figure>
            <div className="ai-compare-image">
              {making(compared) ? (
                <span className="ai-making">
                  <span className="spinner spinner-lg" />
                  Making the copy. This takes about a minute.
                </span>
              ) : compared.displayUrl ? (
                <a href={compared.displayUrl} target="_blank" rel="noreferrer" title="Open full size">
                  <img src={compared.displayUrl} alt="The AI copy" />
                </a>
              ) : (
                <span className="ai-making">{compared.error ?? 'No picture.'}</span>
              )}
            </div>
            <figcaption>
              <span className={toneClass(STATUS[compared.status].tone)}>{STATUS[compared.status].label}</span>
              {compared.instruction && <span className="muted"> “{compared.instruction}”</span>}
            </figcaption>
          </figure>
        </div>
      )}

      {compared && (compared.status === 'Ready' || compared.status === 'Rejected') && (
        <div className="ai-actions">
          <button className="btn btn-primary btn-sm" onClick={() => approve.mutate(compared.id)} disabled={approve.isPending}>
            {approve.isPending ? <span className="spinner" /> : <Icon name="check" size={16} />}
            Use this copy
          </button>
          {compared.status === 'Ready' && (
            <button className="btn btn-ghost btn-sm" onClick={() => reject.mutate(compared.id)} disabled={reject.isPending}>
              Discard
            </button>
          )}
        </div>
      )}

      <form
        className="ai-make"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) make.mutate();
        }}
      >
        <input
          className="input"
          placeholder={list.length ? 'What to change this time, e.g. less shine, keep the speckles (optional)' : 'Anything to keep in mind (optional)'}
          value={instruction}
          maxLength={500}
          onChange={(e) => setInstruction(e.target.value)}
          aria-label="Instruction for the AI copy"
        />
        <select className="select" value={quality} onChange={(e) => setQuality(e.target.value)} aria-label="Quality">
          {QUALITIES.map((q) => (
            <option key={q.value} value={q.value}>
              {q.label}
            </option>
          ))}
        </select>
        <button className="btn btn-secondary" type="submit" disabled={busy || make.isPending}>
          {make.isPending || busy ? <span className="spinner" /> : <Icon name="refresh" size={16} />}
          {list.length ? 'Make another copy' : 'Make AI copy'}
        </button>
      </form>

      {list.length > 1 && (
        <ul className="ai-list" aria-label="Copies made">
          {list.map((c) => (
            <li key={c.id}>
              <button className={`ai-thumb${c.id === compared?.id ? ' is-active' : ''}`} onClick={() => setPicked(c.id)} title={STATUS[c.status].label}>
                {c.thumbnailUrl && !making(c) ? <img src={c.thumbnailUrl} alt="" /> : making(c) ? <span className="spinner" /> : <Icon name="alert" size={18} />}
              </button>
              <span className="muted">{formatDateTime(c.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
