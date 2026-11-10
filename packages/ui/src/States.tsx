import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface EmptyProps {
  icon: IconName;
  title: string;
  text: string;
  action?: ReactNode;
}

export function Empty({ icon, title, text, action }: EmptyProps) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={22} />
      </div>
      <div className="empty-title">{title}</div>
      <p className="empty-text">{text}</p>
      {action}
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading" role="status" aria-label="Loading">
      <span className="spinner spinner-lg" />
    </div>
  );
}

/**
 * Grey bars in the shape of what's loading, so the page doesn't jump when it arrives. `rows` is how
 * many list rows to sketch; each is a line of text and a shorter one under it.
 */
export function Skeleton({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="skeleton" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" aria-hidden="true">
          <span className="skeleton-line" style={{ width: `${[78, 62, 70, 55][i % 4]}%` }} />
          <span className="skeleton-line skeleton-line-sm" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ title = 'Couldn’t load this', message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <Empty
      icon="alert"
      title={title}
      text={message}
      action={
        onRetry && (
          <button className="btn btn-secondary" onClick={onRetry}>
            Try again
          </button>
        )
      }
    />
  );
}
