import { useState, type FormEvent } from 'react';
import { errorMessage, sessionHasEnded, signIn } from '@glazion/api-client';
import { Icon } from '@glazion/ui';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
      // App swaps to the dashboard as soon as the tokens land in the store.
      await signIn(username.trim(), password);
    } catch (err) {
      setError(errorMessage(err, 'That username or password isn’t right.'));
      setLoading(false);
    }
  }

  return (
    <main className="auth">
      <img className="auth-logo" src="/logo.png" alt="Glazion" />

      <form className="auth-card" onSubmit={handleSubmit} noValidate>
        <div>
          <h1 className="auth-title">Sign in to Admin</h1>
          <p className="auth-sub">Manage users, recipes, capture codes and tile uploads.</p>
        </div>

        {ended && !error && (
          <div className="alert alert-info" role="status">
            <Icon name="info" size={18} />
            <span>Your session ended, so you were signed out. Sign in again to carry on.</span>
          </div>
        )}

        {error && (
          <div className="alert" role="alert">
            <Icon name="alert" size={18} />
            <span>{error}</span>
          </div>
        )}

        <div className="field">
          <label className="label" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            className="input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            required
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="password">
            Password
          </label>
          <div className="input-wrap">
            <input
              id="password"
              className="input"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
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
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={loading} aria-busy={loading}>
          {loading && <span className="spinner" />}
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="auth-foot">Admin access only. Glaze workers sign in through the Capture app.</p>
    </main>
  );
}
