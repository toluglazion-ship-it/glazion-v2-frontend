import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

interface Props {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The elements Tab can reach inside the dialog, in order. */
function focusables(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

/** Styles are in shell.css. */
export function Modal({ title, description, onClose, children, footer, size = 'md' }: Props) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  // Whatever had focus before the dialog opened, to give it back on close. Read while rendering,
  // before a field inside with autoFocus takes it.
  const opener = useRef(typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null));

  // Focus moves into the dialog (unless a field already took it) and goes back when it closes.
  useEffect(() => {
    const node = dialog.current;
    if (node && !node.contains(document.activeElement)) node.focus();
    const back = opener.current;
    return () => {
      if (back?.isConnected) back.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // Tab and Shift+Tab go round the dialog's own controls rather than out to the page behind.
      const node = dialog.current;
      if (e.key !== 'Tab' || !node) return;
      const items = focusables(node);
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!node.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="modal-head">
          <div>
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
            {description && <p className="modal-desc">{description}</p>}
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}
