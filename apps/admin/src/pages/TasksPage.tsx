import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tasksApi } from '@glazion/api-client';
import { CLAY_BODIES, type ClayBody, type TileTaskDto, type TileTaskStage, type TileTaskSummaryDto } from '@glazion/types';
import { Icon, clayBodyLabel, toneClass } from '@glazion/ui';
import AssignTasksModal from '../components/AssignTasksModal';
import { Empty, LoadError, LoadMore, Loading } from '../components/ListState';
import { CancelTaskModal, ReassignModal, ReturnTasksModal, TaskDetailsModal, useApproveTasks, useRestoreTask } from '../components/TaskModals';
import { useDebounced } from '../hooks/useDebounced';
import { PAGE_SIZE, usePagedList } from '../hooks/usePagedList';
import { STAGE_LABEL, dueText, isOpen, isMade, stageBadge, useAssignees, userLabel } from '../lib/tasks';

type Tab = 'all' | 'overdue' | TileTaskStage;

/** The tabs, in the order a tile moves; "All" is everything not cancelled. */
const TABS: { key: Tab; label: string; count: (s: TileTaskSummaryDto) => number }[] = [
  { key: 'all', label: 'All', count: (s) => s.assigned + (s.started ?? 0) + s.done + (s.awaitingPhoto ?? 0) + s.inReview + s.approved },
  { key: 'Assigned', label: STAGE_LABEL.Assigned, count: (s) => s.assigned },
  { key: 'Started', label: STAGE_LABEL.Started, count: (s) => s.started ?? 0 },
  { key: 'Done', label: STAGE_LABEL.Done, count: (s) => s.done },
  { key: 'AwaitingPhoto', label: STAGE_LABEL.AwaitingPhoto, count: (s) => s.awaitingPhoto ?? 0 },
  { key: 'InReview', label: STAGE_LABEL.InReview, count: (s) => s.inReview },
  { key: 'Approved', label: STAGE_LABEL.Approved, count: (s) => s.approved },
  { key: 'overdue', label: 'Overdue', count: (s) => s.overdue },
  { key: 'Cancelled', label: STAGE_LABEL.Cancelled, count: (s) => s.cancelled },
];

type Dialog =
  | { kind: 'assign' }
  | { kind: 'details'; id: string }
  | { kind: 'reassign'; tasks: TileTaskDto[] }
  | { kind: 'return'; tasks: TileTaskDto[] }
  | { kind: 'cancel'; task: TileTaskDto }
  | null;

/** A row can be ticked to move it (not checked yet) or to approve or return it (made, waiting to be checked). */
const selectable = (task: TileTaskDto) => isOpen(task) || isMade(task);

export default function TasksPage() {
  const [tab, setTab] = useState<Tab>('all');
  const [userId, setUserId] = useState('');
  const [clayBody, setClayBody] = useState<ClayBody | ''>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Map<string, TileTaskDto>>(new Map());
  const [dialog, setDialog] = useState<Dialog>(null);
  const term = useDebounced(search.trim());
  const { assignees } = useAssignees();

  const filters = { userId: userId || undefined, clayBody: clayBody || undefined, q: term || undefined };
  const summary = useQuery({ queryKey: ['tasks', 'summary', filters], queryFn: () => tasksApi.summary(filters) });
  const list = usePagedList<TileTaskDto>(['tasks', 'list', tab, filters], (cursor) =>
    tasksApi.list({
      ...filters,
      stage: tab === 'all' || tab === 'overdue' ? undefined : tab,
      overdue: tab === 'overdue' || undefined,
      cursor,
      pageSize: PAGE_SIZE,
    }),
  );

  const open = list.items.filter(selectable);
  const allChosen = open.length > 0 && open.every((t) => selected.has(t.id));
  const chosenOpen = [...selected.values()].filter(isOpen);
  const chosenMade = [...selected.values()].filter(isMade);
  const approve = useApproveTasks(() => setSelected(new Map()));
  const restore = useRestoreTask();
  function choose(task: TileTaskDto) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(task.id)) next.delete(task.id);
      else next.set(task.id, task);
      return next;
    });
  }
  function chooseAll() {
    setSelected(allChosen ? new Map() : new Map(open.map((t) => [t.id, t])));
  }
  function close() {
    setDialog(null);
    setSelected(new Map());
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Tasks</h1>
          <p className="page-sub">
            Recipes given to participants to make, one tile per clay body. They press Start to see the recipe. You can change or delete anything until you check a made tile and approve it; then it is photographed once fired.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setDialog({ kind: 'assign' })}>
          <Icon name="plus" size={18} />
          Assign tiles
        </button>
      </header>

      <div className="content">
        <div className="toolbar">
          <div className="segmented" role="tablist" aria-label="Stage">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={tab === t.key ? 'is-active' : ''}
                onClick={() => {
                  setTab(t.key);
                  setSelected(new Map());
                }}
              >
                {t.label}
                {summary.data && <span className="tab-count">{t.count(summary.data)}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar">
          <div className="search">
            <Icon name="search" size={16} />
            <input className="input" placeholder="Search by recipe or username" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search tasks" />
          </div>
          <select className="select toolbar-select" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Participant">
            <option value="">Everyone</option>
            {assignees.map((u) => (
              <option key={u.id} value={u.id}>
                {userLabel(u)}
              </option>
            ))}
          </select>
          <select className="select toolbar-select" value={clayBody} onChange={(e) => setClayBody(e.target.value as ClayBody | '')} aria-label="Clay body">
            <option value="">All clay bodies</option>
            {CLAY_BODIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          {chosenOpen.length > 0 && (
            <button className="btn btn-secondary" onClick={() => setDialog({ kind: 'reassign', tasks: chosenOpen })}>
              Reassign {chosenOpen.length} selected
            </button>
          )}
          {chosenMade.length > 0 && (
            <>
              <button className="btn btn-secondary" onClick={() => setDialog({ kind: 'return', tasks: chosenMade })}>
                Return {chosenMade.length}
              </button>
              <button className="btn btn-primary" onClick={() => approve.mutate(chosenMade)} disabled={approve.isPending}>
                {approve.isPending && <span className="spinner" />}
                Approve {chosenMade.length}
              </button>
            </>
          )}
        </div>

        <div className="card">
          {list.isPending ? (
            <Loading />
          ) : list.isError ? (
            <LoadError error={list.error} onRetry={() => list.refetch()} />
          ) : list.items.length === 0 ? (
            <Empty
              icon="clock"
              title={tab === 'all' && !term && !userId && !clayBody ? 'No tasks yet' : 'Nothing here'}
              text={tab === 'all' ? 'Assign recipes to a participant, and each tile they have to make shows up here.' : 'No task matches this view.'}
              action={
                tab === 'all' ? (
                  <button className="btn btn-primary" onClick={() => setDialog({ kind: 'assign' })}>
                    Assign tiles
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="cell-check">
                      {open.length > 0 && <input type="checkbox" checked={allChosen} onChange={chooseAll} aria-label="Select every task shown that can be moved, approved or returned" />}
                    </th>
                    <th>Recipe</th>
                    <th>Clay body</th>
                    <th>Participant</th>
                    <th>Due</th>
                    <th>Stage</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((task) => {
                    const badge = stageBadge(task);
                    return (
                      <tr key={task.id}>
                        <td className="cell-check">
                          {selectable(task) && (
                            <input type="checkbox" checked={selected.has(task.id)} onChange={() => choose(task)} aria-label={`Select ${task.recipeCode ?? task.recipeName} on ${task.clayBody}`} />
                          )}
                        </td>
                        <td className="cell-wide">
                          <span className="recipe-label">
                            <span className="recipe-label-head">
                              {task.recipeCode && <span className="tile-code">{task.recipeCode}</span>}
                              <span className="cell-strong">{task.recipeName}</span>
                            </span>
                            {task.note && <span className="muted cell-clamp">{task.note}</span>}
                          </span>
                        </td>
                        <td>{clayBodyLabel(task.clayBody)}</td>
                        <td>
                          {task.participantCode && <span className="muted">{task.participantCode} · </span>}@{task.assignedUsername}
                        </td>
                        <td className={task.dueOn ? '' : 'muted'}>
                          {dueText(task.dueOn) ?? '—'}
                          {task.overdue && <span className="badge badge-bad">Overdue</span>}
                        </td>
                        <td>
                          <span className={toneClass(badge.tone)} title={task.retakeReason ?? task.returnNote ?? undefined}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="cell-actions">
                          <button className="btn btn-sm btn-secondary" onClick={() => setDialog({ kind: 'details', id: task.id })}>
                            Details
                          </button>
                          {isOpen(task) && (
                            <button className="btn btn-sm btn-ghost" onClick={() => setDialog({ kind: 'reassign', tasks: [task] })}>
                              Reassign
                            </button>
                          )}
                          {isMade(task) && (
                            <button className="btn btn-sm btn-ghost" onClick={() => approve.mutate([task])} disabled={approve.isPending}>
                              Approve
                            </button>
                          )}
                          {task.stage === 'Cancelled' && (
                            <button className="btn btn-sm btn-ghost" onClick={() => restore.mutate(task)} disabled={restore.isPending}>
                              Restore
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
          <LoadMore shown={list.items.length} total={list.total} hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoadMore={() => list.fetchNextPage()} />
        </div>
      </div>

      {dialog?.kind === 'assign' && <AssignTasksModal onClose={close} />}
      {dialog?.kind === 'details' && (
        <TaskDetailsModal
          taskId={dialog.id}
          onClose={close}
          onReassign={(task) => setDialog({ kind: 'reassign', tasks: [task] })}
          onCancel={(task) => setDialog({ kind: 'cancel', task })}
          onReturn={(task) => setDialog({ kind: 'return', tasks: [task] })}
        />
      )}
      {dialog?.kind === 'return' && <ReturnTasksModal tasks={dialog.tasks} onClose={close} />}
      {dialog?.kind === 'reassign' && <ReassignModal tasks={dialog.tasks} onClose={close} />}
      {dialog?.kind === 'cancel' && <CancelTaskModal task={dialog.task} onClose={close} />}
    </>
  );
}
