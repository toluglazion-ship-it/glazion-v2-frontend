import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, myExperimentsApi, myTasksApi } from '@glazion/api-client';
import type { TileTaskDto } from '@glazion/types';
import { Icon, clayBodyLabel, formatRelativeTime, toast, toneClass } from '@glazion/ui';
import { myTasksQuery } from '../lib/queries';
import { dueText, isReadyForPhoto, isToMake, isWaitingForCheck } from '../lib/tasks';

/** Puts a changed task back in the cached list, keeping its recipe when the answer leaves it out. */
export function useReplaceTask() {
  const queryClient = useQueryClient();
  return (updated: TileTaskDto) =>
    queryClient.setQueryData<TileTaskDto[]>(['my-tasks'], (list) => list?.map((t) => (t.id === updated.id ? { ...updated, recipe: updated.recipe ?? t.recipe } : t)));
}

function TaskRow({ task }: { task: TileTaskDto }) {
  const replace = useReplaceTask();
  const start = useMutation({
    mutationFn: () => myTasksApi.start(task.id),
    onSuccess: (updated) => {
      replace(updated);
      toast(`${updated.recipeCode ?? 'Tile'} started. Its recipe is open now.`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const done = useMutation({
    mutationFn: () => myTasksApi.markDone(task.id),
    onSuccess: (updated) => {
      replace(updated);
      toast(`${updated.recipeCode ?? 'Tile'} marked as done. Your admin checks it next.`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const undo = useMutation({
    mutationFn: () => myTasksApi.undoDone(task.id),
    onSuccess: replace,
    onError: (err) => toast.error(errorMessage(err)),
  });

  const due = dueText(task.dueOn);
  const toMake = isToMake(task);
  const ready = isReadyForPhoto(task);
  const checking = isWaitingForCheck(task);
  const finished = task.stage === 'InReview' || task.stage === 'Approved';
  const colorants = task.recipe?.additions ?? [];
  return (
    <li className="row row-static row-waiting">
      <span className="row-icon">
        <Icon name={toMake ? 'flask' : ready ? 'camera' : checking ? 'clock' : 'check'} size={20} />
      </span>
      <span className="row-body">
        {/* The recipe opens from the tile's name: base, colorants and instructions, then swipe to the next. */}
        <Link className="row-link" to={`/tasks/${task.id}`}>
          {task.recipeCode && <span className="tile-code row-code">{task.recipeCode}</span>}
          <span className="row-title">{task.recipeName}</span>
        </Link>
        <span className="row-text">
          {clayBodyLabel(task.clayBody)}
          {due && toMake && ` · Due ${due}`}
          {colorants.length > 0 && ` · ${colorants.map((c) => c.name).join(', ')}`}
        </span>
        {task.overdue && <span className="row-text is-bad">Overdue</span>}
        {task.returnNote && <span className="row-text is-bad">Sent back: {task.returnNote}</span>}
        {task.recipeChangedAt && <span className="row-text is-bad">Your admin changed this recipe {formatRelativeTime(task.recipeChangedAt)}. Check the amounts again.</span>}
        {task.retakeReason && <span className="row-text is-bad">Take the photo again: {task.retakeReason}</span>}
        {checking && <span className="row-text">Waiting for your admin to check it</span>}
        {(toMake || ready || (checking && !task.approvedAt)) && (
          <span className="row-actions">
            {/* The recipe stays hidden until Start. */}
            {task.stage === 'Assigned' && (
              <button className="btn btn-primary btn-sm" onClick={() => start.mutate()} disabled={start.isPending}>
                {start.isPending ? <span className="spinner" /> : <Icon name="flask" size={16} />}
                Start
              </button>
            )}
            {/* Started: view it, or mark it done straight from the list (meeting 2026-10-29). */}
            {task.stage === 'Started' && (
              <>
                <Link className="btn btn-secondary btn-sm" to={`/tasks/${task.id}`}>
                  View
                </Link>
                <button className="btn btn-primary btn-sm" onClick={() => done.mutate()} disabled={done.isPending}>
                  {done.isPending ? <span className="spinner" /> : <Icon name="check" size={16} />}
                  Mark as done
                </button>
              </>
            )}
            {checking && (
              <button className="btn btn-ghost btn-sm" onClick={() => undo.mutate()} disabled={undo.isPending}>
                Not done yet
              </button>
            )}
            {ready && (
              <Link className="btn btn-primary btn-sm" to={`/task/${task.id}`}>
                <Icon name="camera" size={16} />
                {task.retakeReason ? 'Photograph again' : 'Photograph'}
              </Link>
            )}
          </span>
        )}
      </span>
      {task.stage === 'Started' && <span className={toneClass(task.returnNote ? 'bad' : 'neutral')}>{task.returnNote ? 'Sent back' : 'Started'}</span>}
      {checking && <span className={toneClass('warn')}>Made</span>}
      {ready && <span className={toneClass(task.retakeReason ? 'bad' : 'ok')}>{task.retakeReason ? 'Retake' : 'Approved'}</span>}
      {finished && <span className={toneClass(task.stage === 'Approved' ? 'ok' : 'warn')}>{task.stage === 'Approved' ? 'In the library' : 'Photo in review'}</span>}
    </li>
  );
}

/**
 * The tiles an admin has given you. To make: press Start to see each recipe, make the tile and mark it
 * done. Your admin checks it, and once approved and fired it can be photographed, by you or by anyone with its code.
 * Nothing shows when you have no tasks, so the recipe list below stays as it was.
 */
export function TasksSection() {
  const tasks = useQuery(myTasksQuery);
  const all = tasks.data ?? [];
  if (all.length === 0) return null;

  const toMake = all.filter(isToMake);
  const ready = all.filter(isReadyForPhoto);
  const checking = all.filter(isWaitingForCheck);
  const sent = all.filter((t) => t.stage === 'InReview' || t.stage === 'Approved');
  const inReview = sent.filter((t) => t.stage === 'InReview').length;
  const toDo = toMake.length;

  return (
    <section className="tasks" aria-label="Your tasks">
      <h2 className="section-title">
        Your tasks{' '}
        <span className="muted">
          {toDo > 0 ? `${toDo} to make` : ready.length > 0 ? `${ready.length} to photograph` : checking.length > 0 ? `${checking.length} being checked` : 'all done'}
        </span>
      </h2>
      {toMake.length > 0 && (
        <ul className="list">
          {toMake.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      )}

      {ready.length > 0 && (
        <>
          <h2 className="section-title">
            Ready to photograph <span className="muted">{ready.length}</span>
          </h2>
          <ul className="list">
            {ready.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        </>
      )}

      {checking.length > 0 && (
        <details className="tasks-sent">
          <summary>{checking.length} waiting for your admin to check</summary>
          <ul className="list">
            {checking.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        </details>
      )}

      {sent.length > 0 && (
        <details className="tasks-sent">
          <summary>
            {inReview > 0 && `${inReview} photo${inReview === 1 ? '' : 's'} in review`}
            {inReview > 0 && sent.length > inReview && ', '}
            {sent.length > inReview && `${sent.length - inReview} in the library`}
          </summary>
          <ul className="list">
            {sent.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Your cup experiments, each with the stage it is on (meetings 2026-11-02 and 11-09). Nothing shows when you have none. */
export function ExperimentsSection() {
  const experiments = useQuery({ queryKey: ['my-experiments'], queryFn: myExperimentsApi.list });
  const list = experiments.data ?? [];
  if (list.length === 0) return null;
  return (
    <section className="tasks" aria-label="Your cup experiments">
      <h2 className="section-title">
        Cup experiments <span className="muted">{list.length}</span>
      </h2>
      <ul className="list">
        {list.map((e) => {
          const low = e.cups.filter((c) => c.needsGlaze).length;
          return (
            <li key={e.id}>
              <Link className="row" to={`/experiments/${e.id}`}>
                <span className="row-icon">
                  <Icon name={e.finished ? 'check' : 'flask'} size={20} />
                </span>
                <span className="row-body">
                  <span className="row-title">{e.name}</span>
                  <span className="row-text">
                    {e.finished
                      ? `Done · ${e.progress.recipes} recipes`
                      : `${e.current?.id ? 'Now' : 'Next'}: stage ${e.current?.stageNumber} of ${e.progress.stepsTotal} · ${e.current?.material}`}
                  </span>
                  {low > 0 && <span className="row-text is-bad">{low === 1 ? 'A cup needs' : `${low} cups need`} fresh glaze</span>}
                </span>
                <Icon name="chevron-right" size={18} />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
