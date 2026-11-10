import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  hint?: string;
  /** Destructive, like Delete: shown in red. */
  danger?: boolean;
  onSelect: () => void;
}

interface Props {
  /** What the button shows: text, an icon, or both. */
  children: ReactNode;
  /** For an icon-only button, its name for screen readers. */
  label?: string;
  className?: string;
  items: MenuItem[];
  disabled?: boolean;
  /** Which edge of the button the menu lines up with. */
  align?: 'start' | 'end';
}

/** A button that opens a short list of actions. Closes on a choice, a click outside, or Escape. */
export default function MenuButton({ children, label, className = 'btn btn-secondary', items, disabled, align = 'start' }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={rootRef}>
      <button ref={buttonRef} type="button" className={className} onClick={() => setOpen((shown) => !shown)} aria-expanded={open} aria-label={label} title={label} disabled={disabled}>
        {children}
      </button>
      {open && (
        <div className={`menu${align === 'end' ? ' menu-end' : ''}`}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={item.danger ? 'is-danger' : undefined}
              onClick={() => {
                setOpen(false);
                // Back on the button first, so a dialog the choice opens hands focus back to it.
                buttonRef.current?.focus();
                item.onSelect();
              }}
            >
              {item.label}
              {item.hint && <span className="hint">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
