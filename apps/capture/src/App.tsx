import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, signOut, tokenStore } from '@glazion/api-client';
import { AccountStatus } from '@glazion/types';
import { Icon, toast } from '@glazion/ui';
import AppShell from './layouts/AppShell';
import SplashScreen from './pages/SplashScreen';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import CapturePage, { TaskCapturePage } from './pages/CapturePage';
import HistoryPage from './pages/HistoryPage';
import SnapPage from './pages/SnapPage';
import TaskRecipePage from './pages/TaskRecipePage';
import UploadDetailPage from './pages/UploadDetailPage';
import ProfilePage from './pages/ProfilePage';
import ToPhotographPage from './pages/ToPhotographPage';
import ExperimentPage from './pages/ExperimentPage';
import { meQuery } from './lib/queries';
import { uploadQueue } from './lib/uploadQueue';

const BLOCKED_COPY: Partial<Record<AccountStatus, { title: string; text: string }>> = {
  [AccountStatus.Pending]: {
    title: 'Your account is waiting for approval',
    text: 'An admin needs to activate it before you can upload. Check back once they have confirmed.',
  },
  [AccountStatus.Suspended]: {
    title: 'Your account is suspended',
    text: 'You can’t upload for now. Speak to your studio admin if you think this is a mistake.',
  },
  [AccountStatus.Disabled]: {
    title: 'This account has been disabled',
    text: 'Speak to your studio admin if you need access again.',
  },
};

function Notice({ title, text, action }: { title: string; text: string; action: ReactNode }) {
  return (
    <div className="notice">
      <div className="empty-icon">
        <Icon name="alert" size={22} />
      </div>
      <h1 className="notice-title">{title}</h1>
      <p className="notice-text">{text}</p>
      {action}
    </div>
  );
}

function SignedIn() {
  const queryClient = useQueryClient();
  const me = useQuery(meQuery);
  const userId = me.data?.id;

  // Photos left waiting from an earlier visit start sending as soon as the app knows who is signed in.
  useEffect(() => {
    if (!userId) return;
    // Uploads carry on after you move on, so say how one ended anywhere but its own screen.
    uploadQueue.start(
      userId,
      (item, seen) => {
        queryClient.invalidateQueries({ queryKey: ['my-uploads'] });
        if (item.taskId) queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
        if (!seen) toast(`${item.recipeName} photo uploaded`);
      },
      (item, seen) => {
        if (!seen) toast.error(`${item.recipeName} photo didn’t upload. Try again from Uploads.`);
      },
    );
    return () => uploadQueue.stop();
  }, [userId, queryClient]);

  if (me.isPending) return <SplashScreen />;

  if (me.isError) {
    return (
      <Notice
        title="We couldn’t load your account"
        text={errorMessage(me.error)}
        action={
          <button className="btn btn-primary" onClick={() => me.refetch()}>
            Try again
          </button>
        }
      />
    );
  }

  const blocked = BLOCKED_COPY[me.data.accountStatus];
  if (blocked) {
    return (
      <Notice
        {...blocked}
        action={
          <button className="btn btn-secondary" onClick={() => signOut()}>
            Sign out
          </button>
        }
      />
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="capture/:recipeId" element={<CapturePage />} />
        <Route path="task/:taskId" element={<TaskCapturePage />} />
        <Route path="tasks/:taskId" element={<TaskRecipePage />} />
        <Route path="to-photograph" element={<ToPhotographPage />} />
        <Route path="experiments/:id" element={<ExperimentPage />} />
        <Route path="snap" element={<SnapPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="history/:uploadId" element={<UploadDetailPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const signedIn = useSyncExternalStore(tokenStore.subscribe, () => tokenStore.access !== null);

  // Never let one person's cached data show up for the next person on a shared phone.
  useEffect(() => {
    if (!signedIn) queryClient.clear();
  }, [signedIn, queryClient]);

  return signedIn ? <SignedIn /> : <LoginPage />;
}
