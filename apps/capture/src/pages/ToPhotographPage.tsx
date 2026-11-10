import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '@glazion/api-client';
import type { TileTaskDto } from '@glazion/types';
import { Icon, clayBodyLabel, formatRelativeTime, toneClass } from '@glazion/ui';
import { myTasksQuery } from '../lib/queries';
import { isReadyForPhoto, isWaitingForCheck } from '../lib/tasks';
import { useOnline } from '../lib/useOnline';

/** Snap with the tile's code (and which of its tiles) already filled in; a tile without a code is photographed as its task. */
const snapLink = (task: TileTaskDto) => (task.recipeCode ? `/snap?${new URLSearchParams({ code: task.recipeCode, task: task.id })}` : `/task/${task.id}`);

function Row({ task }: { task: TileTaskDto }) {
  const ready = isReadyForPhoto(task);
  const body = (
    <>
      <span className="row-icon">
        <Icon name={ready ? 'camera' : 'clock'} size={20} />
      </span>
      <span className="row-body">
        {task.recipeCode && <span className="tile-code row-code">{task.recipeCode}</span>}
        <span className="row-title">{task.recipeName}</span>
        <span className="row-text">
          {clayBodyLabel(task.clayBody)}
          {ready && task.approvedAt && ` · Approved ${formatRelativeTime(task.approvedAt)}`}
          {!ready && task.doneAt && ` · Made ${formatRelativeTime(task.doneAt)}`}
        </span>
        {task.retakeReason && <span className="row-text is-bad">Take the photo again: {task.retakeReason}</span>}
        {!ready && <span className="row-text">Waiting for your admin to check it. You can photograph it once it’s approved.</span>}
      </span>
      {ready ? (
        <span className={toneClass(task.retakeReason ? 'bad' : 'ok')}>{task.retakeReason ? 'Retake' : 'Snap it'}</span>
      ) : (
        <span className={toneClass('warn')}>Checking</span>
      )}
    </>
  );
  // Ready ones open Snap with the code filled in; the rest just say what they are waiting for.
  return <li>{ready ? <Link className="row" to={snapLink(task)}>{body}</Link> : <div className="row row-static">{body}</div>}</li>;
}

/**
 * The tiles you made that still need a photo (meeting 2026-11-02): approved ones open Snap with their code, the ones your
 * admin is still checking wait below. Once anyone photographs a tile, by its code, it leaves this list and its photo
 * shows in Uploads. Only your own tiles show here; your admin sees everyone's.
 */
export default function ToPhotographPage() {
  const online = useOnline();
  const tasks = useQuery(myTasksQuery);
  const all = tasks.data ?? [];
  const ready = all.filter(isReadyForPhoto);
  const checking = all.filter(isWaitingForCheck);

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">To photograph</h1>
          <p className="page-sub">Tiles you made that still need their photo. Tap one to snap it, front and back.</p>
        </div>
        <button className="btn btn-ghost btn-icon" onClick={() => tasks.refetch()} aria-label="Refresh" disabled={tasks.isFetching}>
          {tasks.isFetching ? <span className="spinner" /> : <Icon name="refresh" size={20} />}
        </button>
      </header>

      <main className="page">
        {tasks.isPending && (
          <div className="page-loading">
            <span className="spinner spinner-lg" />
          </div>
        )}

        {tasks.isError && all.length === 0 && (
          <div className="empty">
            <div className="empty-icon">
              <Icon name={online ? 'alert' : 'wifi-off'} size={22} />
            </div>
            <div className="empty-title">{online ? 'Couldn’t load your tiles' : 'You’re offline'}</div>
            <p className="empty-text">{online ? errorMessage(tasks.error) : 'Your tiles will show here once you reconnect.'}</p>
          </div>
        )}

        {tasks.isSuccess && ready.length === 0 && checking.length === 0 && (
          <div className="empty">
            <div className="empty-icon">
              <Icon name="camera" size={22} />
            </div>
            <div className="empty-title">Nothing to photograph</div>
            <p className="empty-text">Tiles you mark as made show here. Once your admin approves one, you can snap it.</p>
            <Link className="btn btn-secondary" to="/">
              Go to your tasks
            </Link>
          </div>
        )}

        {ready.length > 0 && (
          <>
            <h2 className="section-title">
              Ready to snap <span className="muted">{ready.length}</span>
            </h2>
            <ul className="list">
              {ready.map((task) => (
                <Row key={task.id} task={task} />
              ))}
            </ul>
          </>
        )}

        {checking.length > 0 && (
          <>
            <h2 className="section-title">
              Waiting for your admin to check <span className="muted">{checking.length}</span>
            </h2>
            <ul className="list">
              {checking.map((task) => (
                <Row key={task.id} task={task} />
              ))}
            </ul>
          </>
        )}

        <p className="hint page-foot-hint">
          Someone else can photograph your tile too, by its code on Snap. It leaves this list either way.{' '}
          <Link to="/snap">Snap by code</Link>
        </p>
      </main>
    </>
  );
}
