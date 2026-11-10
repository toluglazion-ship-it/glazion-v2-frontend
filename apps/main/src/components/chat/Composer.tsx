import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { Icon } from '@glazion/ui';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  busy: boolean;
}

const MAX_HEIGHT = 180;

export default function Composer({ value, onChange, onSend, busy }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the text up to a limit, then scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (value.trim() && !busy) onSend();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (value.trim() && !busy) onSend();
    }
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer-box">
        <textarea
          ref={ref}
          rows={1}
          placeholder="Ask about glazes or firing"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          // Enter sends, so a phone keyboard labels that key Send.
          enterKeyHint="send"
          aria-label="Message"
        />
        <button type="submit" className="btn btn-primary btn-icon" disabled={!value.trim() || busy} aria-label="Send">
          {busy ? <span className="spinner" /> : <Icon name="arrow-up" size={18} />}
        </button>
      </div>
      <p className="composer-note">Glazion can be wrong. Test before you rely on an answer, and lab-test anything meant for food.</p>
    </form>
  );
}
