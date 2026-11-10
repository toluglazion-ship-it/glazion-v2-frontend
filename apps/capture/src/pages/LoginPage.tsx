import { useState, type FormEvent } from 'react';
import { errorMessage, sessionHasEnded, signIn } from '@glazion/api-client';
import { Icon } from '@glazion/ui';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState('');
  /** What's missing, said under the field it's about. */
  const [missing, setMissing] = useState<{ username?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);
  // Back here because the session ran out, not because they signed out: say so.
  const [ended] = useState(sessionHasEnded);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    const gaps = { ...(!username.trim() && { username: 'Enter your username.' }), ...(!password && { password: 'Enter your password.' }) };
    setMissing(gaps);
    setError('');
    if (gaps.username || gaps.password) {
      document.getElementById(gaps.username ? 'username' : 'password')?.focus();
      return;
    }
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
      <img className="auth-mark" src="/mark.png" alt="Glazion" width={56} height={56} />
      <h1 className="auth-title">
        Sign in to
        <br />
        Glazion Capture
      </h1>
      <p className="auth-sub">Photograph your glaze test tiles and send them in for review.</p>

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
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
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setMissing(({ username: _, ...rest }) => rest);
            }}
            aria-invalid={missing.username ? true : undefined}
            aria-describedby={missing.username ? 'username-note' : undefined}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            required
          />
          {missing.username && (
            <span className="field-error" id="username-note">
              {missing.username}
            </span>
          )}
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
              onChange={(e) => {
                setPassword(e.target.value);
                setMissing(({ password: _, ...rest }) => rest);
              }}
              aria-invalid={missing.password ? true : undefined}
              aria-describedby={missing.password ? 'password-note' : undefined}
              autoComplete="current-password"
              enterKeyHint="go"
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
          {missing.password && (
            <span className="field-error" id="password-note">
              {missing.password}
            </span>
          )}
        </div>

        <div className="auth-help">
          <button type="button" className="link-btn" onClick={() => setShowHelp((shown) => !shown)} aria-expanded={showHelp}>
            Forgot password?
          </button>
        </div>
        {showHelp && (
          <p className="alert alert-info">
            Your studio admin manages Capture accounts. Ask them to set a new password for you.
          </p>
        )}

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

      <p className="auth-foot">Don’t have an account? Your studio admin can create one.</p>
    </main>
  );
}
