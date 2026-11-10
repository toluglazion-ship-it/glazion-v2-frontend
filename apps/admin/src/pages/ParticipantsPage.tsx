import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { baseGlazesApi, tasksApi, uploadsApi, usersApi } from '@glazion/api-client';
import { UploadStatus, type ParticipantActivityDto, type TileTaskDto, type TileTaskStage } from '@glazion/types';
import { Icon, clayBodyLabel, formatDateTime, formatRelativeTime, initials, toneClass } from '@glazion/ui';
import { Empty, LoadError, LoadMore, Loading } from '../components/ListState';
import { CancelTaskModal, ReassignModal, ReturnTasksModal, TaskDetailsModal, useApproveTasks } from '../components/TaskModals';
import { PAGE_SIZE, usePagedList } from '../hooks/usePagedList';
import { STAGE_LABEL, dueText, isMade, stageBadge, useAssignees } from '../lib/tasks';

/** The tabs over a participant's tiles, in the order a tile moves. */
const TILE_TABS: { key: TileTaskStage | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'Assigned', label: STAGE_LABEL.Assigned },
  { key: 'Started', label: STAGE_LABEL.Started },
  { key: 'Done', label: STAGE_LABEL.Done },
  { key: 'AwaitingPhoto', label: STAGE_LABEL.AwaitingPhoto },
  { key: 'InReview', label: STAGE_LABEL.InReview },
  { key: 'Approved', label: STAGE_LABEL.Approved },
  { key: 'Cancelled', label: STAGE_LABEL.Cancelled },
];

const PHOTO_LABEL: Partial<Record<UploadStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }>> = {
  [UploadStatus.Uploaded]: { label: 'Checking', tone: 'warn' },
  [UploadStatus.Validating]: { label: 'Checking', tone: 'warn' },
  [UploadStatus.NeedsReview]: { label: 'In review', tone: 'warn' },
  [UploadStatus.Approved]: { label: 'Approved', tone: 'ok' },
  [UploadStatus.Indexing]: { label: 'Approved', tone: 'ok' },
  [UploadStatus.Indexed]: { label: 'In the library', tone: 'ok' },
  [UploadStatus.Rejected]: { label: 'Rejected', tone: 'bad' },
  [UploadStatus.Failed]: { label: 'Failed checks', tone: 'bad' },
};

/** One line of a participant's history: who did what to which tile. */
function activityLine(a: ParticipantActivityDto): string {
  const who = a.actorUsername ? `@${a.actorUsername}` : 'Someone';
  switch (a.kind) {
    case 'PhotoSent':
      return `${who} sent a photo${a.uploadStatus != null && PHOTO_LABEL[a.uploadStatus] ? ` (${PHOTO_LABEL[a.uploadStatus]!.label.toLowerCase()})` : ''}`;
    case 'Assigned':
      return `${who} assigned it`;
    case 'Reassigned':
      return `${who} moved it to someone else, or to them`;
    case 'Started':
      return `${who} pressed Start`;
    case 'MarkedDone':
      return a.note === 'Photographed' ? `${who} photographed it` : `${who} marked it made`;
    case 'DoneUndone':
      return `${who} took back “made”`;
    case 'CompositionApproved':
      return `${who} checked it and approved it for its photo`;
    case 'Returned':
      return `${who} sent it back`;
    case 'Updated':
      return `${who} changed its due date or note`;
    case 'Cancelled':
      return `${who} deleted it`;
    case 'Restored':
      return `${who} restored it`;
    default:
      return `${who}: ${a.kind}`;
  }
}

/** Everyone with a participant code: pick one to see everything they have. */
function ParticipantList() {
  const navigate = useNavigate();
  const { assignees, isPending, isError, error, refetch } = useAssignees();
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Participants</h1>
          <p className="page-sub">Pick a participant to see everything they have: their tiles and where each one is, their bases, the photos they sent, and every step they took.</p>
        </div>
        <Link className="btn btn-secondary" to="/users">
          Add a participant
        </Link>
      </header>
      <div className="content">
        <div className="card">
          {isPending ? (
            <Loading />
          ) : isError ? (
            <LoadError error={error} onRetry={() => refetch()} />
          ) : assignees.length === 0 ? (
            <Empty icon="users" title="No participants yet" text="Add a user with a participant code on Users." />
          ) : (
            <div className="table-wrap">
              <table className="table table-clickable">
                <thead>
                  <tr>
                    <th>Participant</th>
                    <th>Code</th>
                    <th>Joined</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {assignees.map((u) => (
                    <tr key={u.id} onClick={() => navigate(`/participants/${u.id}`)}>
                      <td>
                        <div className="cell-user">
                          <div className="avatar">{initials(u.displayName ?? u.username)}</div>
                          <div>
                            <div className="cell-strong">{u.displayName ?? u.username}</div>
                            <div className="muted">@{u.username}</div>
                          </div>
                        </div>
                      </td>
                      <td>{u.participantCode ? <span className="tile-code">{u.participantCode}</span> : <span className="muted">—</span>}</td>
                      <td className="muted">{formatRelativeTime(u.createdAt)}</td>
                      <td className="cell-actions">
                        <Link className="btn btn-sm btn-secondary" to={`/participants/${u.id}`} onClick={(e) => e.stopPropagation()}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

type Dialog =
  | { kind: 'details'; id: string }
  | { kind: 'reassign'; tasks: TileTaskDto[] }
  | { kind: 'return'; tasks: TileTaskDto[] }
  | { kind: 'cancel'; task: TileTaskDto }
  | null;

/** One participant, everything about them (meeting 2026-11-02): tiles by stage, bases, photos and history. */
function Participant({ userId }: { userId: string }) {
  const user = useQuery({ queryKey: ['users', userId], queryFn: () => usersApi.getOne(userId) });
  const summary = useQuery({ queryKey: ['tasks', 'summary', { userId }], queryFn: () => tasksApi.summary({ userId }) });
  const [tab, setTab] = useState<TileTaskStage | 'all'>('all');
  const [dialog, setDialog] = useState<Dialog>(null);
  const approve = useApproveTasks();
  const tiles = usePagedList<TileTaskDto>(['tasks', 'participant', userId, tab], (cursor) =>
    tasksApi.list({ userId, stage: tab === 'all' ? undefined : tab, cursor, pageSize: PAGE_SIZE }),
  );
  const code = user.data?.participantCode ?? null;
  const bases = useQuery({ queryKey: ['base-glazes', { participantCode: code }], queryFn: () => baseGlazesApi.list(code!), enabled: !!code });
  const photos = usePagedList(['uploads', 'participant', userId], (cursor) => uploadsApi.list({ ownerUserId: userId, cursor, pageSize: 10 }));
  const activity = useQuery({ queryKey: ['tasks', 'activity', userId], queryFn: () => tasksApi.activity(userId) });
  const s = summary.data;
  const count = (key: TileTaskStage | 'all') =>
    !s
      ? null
      : key === 'all'
        ? s.assigned + (s.started ?? 0) + s.done + (s.awaitingPhoto ?? 0) + s.inReview + s.approved
        : { Assigned: s.assigned, Started: s.started ?? 0, Done: s.done, AwaitingPhoto: s.awaitingPhoto ?? 0, InReview: s.inReview, Approved: s.approved, Cancelled: s.cancelled }[key];
  const name = user.data ? (user.data.displayName ?? `@${user.data.username}`) : '…';
  const close = () => setDialog(null);

  return (
    <>
      <header className="page-header">
        <div>
          <Link className="link-back" to="/participants">
            <Icon name="chevron-left" size={16} />
            Participants
          </Link>
          <h1 className="page-title">
            {name}
            {code && <span className="tile-code page-title-code">{code}</span>}
          </h1>
          <p className="page-sub">{user.data ? `@${user.data.username}${user.data.email ? ` · ${user.data.email}` : ''} · joined ${formatRelativeTime(user.data.createdAt)}` : ''}</p>
        </div>
        <Link className="btn btn-secondary" to={`/recipes`}>
          Give them recipes
        </Link>
      </header>

      <div className="content">
        {user.isError && <LoadError error={user.error} onRetry={() => user.refetch()} />}
        <div className="stats">
          <div className="stat">
            <span className="stat-label">To make</span>
            <span className="stat-value">{s ? s.assigned + (s.started ?? 0) : '—'}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Waiting for your check</span>
            <span className="stat-value">{s ? s.done : '—'}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Waiting for a photo</span>
            <span className="stat-value">{s ? (s.awaitingPhoto ?? 0) : '—'}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Photographed</span>
            <span className="stat-value">{s ? s.inReview + s.approved : '—'}</span>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">Tiles</h2>
            {s && s.overdue > 0 && <span className="badge badge-bad">{s.overdue} overdue</span>}
          </div>
          <div className="card-toolbar">
            <div className="segmented segmented-wrap" role="tablist" aria-label="Stage">
              {TILE_TABS.map((t) => (
                <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'is-active' : ''} onClick={() => setTab(t.key)}>
                  {t.label}
                  {count(t.key) != null && <span className="tab-count">{count(t.key)}</span>}
                </button>
              ))}
            </div>
          </div>
          {tiles.isPending ? (
            <Loading />
          ) : tiles.isError ? (
            <LoadError error={tiles.error} onRetry={() => tiles.refetch()} />
          ) : tiles.items.length === 0 ? (
            <Empty icon="clock" title="Nothing here" text={tab === 'all' ? `${name} has no tiles yet. Give them recipes from Tile recipes or Base glazes.` : 'No tile is at this stage.'} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Tile</th>
                    <th>Clay body</th>
                    <th>Due</th>
                    <th>Stage</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {tiles.items.map((task) => {
                    const badge = stageBadge(task);
                    return (
                      <tr key={task.id}>
                        <td className="cell-wide">
                          {task.recipeCode && <span className="tile-code">{task.recipeCode}</span>} <span className="cell-strong">{task.recipeName}</span>
                          {task.returnNote && <div className="muted">Sent back: {task.returnNote}</div>}
                        </td>
                        <td>{clayBodyLabel(task.clayBody)}</td>
                        <td className={task.overdue ? 'hint-bad' : 'muted'}>{dueText(task.dueOn) ?? '—'}</td>
                        <td>
                          <span className={toneClass(badge.tone)}>{badge.label}</span>
                        </td>
                        <td className="cell-actions">
                          <button className="btn btn-sm btn-secondary" onClick={() => setDialog({ kind: 'details', id: task.id })}>
                            Details
                          </button>
                          {isMade(task) && (
                            <button className="btn btn-sm btn-ghost" onClick={() => approve.mutate([task])} disabled={approve.isPending}>
                              Approve
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <LoadMore shown={tiles.items.length} total={tiles.total} hasMore={!!tiles.hasNextPage} loading={tiles.isFetchingNextPage} onLoadMore={() => tiles.fetchNextPage()} />
        </div>

        <div className="participant-grid">
          <div className="card">
            <div className="card-head">
              <h2 className="card-title">Their bases</h2>
              {code && (
                <Link className="card-link" to="/base-glazes">
                  Base glazes
                </Link>
              )}
            </div>
            {!code ? (
              <Empty icon="flask" title="No participant code" text="Give them a participant code on Users to register bases for them." />
            ) : bases.isPending ? (
              <Loading />
            ) : (bases.data ?? []).length === 0 ? (
              <Empty icon="flask" title="No bases yet" text={`Register a base for ${code} on Base glazes.`} />
            ) : (
              <ul className="item-list card-list">
                {(bases.data ?? []).map((b) => (
                  <li key={b.id}>
                    <span className="recipe-label">
                      <span className="recipe-label-head">
                        <span className="tile-code">{b.code}</span>
                        <span className="cell-strong">{b.name ?? '—'}</span>
                      </span>
                      <span className="muted">
                        {b.variationCount} {b.variationCount === 1 ? 'variation' : 'variations'}
                      </span>
                    </span>
                    <Link className="btn btn-sm btn-secondary" to={`/base-glazes?base=${encodeURIComponent(b.code ?? '')}`}>
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2 className="card-title">Photos they sent</h2>
              <Link className="card-link" to="/uploads">
                Upload review
              </Link>
            </div>
            {photos.isPending ? (
              <Loading />
            ) : photos.items.length === 0 ? (
              <Empty icon="camera" title="No photos yet" text="Photos they take with the Capture app show here." />
            ) : (
              <ul className="item-list card-list">
                {photos.items.map((p) => {
                  const label = PHOTO_LABEL[p.status] ?? { label: 'Sending', tone: 'neutral' as const };
                  return (
                    <li key={p.id}>
                      {p.thumbnailUrl ? <img className="thumb-sm" src={p.thumbnailUrl} alt="" /> : <span className="thumb-sm" aria-hidden="true" />}
                      <span className="recipe-label">
                        <span className="recipe-label-head">
                          {p.recipeCode && <span className="tile-code">{p.recipeCode}</span>}
                          <span className="cell-strong">{p.recipeName ?? 'Photo'}</span>
                        </span>
                        <span className="muted">
                          {[clayBodyLabel(p.clayBody ?? undefined), formatRelativeTime(p.createdAt)].filter(Boolean).join(' · ')}
                          {p.reviewNote ? ` · ${p.reviewNote}` : ''}
                        </span>
                      </span>
                      <span className={toneClass(label.tone)}>{label.label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <LoadMore shown={photos.items.length} total={photos.total} hasMore={!!photos.hasNextPage} loading={photos.isFetchingNextPage} onLoadMore={() => photos.fetchNextPage()} />
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">History</h2>
            <span className="muted">Everything done on their tiles, newest first</span>
          </div>
          {activity.isPending ? (
            <Loading />
          ) : activity.isError ? (
            <LoadError error={activity.error} onRetry={() => activity.refetch()} />
          ) : (activity.data ?? []).length === 0 ? (
            <Empty icon="clock" title="Nothing yet" text="What they and you do on their tiles shows here." />
          ) : (
            <ul className="item-list card-list">
              {(activity.data ?? []).map((a, i) => (
                <li key={`${a.at}-${i}`}>
                  <span className="recipe-label">
                    <span className="recipe-label-head">
                      {a.recipeCode && <span className="tile-code">{a.recipeCode}</span>}
                      <span>{activityLine(a)}</span>
                    </span>
                    <span className="muted">
                      {[a.clayBody ? clayBodyLabel(a.clayBody) : null, a.note && a.kind !== 'MarkedDone' ? a.note : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="muted">{formatDateTime(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {dialog?.kind === 'details' && (
        <TaskDetailsModal
          taskId={dialog.id}
          onClose={close}
          onReassign={(task) => setDialog({ kind: 'reassign', tasks: [task] })}
          onCancel={(task) => setDialog({ kind: 'cancel', task })}
          onReturn={(task) => setDialog({ kind: 'return', tasks: [task] })}
        />
      )}
      {dialog?.kind === 'reassign' && <ReassignModal tasks={dialog.tasks} onClose={close} />}
      {dialog?.kind === 'return' && <ReturnTasksModal tasks={dialog.tasks} onClose={close} />}
      {dialog?.kind === 'cancel' && <CancelTaskModal task={dialog.task} onClose={close} />}
    </>
  );
}

/** /participants lists them; /participants/:userId is one participant's page. */
export default function ParticipantsPage() {
  const { userId } = useParams();
  return userId ? <Participant key={userId} userId={userId} /> : <ParticipantList />;
}
