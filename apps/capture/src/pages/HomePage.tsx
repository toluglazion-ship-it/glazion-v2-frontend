import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiError, errorMessage, getStoredUser } from '@glazion/api-client';
import { Icon, formatDate, toneClass } from '@glazion/ui';
import { InstallBanner } from '../components/Install';
import { ExperimentsSection, TasksSection } from '../components/Tasks';
import { PROGRESS, useRecipeProgress } from '../lib/progress';
import { captureContextQuery, myTasksQuery } from '../lib/queries';
import { sortRecipes } from '../lib/recipes';

function RefreshButton({ refetching, onRefresh }: { refetching: boolean; onRefresh: () => void }) {
  return (
    <button className="btn btn-secondary" onClick={onRefresh} disabled={refetching} aria-busy={refetching}>
      {refetching ? <span className="spinner" /> : <Icon name="refresh" size={18} />}
      {refetching ? 'Checking…' : 'Check again'}
    </button>
  );
}

/** From this many recipes on, the list gets a search box and is grouped by base. */
const MANY = 15;

export default function HomePage() {
  const user = getStoredUser();
  const firstName = (user?.displayName ?? user?.username ?? '').split(' ')[0];

  const context = useQuery(captureContextQuery);
  const recipes = sortRecipes(context.data?.recipes ?? []);
  // With tasks to do, an empty recipe list isn't news: the tasks are the work.
  const hasTasks = (useQuery(myTasksQuery).data?.length ?? 0) > 0;
  const progress = useRecipeProgress();
  // Photographed means sent: in review or approved. A rejected tile needs taking again.
  const done = recipes.filter((r) => ['approved', 'review'].includes(progress.byRecipe.get(r.id) ?? '')).length;
  const [query, setQuery] = useState('');
  const many = recipes.length > MANY;
  const term = query.trim().toLowerCase();
  const shown = term ? recipes.filter((r) => [r.code, r.name, r.description].some((text) => text?.toLowerCase().includes(term))) : recipes;
  // Codes like P01-B1-002 come in batches by base (P01-B1). Sorted by code, each batch is one run.
  const groups: { base: string | null; recipes: typeof recipes }[] = [];
  for (const recipe of shown) {
    const base = many ? (recipe.baseCode ?? null) : null;
    const last = groups[groups.length - 1];
    if (last && last.base === base) last.recipes.push(recipe);
    else groups.push({ base, recipes: [recipe] });
  }
  // The API answers 404 with code "no_capture_code" when no usable code is assigned (MeController).
  const noCode =
    context.error instanceof ApiError &&
    context.error.status === 404 &&
    ((context.error.body as { code?: unknown } | undefined)?.code ?? 'no_capture_code') === 'no_capture_code';

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">{firstName ? `Hi, ${firstName}` : 'Hello'}</h1>
          <p className="page-sub">Choose a recipe to photograph its tile.</p>
        </div>
        <button className="btn btn-ghost btn-icon" onClick={() => context.refetch()} aria-label="Refresh" disabled={context.isFetching}>
          {context.isFetching ? <span className="spinner" /> : <Icon name="refresh" size={20} />}
        </button>
      </header>

      <main className="page">
        <ExperimentsSection />
        <TasksSection />

        {context.isPending && (
          <div className="page-loading">
            <span className="spinner spinner-lg" />
          </div>
        )}

        {noCode && (
          <div className="empty">
            <div className="empty-icon">
              <Icon name="key" size={22} />
            </div>
            <div className="empty-title">No capture code yet</div>
            <p className="empty-text">
              {hasTasks
                ? 'Your tasks are above. A capture code gives you more recipes to photograph; your admin hasn’t assigned you one.'
                : 'A capture code gives you the recipes to photograph. Your admin hasn’t assigned you one yet; once they do, your recipes will show up here.'}
            </p>
            {/* Something to do here: check again once the admin says it's done. */}
            <RefreshButton refetching={context.isFetching} onRefresh={() => context.refetch()} />
          </div>
        )}

        {context.isError && !noCode && (
          <div className="empty">
            <div className="empty-icon">
              <Icon name="alert" size={22} />
            </div>
            <div className="empty-title">Couldn’t load your recipes</div>
            <p className="empty-text">{errorMessage(context.error)}</p>
            <button className="btn btn-secondary" onClick={() => context.refetch()}>
              Try again
            </button>
          </div>
        )}

        {context.data && (
          <>
            <section className="code-card" aria-label="Your capture code">
              <div>
                <div className="code-card-label">Capture code</div>
                <div className="code-card-value mono">•••• {context.data.maskedSuffix ?? '––––'}</div>
                {/* Not to be confused with the tile codes below: this one is yours, and gives you the recipes. */}
                <div className="code-card-note">Gives you the recipes below</div>
              </div>
              <div className="code-card-meta">
                {context.data.labelPrefix && <span className="badge">{context.data.labelPrefix}</span>}
                {context.data.expiresAt && <span className="muted">Expires {formatDate(context.data.expiresAt)}</span>}
              </div>
            </section>

            {(recipes.length > 0 || !hasTasks) && (
              <h2 className="section-title">
                Recipes <span className="muted">{progress.ready && recipes.length > 0 ? `${done} of ${recipes.length} photographed` : recipes.length}</span>
              </h2>
            )}

            {recipes.length === 0 ? (
              !hasTasks && (
                <div className="empty">
                  <div className="empty-icon">
                    <Icon name="flask" size={22} />
                  </div>
                  <div className="empty-title">No recipes assigned</div>
                  <p className="empty-text">Your code is active, but no recipes are linked to it yet. Ask your admin to add them.</p>
                  <RefreshButton refetching={context.isFetching} onRefresh={() => context.refetch()} />
                </div>
              )
            ) : (
              <>
                {many && (
                  <input
                    className="input recipe-search"
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find a tile code or recipe"
                    aria-label="Find a recipe"
                  />
                )}
                {shown.length === 0 && <p className="empty-text recipe-none">No recipe matches “{query.trim()}”.</p>}
                {groups.map((group, index) => (
                  <section key={group.base ?? `group-${index}`} className="recipe-group" aria-label={group.base ?? undefined}>
                    {group.base && <h3 className="recipe-group-title">{group.base}</h3>}
                    <ul className="list">
                      {group.recipes.map((recipe) => {
                        const state = progress.byRecipe.get(recipe.id);
                        return (
                          <li key={recipe.id}>
                            <Link className="row" to={`/capture/${recipe.id}`}>
                              <span className="row-icon">
                                <Icon name="camera" size={20} />
                              </span>
                              <span className="row-body">
                                {recipe.code && <span className="tile-code row-code">{recipe.code}</span>}
                                <span className="row-title">{recipe.name ?? recipe.code ?? 'Untitled recipe'}</span>
                                {recipe.description && <span className="row-text">{recipe.description}</span>}
                              </span>
                              {state && <span className={toneClass(PROGRESS[state].tone)}>{PROGRESS[state].label}</span>}
                              <Icon name="chevron-right" size={18} className="row-chevron" />
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </>
            )}
          </>
        )}

        {/* Below the list: it can appear a moment after load, and up top it pushed the rows under your finger. */}
        <InstallBanner />
      </main>
    </>
  );
}
