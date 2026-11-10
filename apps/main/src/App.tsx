import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, meApi, sessionHasEnded, signOut, tokenStore } from '@glazion/api-client';
import { AccountStatus } from '@glazion/types';
import { Loading } from '@glazion/ui';
import AppLayout from './layouts/AppLayout';
import SignInPage from './pages/SignInPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import SearchPage from './pages/SearchPage';
import ChatPage from './pages/ChatPage';
import UmfPage from './pages/UmfPage';
import AccountPage from './pages/AccountPage';

const BLOCKED_COPY: Partial<Record<AccountStatus, { title: string; text: string }>> = {
  [AccountStatus.Suspended]: {
    title: 'Your account is suspended',
    text: 'Get in touch with Glazion support if you think this is a mistake.',
  },
  [AccountStatus.Disabled]: {
    title: 'This account has been disabled',
    text: 'Get in touch with Glazion support if you need access again.',
  },
};

function Gate({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div className="gate">
      <img src="/logo.png" alt="Glazion" className="gate-logo" />
      <h1 className="gate-title">{title}</h1>
      <p className="gate-text">{text}</p>
      {children}
    </div>
  );
}

/** Whether this tab has been signed in since it opened. Signing out on purpose starts afresh. */
let hadSession = false;

/** Opened a link while signed out, or the session ran out: sign in, then come back to that page. */
function ToSignIn() {
  const { pathname, search, hash } = useLocation();
  const remember = pathname !== '/' && (!hadSession || sessionHasEnded());
  return <Navigate to="/sign-in" replace state={remember ? { from: pathname + search + hash } : undefined} />;
}

/** Just signed in, or an unknown address: the page they were sent away from, else Find tiles. */
function Landing() {
  const from = (useLocation().state as { from?: unknown } | null)?.from;
  // Only a path in this app, never another site.
  const back = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/search';
  return <Navigate to={back} replace />;
}

function SignedIn() {
  hadSession = true;
  const me = useQuery({
    queryKey: ['me'],
    queryFn: meApi.get,
    // While waiting for approval, look again every minute and on coming back to the tab, so the app
    // opens by itself once an admin approves the account.
    refetchInterval: (query) => (query.state.data?.accountStatus === AccountStatus.Pending ? 60_000 : false),
    refetchOnWindowFocus: (query) => query.state.data?.accountStatus === AccountStatus.Pending,
  });

  // The frame shows straight away, so the wait looks like the app loading rather than a blank page.
  if (me.isPending) {
    return (
      <AppLayout>
        <Loading />
      </AppLayout>
    );
  }
  if (me.isError) {
    return (
      <Gate title="We couldn’t load your account" text={errorMessage(me.error)}>
        <div className="gate-actions">
          <button className="btn btn-primary" onClick={() => me.refetch()}>
            Try again
          </button>
          <button className="btn btn-secondary" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </Gate>
    );
  }

  if (me.data.accountStatus === AccountStatus.Pending) {
    const checked = new Date(me.dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return (
      <Gate
        title="Your account is waiting for approval"
        text="An admin needs to approve it before you can use Glazion. This page checks every minute and opens by itself once it’s approved."
      >
        <div className="gate-actions">
          <button className="btn btn-primary" onClick={() => me.refetch()} disabled={me.isFetching} aria-busy={me.isFetching}>
            {me.isFetching && <span className="spinner" />}
            {me.isFetching ? 'Checking…' : 'Check again'}
          </button>
          <button className="btn btn-secondary" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
        <p className="gate-note" aria-live="polite">
          Still waiting. Last checked at {checked}.
        </p>
      </Gate>
    );
  }

  const blocked = BLOCKED_COPY[me.data.accountStatus];
  if (blocked) {
    return (
      <Gate {...blocked}>
        <button className="btn btn-secondary" onClick={() => signOut()}>
          Sign out
        </button>
      </Gate>
    );
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/search" replace />} />
        <Route path="search/:searchId?" element={<SearchPage />} />
        <Route path="chat/:conversationId?" element={<ChatPage />} />
        <Route path="umf" element={<UmfPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<Landing />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const signedIn = useSyncExternalStore(tokenStore.subscribe, () => tokenStore.access !== null);

  useEffect(() => {
    if (!signedIn) queryClient.clear();
  }, [signedIn, queryClient]);

  if (signedIn) return <SignedIn />;

  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="*" element={<ToSignIn />} />
    </Routes>
  );
}
