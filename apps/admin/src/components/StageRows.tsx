import { useState } from 'react';
import type { ExperimentDto, ExperimentStageInput } from '@glazion/types';
import { Icon } from '@glazion/ui';
import MaterialPicker from './MaterialPicker';

/**
 * The colorant rows of a base, one stage each (docs/cup-experiments.md, meeting 2026-11-09). Every stage is one round
 * across the cups. Series: from, to and steps, where steps is how many places to split into, so 0.5 to 5 in 10 steps
 * is 0.5, 1 … 5 and cup n takes the nth. Fixed: an amount and steps, every cup takes the amount. Stage 1's steps set
 * the cups; every later stage covers the same cups. Each stage goes in on top of the ones before it.
 */
export interface StageRow {
  key: number;
  rawName: string;
  picked: boolean;
  mode: 'series' | 'fixed';
  from: string;
  to: string;
  /** How many places (cups) to split into. */
  steps: string;
  amount: string;
  /** The participant has started it, so it stays as it is. */
  locked?: boolean;
  /** A started stage as it was saved. */
  original?: ExperimentStageInput;
  /** A saved experiment's cups. */
  cups?: number;
}

/** What the colorant picker offers before anything is typed: metallic oxides, stains, then opacifiers such as titanium. */
export const COLORANT_CATEGORIES = ['colorant', 'stain', 'opacifier'];
export const MAX_STAGES = 5;
export const MAX_CUPS = 20;

let nextKey = 1;
export const stageRow = (): StageRow => ({ key: nextKey++, rawName: '', picked: false, mode: 'series', from: '', to: '', steps: '', amount: '' });

const num = (text: string) => (text.trim() === '' ? NaN : Number(text.trim().replace(',', '.')));
/** 0.5 → "0.5", as the API writes amounts (at most four decimals). */
export const amountText = (n: number) => String(Number(n.toFixed(4)));
const typed = (r: StageRow) => !!(r.locked || r.rawName.trim() || r.from.trim() || r.to.trim() || r.amount.trim() || r.steps.trim());

/** An experiment's stages as rows to edit; the started ones locked. */
export function stageRowsFrom(e: ExperimentDto): StageRow[] {
  return e.stages.map((s) => {
    const series = s.mode === 'variable';
    const original: ExperimentStageInput = series
      ? { material: s.material, mode: 'variable', start: s.start, step: s.step }
      : { material: s.material, mode: 'constant', constant: s.constant };
    return {
      key: nextKey++,
      rawName: s.material,
      picked: true,
      mode: series ? 'series' : 'fixed',
      from: series ? amountText(s.start) : '',
      to: series ? amountText(s.start + s.step * (e.cupCount - 1)) : '',
      steps: String(e.cupCount),
      amount: series ? '' : amountText(s.constant),
      locked: !s.editable,
      original,
      cups: e.cupCount,
    };
  });
}

/** The amounts a row splits into, cup by cup, or null when something is missing. */
function amountsOf(row: StageRow, cups: number | null): number[] | null {
  const steps = row.steps.trim() ? num(row.steps) : (cups ?? NaN);
  if (!Number.isInteger(steps) || steps < 1) return null;
  if (row.mode === 'fixed') {
    const amount = num(row.amount);
    return amount > 0 ? Array.from({ length: steps }, () => amount) : null;
  }
  const from = num(row.from);
  const to = row.to.trim() ? num(row.to) : from;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < 0) return null;
  return Array.from({ length: steps }, (_, k) => (steps === 1 ? from : from + ((to - from) * k) / (steps - 1)));
}

export interface StagesRead {
  stages: ExperimentStageInput[];
  /** Cups: stage 1's steps. */
  cups: number;
  /** Rounds in all: one per stage. */
  steps: number;
  problem: string | null;
}

/** The filled-in rows as stages, or the first problem to show. Rows left empty are skipped. */
export function readStageRows(rows: StageRow[]): StagesRead {
  const stages: ExperimentStageInput[] = [];
  let cups = 0;
  const fail = (problem: string): StagesRead => ({ stages, cups, steps: stages.length, problem });
  const filled = rows.filter(typed);
  if (filled.length > MAX_STAGES) return fail(`Use at most ${MAX_STAGES} colorants.`);
  for (const [i, row] of filled.entries()) {
    const label = `Stage ${i + 1}`;
    const name = row.rawName.trim();
    if (!name) return fail(`${label}: choose the colorant.`);
    if (!row.picked) return fail(`${label}: choose “${name}” from the materials list, so the recipes are calculated with the right material.`);
    if (stages.some((s) => s.material.toLowerCase() === name.toLowerCase())) return fail(`${name} is in two stages. Give each stage its own colorant.`);

    if (row.locked && row.original) {
      // Started: it stays as it was saved.
      if (i === 0) cups = row.cups ?? 1;
      stages.push(row.original);
      continue;
    }

    if (i === 0 && !row.steps.trim()) return fail('Stage 1: enter the steps. They set how many cups there are, one for each step.');
    const amounts = amountsOf(row, i === 0 ? null : cups);
    if (!amounts)
      return fail(
        row.mode === 'fixed'
          ? `${label}: enter how much ${name} goes in every cup, and the steps.`
          : `${label}: enter the amounts of ${name}: from, to, and how many steps to split it into, e.g. 0.5 to 5 in 10 steps.`,
      );
    if (i === 0) {
      if (amounts.length > MAX_CUPS) return fail(`Stage 1 sets the cups, one for each step: ${amounts.length} is too many. Use at most ${MAX_CUPS}.`);
      cups = amounts.length;
    } else if (amounts.length !== cups) {
      return fail(`${label} has ${amounts.length} steps, but there are ${cups} cups (stage 1). Give every stage ${cups} steps.`);
    }
    if (!amounts.some((a) => a > 0)) return fail(`${label}: give an amount above 0.`);
    if (row.mode === 'fixed') stages.push({ material: name, mode: 'constant', constant: amounts[0] });
    else stages.push({ material: name, mode: 'variable', start: amounts[0], step: amounts.length > 1 ? amounts[1] - amounts[0] : 0 });
  }
  return { stages, cups, steps: stages.length, problem: null };
}

/** One recipe the stages make: which stage, which cup, and its name as the API gives it. */
export interface StageRecipe {
  stageIndex: number;
  level: number;
  cup: number;
  /** % of this stage's colorant in the cup. */
  pct: number;
  name: string;
}

/** The % of a stage's colorant in a cup: its own place in a series, or the fixed amount. */
export const stageAmount = (s: Pick<ExperimentStageInput, 'mode' | 'start' | 'step' | 'constant'>, cup: number) =>
  s.mode === 'constant' ? (s.constant ?? 0) : (s.start ?? 0) + (s.step ?? 0) * (cup - 1);

/**
 * Every recipe the stages make, stage by stage, in the order the codes are given: each stage across cups 1, 2 … A recipe
 * keeps everything added before it ("B1 + 0.5% Cobalt Carbonate + 2% Titanium Dioxide").
 */
export function stageRecipes(stages: ExperimentStageInput[], cups: number, baseNumber: number | null): StageRecipe[][] {
  return stages.map((_, i) =>
    Array.from({ length: cups }, (_, k) => {
      const cup = k + 1;
      const parts = stages
        .slice(0, i + 1)
        .map((s) => ({ material: s.material, pct: stageAmount(s, cup) }))
        .filter((p) => p.pct > 0);
      const mix = parts.length ? parts.map((p) => `${amountText(p.pct)}% ${p.material}`).join(' + ') : 'nothing added';
      return { stageIndex: i, level: 1, cup, pct: stageAmount(stages[i], cup), name: `B${baseNumber ?? '?'} + ${mix}` };
    }),
  );
}

/** "Cup 1 0.5% up to cup 10 5%: 0.5, 1, 1.5 … 5" and the like, under each row. */
function summary(row: StageRow, i: number, cups: number | null): string | null {
  const amounts =
    row.locked && row.original && row.cups
      ? Array.from({ length: row.cups }, (_, k) => stageAmount(row.original!, k + 1))
      : amountsOf(row, i === 0 ? null : cups);
  if (!amounts?.length) return null;
  const after = i === 0 ? '' : `, on top of ${i === 1 ? 'stage 1' : i === 2 ? 'stages 1 and 2' : `stages 1 to ${i}`}`;
  const count = `${amounts.length} ${amounts.length === 1 ? 'cup' : 'cups'}`;
  if (row.mode === 'fixed') return `${count}: ${amountText(amounts[0])}% in every cup${after}`;
  const pcts = amounts.map((a) => amountText(a));
  const list = pcts.length > 6 ? `${pcts.slice(0, 3).join(', ')} … ${pcts[pcts.length - 1]}` : pcts.join(', ');
  return `${count}: ${list}%${after}`;
}

function Amount({
  value,
  onChange,
  label,
  placeholder = '0',
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="input-unit">
      <input
        className="input"
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => /^[0-9]*[.,]?[0-9]*$/.test(e.target.value) && onChange(e.target.value)}
        aria-label={label}
      />
      <span aria-hidden="true">%</span>
    </div>
  );
}

/** The colorant rows, one line per stage (the look the client liked), and Add colorant. */
export default function StageRows({ rows, onChange }: { rows: StageRow[]; onChange: (rows: StageRow[]) => void }) {
  const update = (key: number, changes: Partial<StageRow>) => onChange(rows.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  const cups = readStageRows(rows.slice(0, 1)).cups || null;
  return (
    <div className="rows-editor">
      {rows.map((row, i) => {
        const name = row.rawName.trim() || `stage ${i + 1}`;
        const hint = summary(row, i, cups);
        return (
          <div className="stage-line-wrap" key={row.key}>
            <div className="stage-line">
              <span className="stage-line-label">
                Stage {i + 1}
                {row.locked && <span className="badge">Started</span>}
              </span>
              {row.locked ? (
                <span className="input stage-line-locked">{row.rawName}</span>
              ) : (
                <MaterialPicker
                  value={row.rawName}
                  picked={row.picked}
                  onChange={(rawName, picked) => update(row.key, { rawName, picked })}
                  label={`Stage ${i + 1} colorant`}
                  placeholder="Search colorants, e.g. iron oxide"
                  only={COLORANT_CATEGORIES}
                />
              )}
              <div className="segmented segmented-sm" role="radiogroup" aria-label={`How ${name} is added`}>
                {(['series', 'fixed'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={row.mode === mode}
                    className={row.mode === mode ? 'is-active' : ''}
                    disabled={row.locked}
                    onClick={() => update(row.key, { mode })}
                  >
                    {mode === 'series' ? 'Series' : 'Fixed'}
                  </button>
                ))}
              </div>
              <div className="stage-line-amounts">
                {row.mode === 'series' ? (
                  <>
                    <Amount
                      value={row.from}
                      onChange={(from) => update(row.key, { from })}
                      label={`Stage ${i + 1}: from, percent`}
                      placeholder="0.5"
                      disabled={row.locked}
                    />
                    <span className="muted">to</span>
                    <Amount
                      value={row.to}
                      onChange={(to) => update(row.key, { to })}
                      label={`Stage ${i + 1}: to, percent`}
                      placeholder="5"
                      disabled={row.locked}
                    />
                  </>
                ) : (
                  <>
                    <Amount
                      value={row.amount}
                      onChange={(amount) => update(row.key, { amount })}
                      label={`Stage ${i + 1}: in every cup, percent`}
                      placeholder="2"
                      disabled={row.locked}
                    />
                    <span className="muted">in every cup</span>
                  </>
                )}
                <span className="muted">steps</span>
                <input
                  className="input stage-line-steps"
                  inputMode="numeric"
                  placeholder={i === 0 ? '10' : cups ? String(cups) : '10'}
                  value={row.steps}
                  disabled={row.locked}
                  onChange={(e) => /^[0-9]*$/.test(e.target.value) && update(row.key, { steps: e.target.value })}
                  aria-label={`Stage ${i + 1}: steps`}
                />
              </div>
              {row.locked ? (
                <span aria-hidden="true" />
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                  aria-label={`Remove stage ${i + 1}`}
                  title="Remove"
                >
                  <Icon name="trash" size={16} />
                </button>
              )}
            </div>
            {hint && <span className="hint stage-line-hint">{hint}</span>}
          </div>
        );
      })}
      {rows.length < MAX_STAGES && (
        <div className="rows-foot">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...rows, stageRow()])}>
            <Icon name="plus" size={16} />
            Add colorant
          </button>
        </div>
      )}
    </div>
  );
}

const PREVIEW = 3;

/**
 * What goes into each cup at every stage, with each recipe's code: the real one once its stage has started, else the
 * one it is due to get (ordinal: its place in the order the codes are given).
 */
export function StageVariations({
  stages,
  groups,
  code,
  collapsed,
}: {
  stages: ExperimentStageInput[];
  groups: StageRecipe[][];
  code: (recipe: StageRecipe, ordinal: number) => string | null;
  collapsed?: boolean;
}) {
  const [all, setAll] = useState<number[]>([]);
  let ordinal = 0;
  const numbered = groups.map((g) => g.map((r) => ({ r, code: code(r, ordinal++) })));
  return (
    <div className="stage-groups">
      {numbered.map((group, i) => {
        const stage = stages[i];
        if (!stage || group.length === 0) return null;
        const first = group[0]?.code;
        const last = group[group.length - 1];
        const shown = all.includes(i) ? group : group.slice(0, PREVIEW);
        return (
          <details className="stage-group" key={`${i}-${stage.material}`} open={!collapsed}>
            <summary>
              <span className="cell-strong">
                Stage {i + 1} · {stage.material} · {stage.mode === 'constant' ? 'Fixed' : 'Series'}
              </span>
              <span className="muted">
                {group.length} {group.length === 1 ? 'cup' : 'cups'}
                {collapsed && first && last.code ? ` · ${first} to ${last.code.split('-').pop()}` : ''}
              </span>
            </summary>
            <ul className="item-list">
              {shown.map(({ r, code: c }) => (
                <li key={r.cup}>
                  <span className="stage-cup">Cup {r.cup}</span>
                  <span className="cell-strong stage-cup-pct">+{amountText(r.pct)}%</span>
                  <span className="tile-code">{c ?? '—'}</span>
                  <span className="recipe-label">{r.name}</span>
                </li>
              ))}
              {group.length > shown.length && (
                <li>
                  <button type="button" className="link-btn" onClick={() => setAll((a) => [...a, i])}>
                    Show all {group.length} cups{last.code ? `, to ${last.code}` : ''}
                  </button>
                </li>
              )}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
