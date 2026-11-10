import { errorMessage } from '@glazion/api-client';
import { ErrorState } from '@glazion/ui';

export { Empty, Loading } from '@glazion/ui';

export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <ErrorState message={errorMessage(error)} onRetry={onRetry} />;
}

interface LoadMoreProps {
  shown: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}

export function LoadMore({ shown, total, hasMore, loading, onLoadMore }: LoadMoreProps) {
  if (shown === 0) return null;
  return (
    <div className="table-foot">
      <span className="muted">
        Showing {shown} of {Math.max(total, shown)}
      </span>
      {hasMore && (
        <button className="btn btn-secondary" onClick={onLoadMore} disabled={loading}>
          {loading ? <span className="spinner" /> : 'Load more'}
        </button>
      )}
    </div>
  );
}
