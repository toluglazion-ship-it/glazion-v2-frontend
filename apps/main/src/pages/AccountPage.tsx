import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { meApi, signOut } from '@glazion/api-client';
import { Icon, formatDate, initials } from '@glazion/ui';
import { usePageTitle } from '../lib/usePageTitle';

export default function AccountPage() {
  const [leaving, setLeaving] = useState(false);
  usePageTitle('Account');
  // Already cached by the time this page opens.
  const me = useQuery({ queryKey: ['me'], queryFn: meApi.get });

  const name = me.data?.displayName ?? me.data?.username ?? '';

  async function handleSignOut() {
    setLeaving(true);
    await signOut();
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Account</h1>
        </div>
      </header>

      <div className="content account">
        <div className="account-head">
          <div className="avatar avatar-lg">{initials(name)}</div>
          <div>
            <div className="account-name">{name || '—'}</div>
            {me.data?.username && <div className="muted">@{me.data.username}</div>}
          </div>
        </div>

        {/* Only active accounts get this far, so the details are what's worth showing, not a status. */}
        {me.data && (
          <dl className="facts">
            <div>
              <dt>Email</dt>
              <dd>{me.data.email ?? <span className="muted">Not given</span>}</dd>
            </div>
            {me.data.participantCode && (
              <div>
                <dt>Participant code</dt>
                <dd className="mono">{me.data.participantCode}</dd>
              </div>
            )}
            <div>
              <dt>Member since</dt>
              <dd>{formatDate(me.data.createdAt)}</dd>
            </div>
          </dl>
        )}

        {/* The API has no way to change these yourself yet. */}
        <p className="hint">To change your name, email or password, ask a Glazion admin.</p>

        <div>
          <button className="btn btn-secondary" onClick={handleSignOut} disabled={leaving}>
            {leaving ? <span className="spinner" /> : <Icon name="log-out" size={18} />}
            {leaving ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </>
  );
}
