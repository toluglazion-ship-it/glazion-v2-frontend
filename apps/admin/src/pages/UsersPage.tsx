import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, errorMessage, getStoredUser, passwordProblem, PASSWORD_MAX, PASSWORD_MIN, signOut, usersApi } from '@glazion/api-client';
import { AccountStatus, UserRole, type UserDto } from '@glazion/types';
import { Icon, Modal, accountStatusMeta, formatRelativeTime, initials, toast, toneClass } from '@glazion/ui';
import { Empty, LoadError, LoadMore, Loading } from '../components/ListState';
import { useDebounced } from '../hooks/useDebounced';
import { PAGE_SIZE, usePagedList } from '../hooks/usePagedList';

const MIN_PASSWORD = PASSWORD_MIN;

// Group letter, then the participant number: P01, P12.
const PARTICIPANT_CODE = /^[A-Z][0-9]{2,3}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normaliseCode = (value: string) => value.trim().toUpperCase();

function participantProblem(value: string): string | null {
  const code = normaliseCode(value);
  return code && !PARTICIPANT_CODE.test(code) ? 'Use the group letter and participant number, e.g. P01.' : null;
}

/** auto: a new user, who gets the next free code when this is left empty (meeting 2026-11-09). */
function ParticipantField({ id, value, onChange, auto }: { id: string; value: string; onChange: (value: string) => void; auto?: boolean }) {
  const problem = participantProblem(value);
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        Participant code <span className="muted">(optional)</span>
      </label>
      <input
        id={id}
        className="input mono"
        placeholder="e.g. P01"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        maxLength={4}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={!!problem}
      />
      <span className={`hint${problem ? ' hint-bad' : ''}`}>
        {problem ??
          (auto
            ? 'Leave it empty and they get the next free code (P01, P02 …). It starts every tile code of theirs, e.g. P01-B1-002.'
            : 'Group and participant. It starts every tile code of theirs, e.g. P01-B1-002.')}
      </span>
    </div>
  );
}

function CreateUserModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [participantCode, setParticipantCode] = useState('');
  const [email, setEmail] = useState('');
  const [showPassword, setShowPassword] = useState(true);

  const create = useMutation({
    mutationFn: usersApi.create,
    onSuccess: (user) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      toast(`Account created for @${user.username}`);
      onClose();
    },
  });

  const emailProblem = email.trim() && !EMAIL.test(email.trim()) ? 'That doesn’t look like an email address.' : null;
  const valid = username.trim().length > 0 && password.length >= MIN_PASSWORD && !participantProblem(participantCode) && !emailProblem;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || create.isPending) return;
    create.mutate({
      username: username.trim(),
      password,
      displayName: displayName.trim() || null,
      participantCode: normaliseCode(participantCode) || null,
      email: email.trim() || null,
    });
  }

  return (
    <Modal
      title="New user"
      description="They’ll use this username and password to sign in to the Capture app."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="create-user" type="submit" disabled={!valid || create.isPending}>
            {create.isPending && <span className="spinner" />}
            Create user
          </button>
        </>
      }
    >
      <form id="create-user" className="form" onSubmit={handleSubmit}>
        {create.isError && (
          <div className="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{errorMessage(create.error)}</span>
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="new-name">
            Full name <span className="muted">(optional)</span>
          </label>
          <input id="new-name" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label className="label" htmlFor="new-username">
            Username
          </label>
          <input
            id="new-username"
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="new-password">
            Password
          </label>
          <div className="input-wrap">
            <input
              id="new-password"
              className="input"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              className="input-affix"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} />
            </button>
          </div>
          <span className="hint">At least {MIN_PASSWORD} characters. Pass it on to the user yourself; it isn’t shown again.</span>
        </div>
        <ParticipantField id="new-participant" value={participantCode} onChange={setParticipantCode} auto />
        <div className="field">
          <label className="label" htmlFor="new-email">
            Email <span className="muted">(optional)</span>
          </label>
          <input id="new-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" aria-invalid={!!emailProblem} />
          {emailProblem && <span className="hint hint-bad">{emailProblem}</span>}
        </div>
      </form>
    </Modal>
  );
}

function EditUserModal({ user, onClose, onSetPassword }: { user: UserDto; onClose: () => void; onSetPassword: () => void }) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [participantCode, setParticipantCode] = useState(user.participantCode ?? '');

  const save = useMutation({
    mutationFn: () =>
      usersApi.update(user.id, {
        displayName: displayName.trim() || null,
        participantCode: normaliseCode(participantCode) || null,
      }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast(`@${updated?.username ?? user.username} saved`);
      onClose();
    },
  });

  const changingCode = !!user.participantCode && normaliseCode(participantCode) !== user.participantCode;
  const valid = !participantProblem(participantCode);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (valid && !save.isPending) save.mutate();
  }

  return (
    <Modal
      title={`Edit @${user.username}`}
      onClose={onClose}
      footer={
        <>
          {/* For someone who has forgotten their password; there is no self-service reset. */}
          <button className="btn btn-secondary modal-foot-start" onClick={onSetPassword}>
            Set password
          </button>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="edit-user" type="submit" disabled={!valid || save.isPending}>
            {save.isPending && <span className="spinner" />}
            Save
          </button>
        </>
      }
    >
      <form id="edit-user" className="form" onSubmit={handleSubmit}>
        {save.isError && (
          <div className="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{errorMessage(save.error)}</span>
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="edit-name">
            Full name <span className="muted">(optional)</span>
          </label>
          <input id="edit-name" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus />
        </div>
        <ParticipantField id="edit-participant" value={participantCode} onChange={setParticipantCode} />
        {changingCode && (
          <p className="modal-note">
            Tiles already marked {user.participantCode} keep that code. Change it only if it was entered wrongly.
          </p>
        )}
      </form>
    </Modal>
  );
}

function setPasswordError(err: unknown): string {
  if (err instanceof ApiError && err.status === 404) return 'This account no longer exists. Refresh the list and try again.';
  if (err instanceof ApiError && err.status === 400) return err.message || `The password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`;
  return errorMessage(err);
}

function SetPasswordModal({ user, isSelf, onClose }: { user: UserDto; isSelf: boolean; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(true);
  const [step, setStep] = useState<'enter' | 'confirm' | 'done'>('enter');
  const [sessionsEnded, setSessionsEnded] = useState<number | null>(null);
  const name = user.displayName ?? `@${user.username}`;

  // The password lives only in this component's state; it's never logged or kept anywhere else.
  const save = useMutation({
    mutationFn: () => usersApi.setPassword(user.id, { password }),
    onSuccess: async (result) => {
      setPassword('');
      if (isSelf) {
        // Our own tokens stopped working, so go straight back to sign-in.
        toast('Your password was changed. Sign in with the new one.');
        await signOut();
        return;
      }
      setSessionsEnded(result.sessionsEnded);
      setStep('done');
    },
  });

  const problem = password ? passwordProblem(password) : null;
  const valid = !passwordProblem(password);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (valid && !save.isPending) setStep('confirm');
  }

  if (step === 'done') {
    const ended =
      sessionsEnded === null
        ? `${name} was signed out on every device.`
        : sessionsEnded === 0
          ? `${name} wasn’t signed in anywhere, so no sessions needed ending.`
          : `${name} was signed out of ${sessionsEnded} ${sessionsEnded === 1 ? 'session' : 'sessions'}.`;
    return (
      <Modal
        title="Password changed"
        onClose={onClose}
        footer={
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        }
      >
        <p className="modal-note">
          {ended} Their old password no longer works. Pass the new one on to them yourself; it isn’t shown again.
        </p>
      </Modal>
    );
  }

  if (step === 'confirm') {
    return (
      <Modal
        title={isSelf ? 'Change your own password?' : `Sign ${name} out everywhere?`}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setStep('enter')} disabled={save.isPending}>
              Back
            </button>
            {/* Keyed so it doesn't reuse, and fade from, the dark Continue button. */}
            <button key="confirm" className="btn btn-danger" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <span className="spinner" />}
              {isSelf ? 'Change my password' : 'Set password'}
            </button>
          </>
        }
      >
        {save.isError && (
          <div className="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{setPasswordError(save.error)}</span>
          </div>
        )}
        <p className="modal-note">
          {isSelf
            ? 'This signs you out on every device, including this one. You’ll go back to the sign-in screen and need the new password to get back in.'
            : `This signs ${name} out on every phone and computer straight away. Their old password stops working, and they’ll need the new one to sign in.`}
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Set password for @${user.username}`}
      description="Use this when someone has forgotten their password."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="set-password" type="submit" disabled={!valid}>
            Continue
          </button>
        </>
      }
    >
      <form id="set-password" className="form" onSubmit={handleSubmit}>
        {save.isError && (
          <div className="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{setPasswordError(save.error)}</span>
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="set-password-input">
            New password
          </label>
          <div className="input-wrap">
            <input
              id="set-password-input"
              className="input"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              maxLength={PASSWORD_MAX}
              aria-invalid={!!problem}
              autoFocus
              required
            />
            <button
              type="button"
              className="input-affix"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} />
            </button>
          </div>
          <span className={`hint${problem ? ' hint-bad' : ''}`}>
            {problem ?? `${PASSWORD_MIN} to ${PASSWORD_MAX} characters. Their old password stops working and they’re signed out everywhere.`}
          </span>
        </div>
      </form>
    </Modal>
  );
}

const FILTERS: { label: string; value: AccountStatus | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Waiting for approval', value: AccountStatus.Pending },
  { label: 'Active', value: AccountStatus.Active },
  { label: 'Suspended', value: AccountStatus.Suspended },
  { label: 'Disabled', value: AccountStatus.Disabled },
];

type StatusChange = { userId: string; status: AccountStatus; name: string; was: AccountStatus };

function changeMessage({ status, name, was }: StatusChange): string {
  if (status === AccountStatus.Active) return was === AccountStatus.Pending ? `${name} is approved and can sign in` : `${name} can sign in again`;
  if (status === AccountStatus.Disabled) return `${name}’s sign-up was declined`;
  return `${name} is suspended`;
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [settingPassword, setSettingPassword] = useState<UserDto | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AccountStatus | undefined>(undefined);
  const term = useDebounced(search.trim());

  const users = usePagedList<UserDto>(['users', { term, filter: filter ?? 'all' }], (cursor) =>
    usersApi.list({ search: term || undefined, status: filter, cursor, pageSize: PAGE_SIZE }),
  );

  const setStatus = useMutation({
    mutationFn: ({ userId, status }: StatusChange) => usersApi.setStatus(userId, { status }),
    onSuccess: (_result, change) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['pending-users'] });
      toast(changeMessage(change));
    },
  });

  const me = getStoredUser();

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-sub">Everyone who can sign in to Glazion. New sign-ups wait here until you approve them.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Icon name="plus" size={18} />
          New user
        </button>
      </header>

      <div className="content">
        <div className="toolbar">
          <div className="search">
            <Icon name="search" size={16} />
            <input className="input" placeholder="Search by name, username or code" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users" />
          </div>
          <div className="segmented" role="tablist" aria-label="Filter users">
            {FILTERS.map((f) => (
              <button key={f.label} role="tab" aria-selected={filter === f.value} className={filter === f.value ? 'is-active' : ''} onClick={() => setFilter(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {setStatus.isError && (
          <div className="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{errorMessage(setStatus.error)}</span>
          </div>
        )}

        <div className="card">
          {users.isPending ? (
            <Loading />
          ) : users.isError ? (
            <LoadError error={users.error} onRetry={() => users.refetch()} />
          ) : users.items.length === 0 && term ? (
            <Empty icon="search" title="No matches" text={`Nobody matches “${term}”.`} />
          ) : users.items.length === 0 && filter === AccountStatus.Pending ? (
            <Empty icon="check" title="Nobody is waiting" text="New sign-ups show up here until you approve them." />
          ) : users.items.length === 0 && filter !== undefined ? (
            <Empty icon="users" title="Nobody here" text="No accounts have this status." />
          ) : users.items.length === 0 ? (
            <Empty
              icon="users"
              title="No users yet"
              text="Create an account for each person who will photograph tiles."
              action={
                <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                  New user
                </button>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Participant</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Added</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {users.items.map((user) => {
                    const status = accountStatusMeta(user.accountStatus);
                    const active = user.accountStatus === AccountStatus.Active;
                    const waiting = user.accountStatus === AccountStatus.Pending;
                    const busy = setStatus.isPending && setStatus.variables?.userId === user.id;
                    const change = (to: AccountStatus) =>
                      setStatus.mutate({ userId: user.id, status: to, name: user.displayName ?? `@${user.username}`, was: user.accountStatus });
                    return (
                      <tr key={user.id}>
                        <td>
                          <div className="cell-user">
                            <div className="avatar">{initials(user.displayName ?? user.username)}</div>
                            <div>
                              <div className="cell-strong">{user.displayName ?? user.username ?? '—'}</div>
                              <div className="muted">
                                @{user.username}
                                {user.email && ` · ${user.email}`}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>{user.participantCode ? <span className="tile-code">{user.participantCode}</span> : <span className="muted">—</span>}</td>
                        <td>{user.role === UserRole.Admin ? 'Admin' : 'User'}</td>
                        <td>
                          <span className={toneClass(status.tone)}>{status.label}</span>
                        </td>
                        <td className="muted">{formatRelativeTime(user.createdAt)}</td>
                        <td className="cell-actions">
                          <button className="btn btn-sm btn-secondary" onClick={() => setEditing(user)}>
                            Edit
                          </button>
                          {/* Suspending yourself would lock you out of this page with no way back. */}
                          {user.id === me?.id ? (
                            <span className="muted">You</span>
                          ) : waiting ? (
                            <>
                              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => change(AccountStatus.Active)}>
                                {busy && setStatus.variables?.status === AccountStatus.Active ? <span className="spinner" /> : 'Approve'}
                              </button>
                              <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => change(AccountStatus.Disabled)}>
                                {busy && setStatus.variables?.status === AccountStatus.Disabled ? <span className="spinner" /> : 'Decline'}
                              </button>
                            </>
                          ) : (
                            <button
                              className={`btn btn-sm ${active ? 'btn-danger' : 'btn-secondary'}`}
                              disabled={busy}
                              onClick={() => change(active ? AccountStatus.Suspended : AccountStatus.Active)}
                            >
                              {busy ? <span className="spinner" /> : active ? 'Suspend' : 'Activate'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <LoadMore
            shown={users.items.length}
            total={users.total}
            hasMore={!!users.hasNextPage}
            loading={users.isFetchingNextPage}
            onLoadMore={() => users.fetchNextPage()}
          />
        </div>
      </div>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} />}
      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSetPassword={() => {
            setSettingPassword(editing);
            setEditing(null);
          }}
        />
      )}
      {settingPassword && (
        <SetPasswordModal user={settingPassword} isSelf={settingPassword.id === me?.id} onClose={() => setSettingPassword(null)} />
      )}
    </>
  );
}
