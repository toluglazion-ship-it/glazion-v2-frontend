/** How tiles are fired: oxidation, reduction or neutral. */
export const ATMOSPHERES = [
  { value: 'oxidation', label: 'Oxidation' },
  { value: 'reduction', label: 'Reduction' },
  { value: 'neutral', label: 'Neutral' },
] as const;

/**
 * Orton cones, coolest first, as the API takes them: 020 … 010, 09 … 01 (the "0" cones, below cone 1), then 1 … 14.
 * The firing decides the result, so it is picked from this list rather than typed (meeting 2026-10-29).
 */
export const CONES: string[] = [
  ...Array.from({ length: 11 }, (_, i) => String(20 - i).padStart(3, '0')), // 020 … 010
  ...Array.from({ length: 9 }, (_, i) => `0${9 - i}`), // 09 … 01
  ...Array.from({ length: 14 }, (_, i) => String(i + 1)), // 1 … 14
];

/** "Cone 6 · Oxidation", or null when nothing is recorded. */
export function firingLabel(cone: string | null | undefined, atmosphere: string | null | undefined): string | null {
  const parts = [cone ? `Cone ${cone}` : null, ATMOSPHERES.find((a) => a.value === atmosphere)?.label ?? atmosphere ?? null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** A typed cone as the API takes it: "cone 6", "∆6" and "^6" are all "6". */
export const coneValue = (typed: string) => typed.trim().replace(/^(cone|∆|Δ|\^)\s*/i, '');

/**
 * The firing cone and atmosphere, side by side, both picked from a list. idPrefix keeps the ids apart when a form has
 * more than one. emptyLabel: what leaving it empty means (a variation left empty follows its base).
 */
export function FiringFields({
  idPrefix,
  cone,
  atmosphere,
  onCone,
  onAtmosphere,
  disabled,
  emptyLabel = 'Not set',
}: {
  idPrefix: string;
  cone: string;
  atmosphere: string;
  onCone: (value: string) => void;
  onAtmosphere: (value: string) => void;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  return (
    <div className="firing-fields">
      <div className="field">
        <label className="label" htmlFor={`${idPrefix}-cone`}>
          Firing cone
        </label>
        <select id={`${idPrefix}-cone`} className="select" value={coneValue(cone)} onChange={(e) => onCone(e.target.value)} disabled={disabled}>
          <option value="">{emptyLabel}</option>
          {/* A cone saved before the list existed stays choosable. */}
          {cone && !CONES.includes(coneValue(cone)) && <option value={coneValue(cone)}>Cone {coneValue(cone)}</option>}
          {CONES.map((c) => (
            <option key={c} value={c}>
              Cone {c}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor={`${idPrefix}-atmosphere`}>
          Atmosphere
        </label>
        <select id={`${idPrefix}-atmosphere`} className="select" value={atmosphere} onChange={(e) => onAtmosphere(e.target.value)} disabled={disabled}>
          <option value="">{emptyLabel}</option>
          {ATMOSPHERES.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
