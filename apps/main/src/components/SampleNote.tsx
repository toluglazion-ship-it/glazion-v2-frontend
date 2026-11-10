import { Icon } from '@glazion/ui';

/** Shown wherever a screen is running on placeholder data, so nobody mistakes it for the real thing. */
export default function SampleNote({ children }: { children: string }) {
  return (
    <div className="alert alert-info sample-note" role="note">
      <Icon name="info" size={18} />
      <span>
        <strong>Preview.</strong> {children}
      </span>
    </div>
  );
}
