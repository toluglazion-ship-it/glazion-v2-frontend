import { Icon } from '@glazion/ui';
import MaterialPicker from './MaterialPicker';
import { draftRow, formatAmount, type DraftRow } from '../lib/materials';

interface Props {
  rows: DraftRow[];
  onChange: (rows: DraftRow[]) => void;
  addLabel: string;
  /** Shows the running total, for a full formulation. */
  showTotal?: boolean;
}

/**
 * Material and amount rows. Each material is picked from the backend's materials list, the same one
 * recipes are calculated against, so a near-miss spelling can't slip into a recipe.
 */
export default function MaterialRows({ rows, onChange, addLabel, showTotal = false }: Props) {
  const total = rows.reduce((sum, row) => {
    const n = Number(row.amount.replace(',', '.'));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  function update(key: number, changes: Partial<DraftRow>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }

  return (
    <div className="rows-editor">
      {rows.length > 0 && (
        <div className="rows-line rows-head" aria-hidden="true">
          <span>Material</span>
          <span>Amount</span>
          <span />
        </div>
      )}
      {rows.map((row, i) => (
        <div className="rows-line" key={row.key}>
          <MaterialPicker value={row.rawName} picked={row.picked} onChange={(rawName, picked) => update(row.key, { rawName, picked })} label={`Material ${i + 1}`} />
          <div className="input-unit">
            <input
              className="input"
              inputMode="decimal"
              placeholder="0"
              value={row.amount}
              onChange={(e) => /^[0-9]*[.,]?[0-9]*$/.test(e.target.value) && update(row.key, { amount: e.target.value })}
              aria-label={`Amount of material ${i + 1}, percent`}
            />
            <span aria-hidden="true">%</span>
          </div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onChange(rows.filter((r) => r.key !== row.key))} aria-label={`Remove material ${i + 1}`} title="Remove">
            <Icon name="trash" size={16} />
          </button>
        </div>
      ))}
      <div className="rows-foot">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...rows, draftRow()])}>
          <Icon name="plus" size={16} />
          {addLabel}
        </button>
        {showTotal && rows.length > 0 && <span className={`muted${Math.abs(total - 100) > 0.01 ? '' : ' is-ok'}`}>Total {formatAmount(total)}%</span>}
      </div>
    </div>
  );
}
