import { useEffect, useRef, type ReactNode } from 'react';
import type { SavedRow } from '@glazion/api-client/recipes';
import { Icon, toast } from '@glazion/ui';
import MaterialPicker from './MaterialPicker';

export interface Row {
  key: number;
  /** The material's name, or whatever has been typed so far. */
  material: string;
  /** The material's id in the backend list; null for recipes saved before ids were kept. */
  materialId: string | null;
  /** Chosen from the list, or loaded from a saved recipe. Typed text alone never counts. */
  picked: boolean;
  amount: string;
}

let nextKey = 0;
export const newRow = (): Row => ({ key: nextKey++, material: '', materialId: null, picked: false, amount: '' });

export const toRows = (rows: SavedRow[]): Row[] => rows.map((row) => ({ ...newRow(), material: row.material, materialId: row.materialId ?? null, picked: row.material !== '', amount: row.amount }));
/** A row as kept in a draft: as it was on screen, half-typed material and all. */
export type DraftRow = Omit<Row, 'key'>;
export const toDraftRow = ({ material, materialId, picked, amount }: Row): DraftRow => ({ material, materialId, picked, amount });
export const fromDraftRow = (row: DraftRow): Row => ({ ...newRow(), material: row.material, materialId: row.materialId, picked: row.picked, amount: row.amount });

/** The row a form check stopped at, and which of its fields needs fixing. */
export interface RowFlag {
  key: number;
  field: 'material' | 'amount';
  message: string;
}

export const fromRows = (rows: Row[]): SavedRow[] => rows.filter((row) => row.picked || row.material === '').map(({ material, materialId, amount }) => ({ material, materialId, amount }));

interface Props {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  addLabel: string;
  /** The base recipe always keeps one row; colorants can be emptied. */
  keepOne?: boolean;
  /** A note under a row, by its key: why the backend left it out, or what it may have meant. */
  notes?: Record<number, ReactNode>;
  /** The amount column's heading, e.g. "Parts" or "% of base". */
  amountLabel?: string;
  /** Marks that row's field, puts the message under it and moves focus there. */
  flag?: RowFlag | null;
}

const AMOUNT = /^\d*\.?\d*$/;

export default function RecipeRows({ rows, onChange, addLabel, keepOne = false, notes = {}, amountLabel = 'Amount', flag = null }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  // An Undo pressed seconds later puts the row back into the rows as they are then.
  const latest = useRef({ rows, onChange });
  useEffect(() => {
    latest.current = { rows, onChange };
  });

  function remove(row: Row, index: number) {
    onChange(rows.filter((r) => r.key !== row.key));
    if (!row.material.trim() && !row.amount) return;
    toast(`Removed ${row.material.trim() || 'a row'}`, {
      action: {
        label: 'Undo',
        onClick: () => {
          const { rows: now, onChange: change } = latest.current;
          if (!now.some((r) => r.key === row.key)) change([...now.slice(0, index), row, ...now.slice(index)]);
        },
      },
    });
  }

  // A new flag each time the form is checked, so pressing the button again brings focus back.
  useEffect(() => {
    if (!flag) return;
    const row = rootRef.current?.querySelector(`[data-key="${flag.key}"]`);
    row?.querySelector<HTMLElement>(flag.field === 'material' ? '[role="combobox"]' : '.amount')?.focus();
  }, [flag]);

  function update(key: number, patch: Partial<Row>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <div className="recipe-rows" ref={rootRef}>
      {/* Visible headings for the columns; each field also has its own label for screen readers. */}
      {rows.length > 0 && (
        <div className="recipe-row recipe-head" aria-hidden="true">
          <span>Material</span>
          <span className="amount">{amountLabel}</span>
        </div>
      )}
      {rows.map((row, index) => {
        const flagged = flag?.key === row.key ? flag : null;
        const noteId = `row-note-${row.key}`;
        const describedBy = flagged || notes[row.key] ? noteId : undefined;
        return (
          <div key={row.key} data-key={row.key} className={`recipe-row${notes[row.key] ? ' is-skipped' : ''}`}>
            <MaterialPicker
              value={row.material}
              picked={row.picked}
              onChange={(material, materialId, picked) => update(row.key, { material, materialId, picked })}
              label={`Material ${index + 1}`}
              invalid={flagged?.field === 'material'}
              describedBy={describedBy}
            />
            <input
              className="input amount"
              inputMode="decimal"
              placeholder="0"
              value={row.amount}
              onChange={(e) => {
                // Keyboards set to a comma-decimal region only offer ",", so it's kept as the "." the API expects.
                const value = e.target.value.replace(',', '.');
                if (AMOUNT.test(value)) update(row.key, { amount: value });
              }}
              aria-label={`Amount of material ${index + 1}`}
              aria-invalid={flagged?.field === 'amount' || undefined}
              aria-describedby={describedBy}
            />
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              onClick={() => remove(row, index)}
              aria-label={`Remove material ${index + 1}`}
              disabled={keepOne && rows.length === 1}
            >
              <Icon name="x" size={16} />
            </button>
            {describedBy && (
              <div id={noteId} className="row-note-wrap">
                {flagged && <div className="row-note field-error">{flagged.message}</div>}
                {notes[row.key] && <div className="row-note is-skipped">{notes[row.key]}</div>}
              </div>
            )}
          </div>
        );
      })}

      <button type="button" className="btn btn-ghost btn-sm add-row" onClick={() => onChange([...rows, newRow()])}>
        <Icon name="plus" size={16} />
        {addLabel}
      </button>
    </div>
  );
}
