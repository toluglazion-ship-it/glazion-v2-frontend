import { useSyncExternalStore } from 'react';
import { Icon } from './Icon';

// Short confirmations for actions whose result would otherwise be easy to miss: a dialog that
// just closes, a row that quietly changes. Errors that need reading stay next to what failed.

type Tone = 'ok' | 'bad';

/** One follow-up, such as "Undo" or "Change", offered for a moment after the action. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
  action?: ToastAction;
}

const VISIBLE_MS: Record<Tone, number> = { ok: 4000, bad: 7000 };
/** Long enough to read the message and reach the button. */
const WITH_ACTION_MS = 8000;
const MAX_SHOWN = 3;

let items: ToastItem[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

function emit(next: ToastItem[]) {
  items = next;
  listeners.forEach((listener) => listener());
}

function dismiss(id: number) {
  emit(items.filter((item) => item.id !== id));
}

function show(message: string, tone: Tone, action?: ToastAction) {
  const id = nextId++;
  emit([...items, { id, message, tone, action }].slice(-MAX_SHOWN));
  setTimeout(() => dismiss(id), action ? Math.max(VISIBLE_MS[tone], WITH_ACTION_MS) : VISIBLE_MS[tone]);
}

/**
 * `toast('Recipe created')` confirms something worked; `toast.error(...)` reports a background failure.
 * Either can offer one follow-up: `toast('Recipe deleted', { action: { label: 'Undo', onClick } })`.
 */
export const toast = Object.assign((message: string, options?: { action?: ToastAction }) => show(message, 'ok', options?.action), {
  error: (message: string, options?: { action?: ToastAction }) => show(message, 'bad', options?.action),
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Render once, near the root of the app. Styles are in styles.css. */
export function Toaster() {
  const shown = useSyncExternalStore(subscribe, () => items);

  return (
    <div className="toasts" role="status" aria-live="polite">
      {shown.map((item) => (
        <div key={item.id} className={`toast${item.tone === 'bad' ? ' toast-bad' : ''}`}>
          <Icon name={item.tone === 'bad' ? 'alert' : 'check'} size={18} />
          <span>{item.message}</span>
          {item.action && (
            <button
              className="toast-action"
              onClick={() => {
                dismiss(item.id);
                item.action!.onClick();
              }}
            >
              {item.action.label}
            </button>
          )}
          <button className="toast-close" onClick={() => dismiss(item.id)} aria-label="Dismiss">
            <Icon name="x" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
