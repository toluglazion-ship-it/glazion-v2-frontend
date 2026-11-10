import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { signOut } from '@glazion/api-client';
import { Icon, accountStatusMeta, formatDate, initials, toneClass } from '@glazion/ui';
import { InstallButton } from '../components/Install';
import { captureContextQuery, meQuery } from '../lib/queries';

export default function ProfilePage() {
  const [leaving, setLeaving] = useState(false);
  // Both are already cached by the time this screen opens.
  const me = useQuery(meQuery);
  const context = useQuery({ ...captureContextQuery, retry: false });

  const name = me.data?.displayName ?? me.data?.username ?? '';
  const status = me.data ? accountStatusMeta(me.data.accountStatus) : null;

  async function handleSignOut() {
    setLeaving(true);
    await signOut();
  }

  return (
    <>
      <header className="page-head">
        <h1 className="page-title">Profile</h1>
      </header>

      <main className="page">
        <div className="profile">
          <div className="avatar">{initials(name)}</div>
          <div>
            <div className="profile-name">{name || '—'}</div>
            {me.data?.username && <div className="muted">@{me.data.username}</div>}
          </div>
        </div>

        <dl className="facts">
          <div>
            <dt>Account</dt>
            <dd>{status && <span className={toneClass(status.tone)}>{status.label}</span>}</dd>
          </div>
          <div>
            <dt>Capture code</dt>
            <dd className="mono">{context.data ? `•••• ${context.data.maskedSuffix ?? '––––'}` : 'None assigned'}</dd>
          </div>
          {context.data?.expiresAt && (
            <div>
              <dt>Code expires</dt>
              <dd>{formatDate(context.data.expiresAt)}</dd>
            </div>
          )}
          {me.data && (
            <div>
              <dt>Member since</dt>
              <dd>{formatDate(me.data.createdAt)}</dd>
            </div>
          )}
        </dl>

        <InstallButton />

        <button className="btn btn-secondary btn-block" onClick={handleSignOut} disabled={leaving}>
          {leaving ? <span className="spinner" /> : <Icon name="log-out" size={18} />}
          Sign out
        </button>
      </main>
    </>
  );
}
