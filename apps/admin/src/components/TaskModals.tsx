import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, tasksApi } from '@glazion/api-client';
import type { TileTaskDto, TileTaskEventDto } from '@glazion/types';
import { Icon, Modal, clayBodyLabel, formatDateTime, toast, toneClass } from '@glazion/ui';
import { LoadError, Loading } from './ListState';
import { dueText, isCancellable, isOpen, isMade, stageBadge, todayIso, useAssignees, userLabel } from '../lib/tasks';

function Problem({ error }: { error: unknown }) {
  return (
    <div className="alert" role="alert">
      <Icon name="alert" size={18} />
      <span>{errorMessage(error)}</span>
    </div>
  );
}

/** One line of a task's history, also used for a participant's activity. */
export function historyLine(e: Pick<TileTaskEventDto, 'kind' | 'actorUsername' | 'note'> & { fromUsername?: string | null; toUsername?: string | null }): string {
  const who = e.actorUsername ? `@${e.actorUsername}` : 'Someone';
  switch (e.kind) {
    case 'Assigned':
      return `${who} assigned it to @${e.toUsername ?? '?'}`;
    case 'Reassigned':
      return `${who} moved it from @${e.fromUsername ?? '?'} to @${e.toUsername ?? '?'}`;
    case 'MarkedDone':
      return e.note === 'Photographed' ? `${who} photographed it` : `${who} marked it done`;
    case 'DoneUndone':
      return `${who} took back "done"`;
    case 'Updated':
      return `${who} changed it`;
    case 'Cancelled':
      return `${who} deleted it`;
    case 'Restored':
      return `${who} restored it`;
    case 'Started':
      return `${who} started it`;
    case 'CompositionApproved':
      return `${who} checked it and approved it for its photo`;
    case 'Returned':
      return `${who} returned it`;
  }
}

// The Recipes page shows each recipe's tasks too.
const invalidate = (queryClient: ReturnType<typeof useQueryClient>) =>
  Promise.all([queryClient.invalidateQueries({ queryKey: ['tasks'] }), queryClient.invalidateQueries({ queryKey: ['recipes'] })]);

/** Moves one or several open tasks to another participant. */
export function ReassignModal({ tasks, onClose }: { tasks: TileTaskDto[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const single = tasks.length === 1 ? tasks[0] : null;
  const [userId, setUserId] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [reason, setReason] = useState('');
  const { assignees, ...users } = useAssignees();
  const choices = assignees.filter((u) => !single || u.id !== single.assignedUserId);

  const move = useMutation({
    mutationFn: async () => {
      const body = { assignedUserId: userId, dueOn: dueOn || null, reason: reason.trim() || null };
      if (single) {
        const task = await tasksApi.reassign(single.id, { ...body, version: single.version });
        return { moved: [task], skipped: [] as { taskId: string; reason: string }[] };
      }
      const result = await tasksApi.reassignMany({ ...body, taskIds: tasks.map((t) => t.id) });
      return { moved: result.reassigned, skipped: result.skipped };
    },
    onSuccess: ({ moved, skipped }) => {
      invalidate(queryClient);
      const to = moved[0]?.assignedUsername;
      toast(
        moved.length === 0
          ? 'Nothing was moved: those tasks have moved on or are already with them.'
          : `${moved.length} ${moved.length === 1 ? 'task' : 'tasks'} moved to @${to}${skipped.length ? `; ${skipped.length} left as they were` : ''}`,
      );
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (userId && !move.isPending) move.mutate();
  }

  return (
    <Modal
      title={single ? 'Reassign this tile' : `Reassign ${tasks.length} tiles`}
      description={
        single
          ? `${single.recipeCode ?? single.recipeName} on ${clayBodyLabel(single.clayBody)?.toLowerCase()}, now with @${single.assignedUsername}. The new participant starts from “to make”.`
          : 'The new participant starts each of them from “to make”. Tiles whose photo is already in review stay where they are.'
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="reassign" type="submit" disabled={!userId || move.isPending}>
            {move.isPending && <span className="spinner" />}
            Reassign
          </button>
        </>
      }
    >
      <form id="reassign" className="form" onSubmit={submit}>
        {move.isError && <Problem error={move.error} />}
        <div className="field">
          <label className="label" htmlFor="reassign-user">
            Give {single ? 'it' : 'them'} to
          </label>
          <select id="reassign-user" className="select" value={userId} onChange={(e) => setUserId(e.target.value)} required autoFocus>
            <option value="">{users.isPending ? 'Loading people…' : 'Choose a participant'}</option>
            {choices.map((u) => (
              <option key={u.id} value={u.id}>
                {userLabel(u)}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor="reassign-due">
              New due date <span className="muted">(optional)</span>
            </label>
            <input id="reassign-due" className="input" type="date" min={todayIso()} value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
            <span className="hint">Leave empty to keep the current one.</span>
          </div>
          <div className="field">
            <label className="label" htmlFor="reassign-reason">
              Reason <span className="muted">(optional)</span>
            </label>
            <input id="reassign-reason" className="input" maxLength={500} placeholder="e.g. Didn’t come in" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** Approves made tiles after checking them: each then waits for its photo once fired. */
export function useApproveTasks(onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tasks: TileTaskDto[]) => tasksApi.approve(tasks.map((t) => t.id)),
    onSuccess: ({ updated, skipped }) => {
      invalidate(queryClient);
      toast(
        updated.length === 0
          ? 'Nothing was approved: those tiles are no longer waiting to be checked.'
          : `${updated.length} ${updated.length === 1 ? 'tile' : 'tiles'} approved. They can be photographed once fired${skipped.length ? `; ${skipped.length} left as they were` : ''}.`,
      );
      onDone?.();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

/** Brings a deleted task back to the participant it was with, where it had got to. */
export function useRestoreTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (t: TileTaskDto) => tasksApi.restore(t.id),
    onSuccess: (restored) => {
      invalidate(queryClient);
      toast(`Restored: back with @${restored.assignedUsername}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

/** Sends made tiles back with a reason the participant sees beside each tile. */
export function ReturnTasksModal({ tasks, onClose }: { tasks: TileTaskDto[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const single = tasks.length === 1 ? tasks[0] : null;
  const send = useMutation({
    mutationFn: () => tasksApi.returnToParticipant(tasks.map((t) => t.id), reason.trim()),
    onSuccess: ({ updated, skipped }) => {
      invalidate(queryClient);
      toast(
        updated.length === 0
          ? 'Nothing was returned: those tiles have moved on.'
          : `${updated.length} ${updated.length === 1 ? 'tile' : 'tiles'} returned to @${updated[0].assignedUsername}${skipped.length ? `; ${skipped.length} left as they were` : ''}`,
      );
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (reason.trim() && !send.isPending) send.mutate();
  }

  return (
    <Modal
      title={single ? `Return ${single.recipeCode ?? single.recipeName}` : `Return ${tasks.length} tiles`}
      description="They go back to the participant to make again. They see your reason, and mark them done again once fixed."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="return-tasks" type="submit" disabled={!reason.trim() || send.isPending}>
            {send.isPending && <span className="spinner" />}
            Return
          </button>
        </>
      }
    >
      <form id="return-tasks" className="form" onSubmit={submit}>
        {send.isError && <Problem error={send.error} />}
        <div className="field">
          <label className="label" htmlFor="return-reason">
            What needs to change?
          </label>
          <textarea
            id="return-reason"
            className="textarea"
            maxLength={500}
            placeholder="e.g. Glaze too thin. Dip again, two coats."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            autoFocus
          />
        </div>
      </form>
    </Modal>
  );
}

export function CancelTaskModal({ task, onClose }: { task: TileTaskDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => tasksApi.cancel(task.id, { reason: reason.trim() || null, version: task.version }),
    onSuccess: () => {
      invalidate(queryClient);
      toast('Task deleted. You can restore it from the Deleted tab.');
      onClose();
    },
  });

  return (
    <Modal
      title="Delete this task?"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Keep it
          </button>
          <button className="btn btn-danger" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            {cancel.isPending && <span className="spinner" />}
            Delete task
          </button>
        </>
      }
    >
      {cancel.isError && <Problem error={cancel.error} />}
      <p className="modal-note">
        @{task.assignedUsername} won’t see {task.recipeCode ?? task.recipeName} on {clayBodyLabel(task.clayBody)?.toLowerCase()} any more. You can restore it from the
        Deleted tab, or assign the tile again.
      </p>
      <div className="field">
        <label className="label" htmlFor="cancel-reason">
          Reason <span className="muted">(optional)</span>
        </label>
        <input id="cancel-reason" className="input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}

/** One task: where it is, its due date and instructions (editable), and its history. */
export function TaskDetailsModal({ taskId, onClose, onReassign, onCancel, onReturn }: {
  taskId: string;
  onClose: () => void;
  onReassign: (task: TileTaskDto) => void;
  onCancel: (task: TileTaskDto) => void;
  onReturn: (task: TileTaskDto) => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['tasks', 'one', taskId], queryFn: () => tasksApi.getOne(taskId) });
  const task = query.data;
  const [dueOn, setDueOn] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (t: TileTaskDto) =>
      tasksApi.update(t.id, {
        dueOn: dueOn || null,
        clearDueOn: dueOn === '' ? true : undefined,
        note: note ?? undefined,
        version: t.version,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['tasks', 'one', taskId], updated);
      invalidate(queryClient);
      setDueOn(null);
      setNote(null);
      toast('Task updated');
    },
  });

  const approve = useApproveTasks(onClose);
  const restore = useRestoreTask();
  const changed = task && ((dueOn !== null && dueOn !== (task.dueOn ?? '')) || (note !== null && note.trim() !== (task.note ?? '')));
  const badge = task ? stageBadge(task) : null;

  return (
    <Modal
      title={task ? `${task.recipeCode ?? task.recipeName} · ${clayBodyLabel(task.clayBody)}` : 'Task'}
      description={task && task.recipeCode ? task.recipeName : undefined}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {task && isCancellable(task) && (
            <button className="btn btn-danger modal-foot-start" onClick={() => onCancel(task)}>
              Delete task
            </button>
          )}
          {task?.stage === 'Cancelled' && (
            <button className="btn btn-secondary modal-foot-start" onClick={() => restore.mutate(task)} disabled={restore.isPending}>
              {restore.isPending && <span className="spinner" />}
              Restore
            </button>
          )}
          {task && isOpen(task) && (
            <button className="btn btn-secondary" onClick={() => onReassign(task)}>
              Reassign
            </button>
          )}
          {task && (isMade(task) || (task.stage === 'AwaitingPhoto' && !task.photoUploadId)) && (
            <button className="btn btn-secondary" onClick={() => onReturn(task)}>
              Return
            </button>
          )}
          {task && isMade(task) && !changed && (
            <button className="btn btn-primary" onClick={() => approve.mutate([task])} disabled={approve.isPending}>
              {approve.isPending && <span className="spinner" />}
              Approve
            </button>
          )}
          {task && changed ? (
            <button className="btn btn-primary" onClick={() => save.mutate(task)} disabled={save.isPending}>
              {save.isPending && <span className="spinner" />}
              Save changes
            </button>
          ) : (
            <button className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          )}
        </>
      }
    >
      {query.isPending ? (
        <Loading />
      ) : query.isError || !task ? (
        <LoadError error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <>
          {save.isError && <Problem error={save.error} />}
          <dl className="facts">
            <div>
              <dt>Stage</dt>
              <dd>
                <span className={toneClass(badge!.tone)}>{badge!.label}</span>
                {task.overdue && <span className="badge badge-bad">Overdue</span>}
              </dd>
            </div>
            {task.retakeReason && (
              <div>
                <dt>Why retake</dt>
                <dd>{task.retakeReason}</dd>
              </div>
            )}
            {task.returnNote && (
              <div>
                <dt>Returned because</dt>
                <dd>{task.returnNote}</dd>
              </div>
            )}
            <div>
              <dt>Participant</dt>
              <dd>{userLabel({ username: task.assignedUsername, displayName: task.assignedDisplayName, participantCode: task.participantCode })}</dd>
            </div>
            <div>
              <dt>Assigned</dt>
              <dd>{formatDateTime(task.assignedAt)}</dd>
            </div>
            {task.doneAt && (
              <div>
                <dt>Made</dt>
                <dd>{formatDateTime(task.doneAt)}</dd>
              </div>
            )}
            {task.startedAt && (
              <div>
                <dt>Started</dt>
                <dd>{formatDateTime(task.startedAt)}</dd>
              </div>
            )}
            {task.approvedAt && (
              <div>
                <dt>Approved for its photo</dt>
                <dd>{formatDateTime(task.approvedAt)}</dd>
              </div>
            )}
          </dl>

          {task.stage !== 'Cancelled' && (
            <div className="field-row">
              <div className="field">
                <label className="label" htmlFor="task-due-edit">
                  Due
                </label>
                <input id="task-due-edit" className="input" type="date" min={todayIso()} value={dueOn ?? task.dueOn ?? ''} onChange={(e) => setDueOn(e.target.value)} />
                {task.dueOn && <span className="hint">Due {dueText(task.dueOn)}. Clear the date to remove it.</span>}
              </div>
              <div className="field">
                <label className="label" htmlFor="task-note-edit">
                  Instructions
                </label>
                <textarea id="task-note-edit" className="textarea" maxLength={500} value={note ?? task.note ?? ''} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
          )}

          <span className="section-label">History</span>
          <ul className="item-list">
            {(task.history ?? []).map((e, i) => (
              <li key={i}>
                <span className="recipe-label">
                  <span>{historyLine(e)}</span>
                  {e.note && <span className="muted">{e.note === 'Photographed' ? '' : e.note}</span>}
                </span>
                <span className="muted">{formatDateTime(e.at)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
