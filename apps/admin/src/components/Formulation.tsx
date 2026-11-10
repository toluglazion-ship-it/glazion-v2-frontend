import type { MaterialRow } from '@glazion/types';
import { formatAmount, formatQuantity } from '../lib/materials';

/** Material rows with their amounts and, under them, the % total (labelled `totalLabel`). */
export default function Formulation({ rows, totalLabel = 'Total' }: { rows: MaterialRow[]; totalLabel?: string }) {
  const total = rows.reduce((sum, row) => sum + ((row.unit?.trim() || '%') === '%' ? row.amount : 0), 0);
  return (
    <table className="table formulation">
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${row.rawName}-${i}`}>
            <td>{row.rawName}</td>
            <td className="num">{formatQuantity(row)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>{totalLabel}</td>
          <td className="num">{formatAmount(total)}%</td>
        </tr>
      </tfoot>
    </table>
  );
}
