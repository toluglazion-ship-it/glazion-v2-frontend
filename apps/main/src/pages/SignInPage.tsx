import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, sessionHasEnded, signIn } from '@glazion/api-client';
import { Icon } from '@glazion/ui';
import PasswordField from '../components/PasswordField';
import { usePageTitle } from '../lib/usePageTitle';

export default function SignInPage() {
  const [username, setUsername] = useState('');
  usePageTitle('Sign in');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Back here because the session ran out, not because they signed out: say so.
  const [ended] = useState(sessionHasEnded);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      // App swaps to the signed-in view as soon as the tokens land in the store.
      await signIn(username.trim(), password);
    } catch (err) {
      setError(errorMessage(err, 'That username or password isn’t right.'));
      setLoading(false);
    }
  }

  return (
    <main className="auth">
      <Link to="/" className="auth-logo-link" aria-label="Glazion home">
        <img className="auth-logo" src="/logo.png" alt="" />
      </Link>

      <form className="auth-card" onSubmit={handleSubmit} noValidate>
        <div>
          <h1 className="auth-title">Sign in</h1>
          <p className="auth-sub">See fired tiles that match your glaze chemistry.</p>
        </div>

        {ended && !error && (
          <div className="alert alert-info" role="status">
            <Icon name="info" size={18} />
            <span>Your session ended, so you were signed out. Sign in again to carry on.</span>
          </div>
        )}

        <div className="field">
          <label className="label" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            required
          />
        </div>

        <PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />

        <div className="auth-row">
          <Link to="/forgot-password" state={{ username: username.trim() }}>
            Forgot password?
          </Link>
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={loading} aria-busy={loading}>
          {loading && <span className="spinner" />}
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        {/* Under the button, where the eye is after pressing it; the screen is laid out from the top, so nothing moves. */}
        {error && (
          <div className="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{error}</span>
          </div>
        )}
      </form>

      <p className="auth-foot">
        New to Glazion? <Link to="/register">Create an account</Link>
      </p>
    </main>
  );
}
