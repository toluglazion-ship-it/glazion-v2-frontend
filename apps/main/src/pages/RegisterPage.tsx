import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ApiError, errorMessage, PASSWORD_MIN, passwordProblem, signIn } from '@glazion/api-client';
import { accountApi, usesSampleData } from '@glazion/api-client/main';
import { AccountStatus } from '@glazion/types';
import { Icon } from '@glazion/ui';
import PasswordField from '../components/PasswordField';
import SampleNote from '../components/SampleNote';
import { drafts } from '../lib/drafts';
import { usePageTitle } from '../lib/usePageTitle';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Field = 'displayName' | 'username' | 'email' | 'password';
type Errors = Partial<Record<Field, string>>;

/** In form order, so the first one with a problem gets the focus. */
const FIELDS: { field: Field; id: string }[] = [
  { field: 'displayName', id: 'name' },
  { field: 'username', id: 'username' },
  { field: 'email', id: 'email' },
  { field: 'password', id: 'password' },
];

/** What the API would refuse in each field, using its own limits. */
function check(values: Record<Field, string>): Errors {
  const errors: Errors = {};
  const name = values.displayName.trim();
  if (!name) errors.displayName = 'Enter your name.';
  else if (name.length > 160) errors.displayName = 'Use no more than 160 characters.';
  const username = values.username.trim();
  if (!username) errors.username = 'Choose a username.';
  else if (username.length > 80) errors.username = 'Use no more than 80 characters.';
  const email = values.email.trim();
  if (!email) errors.email = 'Enter your email address.';
  else if (!EMAIL.test(email)) errors.email = 'Enter a valid email address, like name@example.com.';
  const password = passwordProblem(values.password);
  if (password) errors.password = password;
  return errors;
}

/** Errors the API pinned on one field, such as a username or email that's already taken. */
function fieldErrorsFrom(err: unknown): Errors {
  if (!(err instanceof ApiError)) return {};
  const body = (err.body ?? {}) as { code?: unknown; errors?: unknown };
  if (body.code === 'username_taken') return { username: err.message };
  if (body.code === 'email_taken') return { email: err.message };
  const errors: Errors = {};
  if (body.errors && typeof body.errors === 'object') {
    for (const [key, messages] of Object.entries(body.errors)) {
      const field = FIELDS.find((f) => f.field.toLowerCase() === key.toLowerCase())?.field;
      if (field && Array.isArray(messages) && messages.length) errors[field] = String(messages[0]);
    }
  }
  return errors;
}

function focusFirst(errors: Errors) {
  const first = FIELDS.find((f) => errors[f.field]);
  if (first) document.getElementById(first.id)?.focus();
}

type Draft = Pick<Record<Field, string>, 'displayName' | 'username' | 'email'>;

export default function RegisterPage() {
  usePageTitle('Create an account');
  // Kept for this tab, so a look at another page doesn't mean typing it all again. Never the password.
  const [restored] = useState(() => drafts.read<Draft>('register'));
  const [displayName, setDisplayName] = useState(restored?.displayName ?? '');
  const [username, setUsername] = useState(restored?.username ?? '');
  const [email, setEmail] = useState(restored?.email ?? '');
  const [password, setPassword] = useState('');
  /** Fields the user has filled in and left, or all of them once they've tried to submit. */
  const [checked, setChecked] = useState<Partial<Record<Field, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<Errors>({});
  /** A failure that isn't about one field, such as the server being unreachable. */
  const [failure, setFailure] = useState('');

  const register = useMutation({
    // Signs straight in afterwards, so nobody types it all again: the app then opens, or shows that the
    // account is waiting for approval. If that sign-in fails, the thanks screen sends them to Sign in.
    mutationFn: async (request: Parameters<typeof accountApi.register>[0]) => {
      const result = await accountApi.register(request);
      // Before signing in, while the draft is still filed under no account.
      drafts.write('register', null);
      await signIn(request.username, request.password).catch(() => undefined);
      return result;
    },
    onError: (err) => {
      const errors = fieldErrorsFrom(err);
      setServerErrors(errors);
      setFailure(Object.keys(errors).length ? '' : errorMessage(err));
      requestAnimationFrame(() => focusFirst(errors));
    },
  });

  useEffect(() => {
    if (register.isSuccess) return;
    drafts.write('register', displayName || username || email ? ({ displayName, username, email } satisfies Draft) : null);
  }, [displayName, username, email, register.isSuccess]);

  const values = { displayName, username, email, password };
  const problems = check(values);
  const errors: Errors = {};
  for (const { field } of FIELDS) {
    const error = serverErrors[field] ?? (checked[field] ? problems[field] : undefined);
    if (error) errors[field] = error;
  }

  /** A field's problem shows once it has been filled in and left, and then updates as it's typed in. */
  function leave(field: Field) {
    if (values[field]) setChecked((c) => ({ ...c, [field]: true }));
  }

  function edit(field: Field, set: (value: string) => void) {
    return (value: string) => {
      set(value);
      if (serverErrors[field]) setServerErrors(({ [field]: _, ...rest }) => rest);
    };
  }

  function describe(field: Field, id: string) {
    return { 'aria-invalid': errors[field] ? true : undefined, 'aria-describedby': errors[field] ? `${id}-note` : undefined } as const;
  }

  function note(field: Field, id: string) {
    return errors[field] ? (
      <span className="field-error" id={`${id}-note`}>
        {errors[field]}
      </span>
    ) : null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (register.isPending) return;
    setChecked({ displayName: true, username: true, email: true, password: true });
    setServerErrors({});
    setFailure('');
    if (Object.keys(problems).length) return focusFirst(problems);
    register.mutate({ displayName: displayName.trim(), username: username.trim(), email: email.trim(), password });
  }

  if (register.isSuccess) {
    return (
      <main className="auth">
        <Link to="/" className="auth-logo-link" aria-label="Glazion home">
          <img className="auth-logo" src="/logo.png" alt="" />
        </Link>
        <div className="auth-card">
          <div>
            <h1 className="auth-title">Thanks, {displayName.trim().split(' ')[0]}</h1>
            <p className="auth-sub">
              {register.data?.accountStatus === AccountStatus.Active
                ? 'Your account is ready. Sign in to start searching the tile library.'
                : 'Your account is waiting for approval. Once it’s approved you can sign in and start searching.'}
            </p>
          </div>
          {usesSampleData('signUp') && <SampleNote>Sign-up isn’t connected yet, so no account was created.</SampleNote>}
          <Link className="btn btn-primary btn-block" to="/sign-in">
            Back to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="auth">
      <Link to="/" className="auth-logo-link" aria-label="Glazion home">
        <img className="auth-logo" src="/logo.png" alt="" />
      </Link>

      <form className="auth-card" onSubmit={handleSubmit} noValidate>
        <div>
          <h1 className="auth-title">Create your account</h1>
          <p className="auth-sub">Search the tile library and ask questions about your glazes.</p>
        </div>

        {usesSampleData('signUp') && <SampleNote>Sign-up isn’t connected yet. You can try the form, but it won’t create an account.</SampleNote>}

        <div className="field">
          <label className="label" htmlFor="name">
            Full name
          </label>
          <input
            id="name"
            className="input"
            value={displayName}
            onChange={(e) => edit('displayName', setDisplayName)(e.target.value)}
            onBlur={() => leave('displayName')}
            autoComplete="name"
            autoFocus
            required
            {...describe('displayName', 'name')}
          />
          {note('displayName', 'name')}
        </div>

        <div className="field">
          <label className="label" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            className="input"
            value={username}
            onChange={(e) => edit('username', setUsername)(e.target.value)}
            onBlur={() => leave('username')}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            {...describe('username', 'username')}
          />
          {note('username', 'username')}
        </div>

        <div className="field">
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            value={email}
            onChange={(e) => edit('email', setEmail)(e.target.value)}
            onBlur={() => leave('email')}
            autoComplete="email"
            required
            {...describe('email', 'email')}
          />
          {note('email', 'email')}
        </div>

        <PasswordField
          id="password"
          label="Password"
          value={password}
          onChange={edit('password', setPassword)}
          onBlur={() => leave('password')}
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN} characters.`}
          error={errors.password}
        />

        <button type="submit" className="btn btn-primary btn-block" disabled={register.isPending} aria-busy={register.isPending}>
          {register.isPending && <span className="spinner" />}
          {register.isPending ? 'Creating your account…' : 'Create account'}
        </button>

        {/* Under the button, where the eye is after pressing it; the screen is laid out from the top, so nothing moves. */}
        {failure && (
          <div className="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{failure}</span>
          </div>
        )}
      </form>

      <p className="auth-foot">
        Already have an account? <Link to="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
