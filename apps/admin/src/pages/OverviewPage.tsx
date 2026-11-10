import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { overviewApi, uploadsApi } from '@glazion/api-client';
import { UploadStatus, type OverviewDto } from '@glazion/types';
import { Icon, formatRelativeTime } from '@glazion/ui';
import { Empty, LoadError, Loading } from '../components/ListState';

const STATS: { key: keyof OverviewDto; label: string; to: string }[] = [
  { key: 'pendingReview', label: 'Waiting for review', to: '/uploads' },
  { key: 'totalUploads', label: 'Total uploads', to: '/uploads' },
  { key: 'activeCaptureCodes', label: 'Active capture codes', to: '/capture-codes' },
  { key: 'activeRecipes', label: 'Active recipes', to: '/recipes' },
  { key: 'totalUsers', label: 'Users', to: '/users' },
];

export default function OverviewPage() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: overviewApi.get, refetchInterval: 60_000 });
  const queue = useQuery({
    queryKey: ['uploads', 'queue-preview'],
    queryFn: () => uploadsApi.list({ status: UploadStatus.NeedsReview, pageSize: 5 }),
  });
  const waiting = queue.data?.items ?? [];

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-sub">Where the tile library stands right now.</p>
        </div>
      </header>

      <div className="content">
        {overview.isPending ? (
          <Loading />
        ) : overview.isError ? (
          <div className="card">
            <LoadError error={overview.error} onRetry={() => overview.refetch()} />
          </div>
        ) : (
          <div className="stats">
            {STATS.map((stat) => (
              <Link key={stat.key} to={stat.to} className="stat">
                <span className="stat-label">{stat.label}</span>
                <span className="stat-value">{overview.data[stat.key].toLocaleString()}</span>
              </Link>
            ))}
          </div>
        )}

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Review queue</h2>
            <Link to="/uploads" className="card-link">
              Open review
              <Icon name="chevron-right" size={16} />
            </Link>
          </div>

          {queue.isPending ? (
            <Loading />
          ) : queue.isError ? (
            <LoadError error={queue.error} onRetry={() => queue.refetch()} />
          ) : waiting.length === 0 ? (
            <Empty icon="check" title="Nothing waiting" text="New tile photos will show up here as soon as they’re uploaded." />
          ) : (
            <ul className="queue">
              {waiting.map((upload) => (
                <li key={upload.id}>
                  <Link to="/uploads" className="queue-row">
                    <span className="thumb">
                      {upload.downloadUrl ? <img src={upload.downloadUrl} alt="" loading="lazy" /> : <Icon name="image" size={18} />}
                    </span>
                    <span className="queue-body">
                      <span className="queue-name truncate">{upload.fileName ?? 'Untitled photo'}</span>
                      <span className="muted">
                        {upload.ownerUsername ? `@${upload.ownerUsername}` : 'Unknown user'} · {formatRelativeTime(upload.createdAt)}
                      </span>
                    </span>
                    <Icon name="chevron-right" size={16} className="muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
