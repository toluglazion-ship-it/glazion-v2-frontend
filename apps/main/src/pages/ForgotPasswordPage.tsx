import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { errorMessage } from '@glazion/api-client';
import { accountApi, usesSampleData } from '@glazion/api-client/main';
import { Icon } from '@glazion/ui';
import { usePageTitle } from '../lib/usePageTitle';

export default function ForgotPasswordPage() {
  usePageTitle('Reset your password');
  // Whatever was typed on Sign in comes along, so it isn't typed twice.
  const handed = (useLocation().state as { username?: unknown } | null)?.username;
  const [identifier, setIdentifier] = useState(typeof handed === 'string' ? handed : '');
  const [problem, setProblem] = useState('');
  const reset = useMutation({ mutationFn: accountApi.requestPasswordReset });
  // Until the API sends reset emails the form could only pretend to, so it points people to an admin instead.
  const connected = !usesSampleData('passwordReset');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (reset.isPending) return;
    if (!identifier.trim()) {
      setProblem('Enter your username.');
      return;
    }
    setProblem('');
    reset.mutate(identifier.trim());
  }

  return (
    <main className="auth">
      <Link to="/" className="auth-logo-link" aria-label="Glazion home">
        <img className="auth-logo" src="/logo.png" alt="" />
      </Link>

      {!connected ? (
        <div className="auth-card">
          <div>
            <h1 className="auth-title">Reset your password</h1>
            <p className="auth-sub">Password reset by email isn’t available yet. Ask a Glazion admin to set a new password for you, then sign in with it.</p>
          </div>
          <Link className="btn btn-primary btn-block" to="/sign-in">
            Back to sign in
          </Link>
        </div>
      ) : reset.isSuccess ? (
        <div className="auth-card">
          <div>
            <h1 className="auth-title">Check your email</h1>
            <p className="auth-sub">If there’s an account for {identifier.trim()}, we’ve sent a link to set a new password.</p>
          </div>
          <Link className="btn btn-primary btn-block" to="/sign-in">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form className="auth-card" onSubmit={handleSubmit} noValidate>
          <div>
            <h1 className="auth-title">Reset your password</h1>
            <p className="auth-sub">Enter your username and we’ll send you a link to set a new one.</p>
          </div>

          <div className="field">
            {/* "Username", as on Sign in; the email on the account works too. */}
            <label className="label" htmlFor="identifier">
              Username
            </label>
            <input
              id="identifier"
              className="input"
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value);
                setProblem('');
              }}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              required
              aria-invalid={problem ? true : undefined}
              aria-describedby="identifier-note"
            />
            <span id="identifier-note" className={problem ? 'field-error' : 'hint'}>
              {problem || 'Or the email address on your account.'}
            </span>
          </div>

          {/* Never greyed out: pressing it with the field empty says what's missing. */}
          <button type="submit" className="btn btn-primary btn-block" disabled={reset.isPending} aria-busy={reset.isPending}>
            {reset.isPending && <span className="spinner" />}
            {reset.isPending ? 'Sending…' : 'Send reset link'}
          </button>

          {/* Under the button, where the eye is after pressing it; the screen is laid out from the top, so nothing moves. */}
          {reset.isError && (
            <div className="alert" role="alert">
              <Icon name="alert" size={18} />
              <span>{errorMessage(reset.error)}</span>
            </div>
          )}
        </form>
      )}

      {connected && !reset.isSuccess && (
        <p className="auth-foot">
          <Link to="/sign-in">Back to sign in</Link>
        </p>
      )}
    </main>
  );
}
