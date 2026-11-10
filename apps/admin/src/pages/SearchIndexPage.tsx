import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, searchIndexApi, searchSettingsApi } from '@glazion/api-client';
import type { JobDto, JobStatus } from '@glazion/types';
import { Icon, Modal, formatRelativeTime, toast, toneClass } from '@glazion/ui';
import { Empty, LoadError, Loading } from '../components/ListState';
import { jobStatusMeta, sentence } from '../lib/library';

// The index changes as background jobs run, so these screens refresh themselves.
const REFRESH_MS = 15_000;

const JOB_FILTERS: { label: string; value: JobStatus | undefined }[] = [
  { label: 'Failed', value: 'Failed' },
  { label: 'Gave up', value: 'DeadLetter' },
  { label: 'Queued', value: 'Queued' },
  { label: 'Running', value: 'Running' },
  { label: 'Done', value: 'Succeeded' },
  { label: 'All', value: undefined },
];

const canRetry = (job: JobDto) => job.status === 'Failed' || job.status === 'DeadLetter';

/** "index.embed" -> "Index embed", "image.derivatives" -> "Image derivatives". */
const jobName = (type: string | null) => (type ? sentence(type.replace(/[._]/g, ' ')) : 'Job');

function RebuildModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [includeNonApproved, setIncludeNonApproved] = useState(false);
  const rebuild = useMutation({
    mutationFn: () => searchIndexApi.rebuild({ includeNonApproved }),
    onSuccess: ({ enqueued }) => {
      queryClient.invalidateQueries({ queryKey: ['search-index'] });
      toast(`${enqueued} ${enqueued === 1 ? 'photo' : 'photos'} queued for indexing`);
      onClose();
    },
  });

  return (
    <Modal
      title="Rebuild the search index?"
      description="Every photo is indexed again in the background. Search keeps working meanwhile, using the current index."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => rebuild.mutate()} disabled={rebuild.isPending}>
            {rebuild.isPending && <span className="spinner" />}
            Rebuild index
          </button>
        </>
      }
    >
      {rebuild.isError && (
        <div className="alert" role="alert">
          <Icon name="alert" size={18} />
          <span>{errorMessage(rebuild.error)}</span>
        </div>
      )}
      <p className="modal-note">Only needed after a change to how photos are matched, or if the counts below look wrong. New photos are indexed on their own once approved.</p>
      <label className="switch">
        <input type="checkbox" checked={includeNonApproved} onChange={(e) => setIncludeNonApproved(e.target.checked)} />
        <span>
          <span className="cell-strong">Include photos that aren’t approved</span>
          <span className="muted">They’re indexed but still not shown in search until approved.</span>
        </span>
      </label>
    </Modal>
  );
}

/**
 * Strict firing (meeting 2026-10-29): on, a search with a cone shows only tiles fired within one cone of it, in the
 * same atmosphere, and none whose cone wasn't recorded. Off, firing only lowers a tile's place in the results.
 */
function SearchSettingsCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['search-settings'], queryFn: searchSettingsApi.get });
  const update = useMutation({
    mutationFn: (strictFiring: boolean) => searchSettingsApi.update({ strictFiring }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['search-settings'], saved);
      toast(saved.strictFiring ? 'Search now shows only tiles fired within one cone' : 'Search now shows tiles fired at any cone, closest first');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const on = settings.data?.strictFiring ?? true;

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">Search settings</h2>
        {settings.data?.updatedAt && <span className="muted">Changed: {formatRelativeTime(settings.data.updatedAt)}</span>}
      </div>
      {settings.isError ? (
        <LoadError error={settings.error} onRetry={() => settings.refetch()} />
      ) : (
        <label className="switch">
          <input type="checkbox" checked={on} disabled={settings.isPending || update.isPending} onChange={(e) => update.mutate(e.target.checked)} />
          <span>
            <span className="cell-strong">Only show tiles fired within one cone</span>
            <span className="muted">
              {on
                ? 'A cone 6 search shows tiles fired at cone 5, 6 or 7, in the same atmosphere. Tiles with no cone recorded are left out.'
                : 'Tiles fired at other cones still show, lower down the results. People can still choose “Only tiles fired this way”.'}
            </span>
          </span>
        </label>
      )}
    </div>
  );
}

/** The newest jobs with the chosen status. The API allows up to 500 a page. */
const JOBS_SHOWN = 100;

export default function SearchIndexPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<JobStatus | undefined>('Failed');
  const [rebuilding, setRebuilding] = useState(false);

  const status = useQuery({ queryKey: ['search-index', 'status'], queryFn: searchIndexApi.status, refetchInterval: REFRESH_MS });
  const jobs = useQuery({
    queryKey: ['search-index', 'jobs', filter ?? 'all'],
    queryFn: () => searchIndexApi.jobs({ status: filter, pageSize: JOBS_SHOWN }),
    refetchInterval: REFRESH_MS,
  });
  const shownJobs = jobs.data?.items ?? [];
  const totalJobs = jobs.data?.totalCount ?? 0;

  const retry = useMutation({
    mutationFn: (job: JobDto) => searchIndexApi.retryJob(job.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['search-index'] });
      toast('Job queued to run again');
    },
  });

  const s = status.data;
  const coverage = s && s.approvedImages > 0 ? Math.round((s.indexedImages / s.approvedImages) * 100) : null;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Search index</h1>
          <p className="page-sub">How much of the approved library search can find, and the background jobs that keep it up to date.</p>
        </div>
        <button className="btn btn-secondary" onClick={() => setRebuilding(true)}>
          <Icon name="refresh" size={18} />
          Rebuild index…
        </button>
      </header>

      <div className="content">
        <SearchSettingsCard />

        {status.isPending ? (
          <div className="card">
            <Loading />
          </div>
        ) : status.isError ? (
          <div className="card">
            <LoadError error={status.error} onRetry={() => status.refetch()} />
          </div>
        ) : (
          <>
            {s!.providerError && (
              <div className="alert" role="alert">
                <Icon name="alert" size={18} />
                <span>
                  <strong>The search provider reported a problem.</strong> {s!.providerError}
                </span>
              </div>
            )}

            <div className="stats">
              <div className="stat">
                <span className="stat-label">Approved photos</span>
                <span className="stat-value">{s!.approvedImages}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Searchable</span>
                <span className="stat-value">
                  {s!.indexedImages}
                  {coverage !== null && <span className="stat-note"> {coverage}%</span>}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">Waiting to be indexed</span>
                <span className="stat-value">{s!.backlog}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Jobs failed</span>
                <span className="stat-value">{s!.jobs.failed + s!.jobs.deadLetter}</span>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2 className="card-title">Index</h2>
                <span className="muted">
                  {[s!.vectorProvider, s!.embeddingModel, s!.embeddingVersion && `version ${s!.embeddingVersion}`, s!.chemistrySchemaVersion && `chemistry ${s!.chemistrySchemaVersion}`]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              {(s!.namespaces ?? []).length === 0 ? (
                <Empty icon="search" title="Nothing indexed yet" text="Approved photos are indexed in the background." />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Matches on</th>
                        <th>Indexed</th>
                        <th>Replaced</th>
                        <th>Errors</th>
                        <th>Model</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(s!.namespaces ?? []).map((n) => (
                        <tr key={n.namespace ?? n.modality}>
                          <td className="cell-strong">{n.modality === 'Chemistry' ? 'Chemistry' : n.modality === 'Visual' ? 'How the tile looks' : 'Labels and text'}</td>
                          <td>{n.indexed}</td>
                          <td className="muted">{n.superseded}</td>
                          <td className={n.errored ? 'hint-bad' : 'muted'}>{n.errored}</td>
                          <td className="muted">{[n.embeddingModel, n.embeddingVersion].filter(Boolean).join(' · ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">Background jobs</h2>
            {s && (
              <span className="muted">
                {s.jobs.queued} queued · {s.jobs.running} running · {s.jobs.succeeded} done
              </span>
            )}
          </div>
          <div className="card-toolbar">
            <div className="segmented" role="tablist" aria-label="Filter jobs">
              {JOB_FILTERS.map((f) => (
                <button key={f.label} role="tab" aria-selected={filter === f.value} className={filter === f.value ? 'is-active' : ''} onClick={() => setFilter(f.value)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {retry.isError && (
            <div className="alert" role="alert">
              <Icon name="alert" size={18} />
              <span>{errorMessage(retry.error)}</span>
            </div>
          )}
          {jobs.isPending ? (
            <Loading />
          ) : jobs.isError ? (
            <LoadError error={jobs.error} onRetry={() => jobs.refetch()} />
          ) : shownJobs.length === 0 ? (
            filter === 'Failed' || filter === 'DeadLetter' ? (
              <Empty icon="check" title="Nothing has failed" text="Jobs that fail show up here so you can run them again." />
            ) : (
              <Empty icon="clock" title="No jobs" text="No jobs have this status." />
            )
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Status</th>
                      <th>Tries</th>
                      <th>Problem</th>
                      <th>Created</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {shownJobs.map((job) => {
                      const m = jobStatusMeta(job.status);
                      const busy = retry.isPending && retry.variables?.id === job.id;
                      return (
                        <tr key={job.id}>
                          <td>
                            <div className="cell-strong">{jobName(job.jobType)}</div>
                            <div className="muted mono">
                              {job.entityType ?? 'item'} {job.entityId.slice(0, 8)}
                            </div>
                          </td>
                          <td>
                            <span className={toneClass(m.tone)}>{m.label}</span>
                          </td>
                          <td className="muted">
                            {job.attempts} of {job.maxAttempts}
                          </td>
                          <td className="cell-wide">{job.errorDetail ?? job.errorCode ?? <span className="muted">—</span>}</td>
                          <td className="muted">{formatRelativeTime(job.createdAt)}</td>
                          <td className="cell-actions">
                            {canRetry(job) && (
                              <button className="btn btn-sm btn-secondary" onClick={() => retry.mutate(job)} disabled={retry.isPending}>
                                {busy ? <span className="spinner" /> : 'Run again'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {totalJobs > shownJobs.length && (
                <div className="table-foot">
                  <span className="muted">
                    Showing the newest {shownJobs.length} of {totalJobs}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {rebuilding && <RebuildModal onClose={() => setRebuilding(false)} />}
    </>
  );
}
