import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, myTasksApi } from '@glazion/api-client';
import type { MatchCheckMaterial, TileTaskDto } from '@glazion/types';
import { Icon, clayBodyLabel, formatRelativeTime, toast } from '@glazion/ui';
import { myTasksQuery } from '../lib/queries';
import { amountText, dueText, firingText, isColorant, isReadyForPhoto, isToMake, kindLabel, totalPercent } from '../lib/tasks';

/** A swipe counts when the finger travels this far sideways, or flicks faster than FLICK (px per ms). */
const SWIPE = 60;
const FLICK = 0.5;
/** How long the tile takes to slide out, and the next to slide in (index.css, .task-recipe-slide). */
const SLIDE_MS = 180;

type Direction = 'next' | 'prev';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function Rows({ rows, highlight }: { rows: MatchCheckMaterial[]; highlight?: boolean }) {
  const total = totalPercent(rows);
  return (
    <table className="recipe-rows">
      <tbody>
        {rows.map((m, i) => (
          <tr key={`${m.name}-${i}`} className={highlight || isColorant(m) ? 'is-colorant' : undefined}>
            <td>
              {m.name}
              {kindLabel(m) && <span className="recipe-kind">{kindLabel(m)}</span>}
            </td>
            <td className="num">{amountText(m)}</td>
          </tr>
        ))}
      </tbody>
      {rows.length > 1 && total !== null && (
        <tfoot>
          <tr>
            <td>Total</td>
            <td className="num">{Number(total.toFixed(3))}%</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/**
 * One tile to make: its recipe as you mix it (the base, then the colorants on top), the clay body, how it is fired and
 * the admin's instructions. The recipe shows once you press Start; if the admin changes it later, it says so.
 * Swipe left or right, or use the arrows, to move through your tiles. "Mark as done" sends the tile to your admin to
 * check and takes you to the next tile still to make; once they are all made, back to your tasks.
 */
export default function TaskRecipePage() {
  const { taskId = '' } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tasks = useQuery(myTasksQuery);
  const all = tasks.data ?? [];
  const task = all.find((t) => t.id === taskId);
  // The run you swipe through: the tiles still with you to make, in the order the list gives them.
  const run = all.filter(isToMake);
  const index = run.findIndex((t) => t.id === taskId);
  const prev = index > 0 ? run[index - 1] : undefined;
  const next = index >= 0 && index < run.length - 1 ? run[index + 1] : undefined;

  // The tile on screen follows the finger, slides out the way it was pushed, and the next one slides in from the other side.
  const slide = useRef<HTMLDivElement>(null);
  const [entering, setEntering] = useState<Direction | null>(null);
  const leaving = useRef(false);

  function go(to: TileTaskDto | undefined, direction: Direction) {
    if (!to || leaving.current) return;
    const el = slide.current;
    const arrive = () => {
      leaving.current = false;
      setEntering(direction);
      navigate(`/tasks/${to.id}`, { replace: true });
    };
    if (!el || reducedMotion()) return arrive();
    leaving.current = true;
    el.style.transition = `transform ${SLIDE_MS}ms ease-in, opacity ${SLIDE_MS}ms ease-in`;
    el.style.transform = `translateX(${direction === 'next' ? '-100%' : '100%'})`;
    el.style.opacity = '0';
    // A timer rather than transitionend, which doesn't fire when nothing moved.
    window.setTimeout(arrive, SLIDE_MS);
  }
  const replace = (updated: TileTaskDto) =>
    queryClient.setQueryData<TileTaskDto[]>(['my-tasks'], (list) =>
      list?.map((t) => (t.id === updated.id ? { ...updated, recipe: updated.recipe ?? t.recipe } : t)),
    );

  const start = useMutation({
    mutationFn: () => myTasksApi.start(taskId),
    onSuccess: replace,
    onError: (err) => toast.error(errorMessage(err)),
  });
  const done = useMutation({
    mutationFn: () => myTasksApi.markDone(taskId),
    onSuccess: (updated) => {
      replace(updated);
      // On to the next tile not made yet, after this one first, then from the top; when none is left, home.
      const notMade = (t: TileTaskDto) => t.id !== taskId && isToMake(t);
      const following = run.slice(index + 1).find(notMade) ?? run.find(notMade);
      if (following) {
        toast(`${updated.recipeCode ?? 'Tile'} marked as done. Your admin checks it next.`);
        go(following, 'next');
      } else {
        toast('All your tiles are made. Your admin checks them, and once approved and fired they can be photographed.');
        navigate('/', { replace: true });
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const undo = useMutation({
    mutationFn: () => myTasksApi.undoDone(taskId),
    onSuccess: replace,
    onError: (err) => toast.error(errorMessage(err)),
  });

  // Arrow keys move too, for the web.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(prev, 'prev');
      if (e.key === 'ArrowRight') go(next, 'next');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // axis: decided once the finger has moved a little, so scrolling down the recipe never drags it sideways.
  const touch = useRef<{
    x: number;
    y: number;
    at: number;
    axis: 'x' | 'y' | null;
    dx: number;
  } | null>(null);
  function onTouchStart(e: TouchEvent) {
    if (leaving.current) return;
    touch.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      at: performance.now(),
      axis: null,
      dx: 0,
    };
    if (slide.current) slide.current.style.transition = 'none';
  }
  function onTouchMove(e: TouchEvent) {
    const t = touch.current;
    const el = slide.current;
    if (!t || !el) return;
    const dx = e.touches[0].clientX - t.x;
    const dy = e.touches[0].clientY - t.y;
    if (!t.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 8) t.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (t.axis !== 'x') return;
    t.dx = dx;
    // No tile that way: it gives a little and springs back.
    const offset = (dx < 0 && !next) || (dx > 0 && !prev) ? dx * 0.25 : dx;
    el.style.transform = `translateX(${offset}px)`;
    el.style.opacity = String(1 - Math.min(Math.abs(offset) / el.offsetWidth, 1) * 0.5);
  }
  function onTouchEnd() {
    const t = touch.current;
    const el = slide.current;
    touch.current = null;
    if (!t || !el || t.axis !== 'x') return;
    const fast = Math.abs(t.dx) > 20 && Math.abs(t.dx) / (performance.now() - t.at) > FLICK;
    const direction: Direction = t.dx < 0 ? 'next' : 'prev';
    const target = direction === 'next' ? next : prev;
    if (target && (Math.abs(t.dx) >= SWIPE || fast)) return go(target, direction);
    el.style.transition = 'transform 200ms ease-out, opacity 200ms ease-out';
    el.style.transform = '';
    el.style.opacity = '';
  }

  const header = (
    <header className="topbar">
      <button className="btn btn-ghost btn-icon" onClick={() => navigate('/')} aria-label="Back to your tasks">
        <Icon name="chevron-left" size={22} />
      </button>
      <h1 className="topbar-title truncate">{task ? (task.recipeCode ?? task.recipeName) : 'Recipe'}</h1>
      <span className="topbar-spacer topbar-count muted">{index >= 0 ? `${index + 1} of ${run.length}` : ''}</span>
    </header>
  );

  if (tasks.isPending) {
    return (
      <>
        {header}
        <div className="page-loading">
          <span className="spinner spinner-lg" />
        </div>
      </>
    );
  }

  if (!task) {
    return (
      <>
        {header}
        <div className="empty">
          <div className="empty-icon">
            <Icon name="flask" size={22} />
          </div>
          <div className="empty-title">Tile not available</div>
          <p className="empty-text">{tasks.isError ? errorMessage(tasks.error) : 'It isn’t one of your tiles any more: it may have moved to someone else.'}</p>
          <Link className="btn btn-secondary" to="/">
            Back to your tasks
          </Link>
        </div>
      </>
    );
  }

  const recipe = task.recipe;
  const due = dueText(task.dueOn);
  const firing = firingText(recipe?.cone, recipe?.atmosphere);
  return (
    <>
      {header}
      <main className="page task-recipe" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
        <div key={taskId} ref={slide} className={`task-recipe-slide${entering ? ` is-entering-${entering}` : ''}`} onAnimationEnd={() => setEntering(null)}>
          <section className="task-recipe-head">
            {task.recipeCode && <span className="tile-code">{task.recipeCode}</span>}
            <h2 className="task-recipe-title">{task.recipeName}</h2>
            <div className="task-recipe-facts">
              <span className="badge">{clayBodyLabel(task.clayBody)}</span>
              {firing && <span className="badge">{firing}</span>}
              {due && <span className={task.overdue ? 'badge badge-bad' : 'badge'}>Due {due}</span>}
              {task.stage === 'Done' && <span className="badge badge-warn">Made, being checked</span>}
              {task.stage === 'AwaitingPhoto' && !task.retakeReason && <span className="badge badge-ok">Approved</span>}
              {task.retakeReason && <span className="badge badge-bad">Take the photo again</span>}
            </div>
          </section>

          {task.returnNote && (
            <div className="alert alert-warn" role="note">
              <Icon name="alert" size={18} />
              <span>Sent back by your admin: {task.returnNote}</span>
            </div>
          )}
          {task.recipeChangedAt && (
            <div className="alert alert-warn" role="note">
              <Icon name="alert" size={18} />
              <span>Your admin changed this recipe {formatRelativeTime(task.recipeChangedAt)}, after you pressed Start. The amounts below are the new ones.</span>
            </div>
          )}
          {task.retakeReason && (
            <div className="alert alert-warn" role="note">
              <Icon name="alert" size={18} />
              <span>Take the photo again: {task.retakeReason}</span>
            </div>
          )}
          {task.note && (
            <div className="task-recipe-note">
              <div className="section-title">Instructions</div>
              <p>{task.note}</p>
            </div>
          )}

          {task.stage === 'Assigned' ? (
            // Until Start the admin may still correct the recipe, so it isn't shown yet.
            <div className="task-recipe-start">
              <Icon name="flask" size={22} />
              <p>
                Press <strong>Start</strong> when you’re ready to make this tile. Its recipe shows then.
              </p>
            </div>
          ) : !recipe ? (
            <p className="empty-text">The recipe couldn’t be loaded. Pull to refresh, or open it again from your tasks.</p>
          ) : recipe.base.length === 0 && recipe.additions.length === 0 && recipe.materials.length === 0 ? (
            <>
              <p className="muted">No materials are recorded for this recipe. Ask your admin for them before you mix it.</p>
              {recipe.description && <p className="muted">{recipe.description}</p>}
            </>
          ) : (
            <>
              <section aria-label="Colorants">
                <h3 className="section-title">Colorants</h3>
                {recipe.additions.length > 0 ? <Rows rows={recipe.additions} highlight /> : <p className="muted">None. This tile is the base as it is.</p>}
              </section>
              {recipe.base.length > 0 && (
                <section aria-label="Base">
                  <h3 className="section-title">
                    Base {recipe.baseCode}
                    {recipe.baseName && <span className="muted">{recipe.baseName}</span>}
                  </h3>
                  <Rows rows={recipe.base} />
                </section>
              )}
              {recipe.materials.length > 0 && (
                <details className="task-recipe-whole" open={recipe.base.length === 0}>
                  <summary>The whole recipe</summary>
                  <Rows rows={recipe.materials} />
                </details>
              )}
              {recipe.description && <p className="muted">{recipe.description}</p>}
            </>
          )}

          <div className="task-recipe-actions">
            {task.stage === 'Assigned' && (
              <button className="btn btn-primary btn-block" onClick={() => start.mutate()} disabled={start.isPending}>
                {start.isPending ? <span className="spinner" /> : <Icon name="flask" size={18} />}
                Start
              </button>
            )}
            {task.stage === 'Started' && (
              <button className="btn btn-primary btn-block" onClick={() => done.mutate()} disabled={done.isPending}>
                {done.isPending ? <span className="spinner" /> : <Icon name="check" size={18} />}
                Mark as done
              </button>
            )}
            {isReadyForPhoto(task) && (
              <Link className="btn btn-primary btn-block" to={`/task/${task.id}`}>
                <Icon name="camera" size={18} />
                {task.retakeReason ? 'Photograph again' : 'Photograph it'}
              </Link>
            )}
            {task.stage === 'Done' && (
              <>
                <p className="muted task-recipe-status">Made. Your admin checks it, then it’s photographed once fired.</p>
                {next && (
                  <button className="btn btn-secondary btn-block" onClick={() => go(next, 'next')}>
                    Next tile
                    <Icon name="chevron-right" size={18} />
                  </button>
                )}
                {!task.approvedAt && (
                  <button className="btn btn-ghost btn-block" onClick={() => undo.mutate()} disabled={undo.isPending}>
                    Not done yet
                  </button>
                )}
              </>
            )}
            {task.stage === 'InReview' && <p className="muted task-recipe-status">Photographed. Waiting for your admin to review the photo.</p>}
            {index >= 0 && run.length > 1 && (
              <div className="task-recipe-nav">
                <button className="btn btn-secondary" onClick={() => go(prev, 'prev')} disabled={!prev} aria-label="Previous tile">
                  <Icon name="chevron-left" size={18} />
                  Previous
                </button>
                <span className="muted">Swipe to move</span>
                <button className="btn btn-secondary" onClick={() => go(next, 'next')} disabled={!next} aria-label="Next tile">
                  Next
                  <Icon name="chevron-right" size={18} />
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
