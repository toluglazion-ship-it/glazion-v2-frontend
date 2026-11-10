import { useState } from 'react';
import { Icon } from '@glazion/ui';

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  /** Shown in place of the hint, and marks the field invalid. */
  error?: string;
  onBlur?: () => void;
}

export default function PasswordField({ id, label, value, onChange, autoComplete, hint, error, onBlur }: Props) {
  const [shown, setShown] = useState(false);
  const note = error ?? hint;

  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="input-wrap">
        <input
          id={id}
          className="input"
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? `${id}-note` : undefined}
          required
        />
        <button type="button" className="input-affix" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Hide password' : 'Show password'}>
          <Icon name={shown ? 'eye-off' : 'eye'} size={18} />
        </button>
      </div>
      {note && (
        <span className={error ? 'field-error' : 'hint'} id={`${id}-note`}>
          {note}
        </span>
      )}
    </div>
  );
}
