import { useEffect, useSyncExternalStore } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { tokenStore } from '@glazion/api-client';
import DashboardLayout from './layouts/DashboardLayout';
import LoginPage from './pages/LoginPage';
import OverviewPage from './pages/OverviewPage';
import UsersPage from './pages/UsersPage';
import RecipesPage from './pages/RecipesPage';
import BaseGlazesPage from './pages/BaseGlazesPage';
import MaterialsPage from './pages/MaterialsPage';
import LibraryPage from './pages/LibraryPage';
import MatchCheckPage from './pages/MatchCheckPage';
import MatchCheckSearchPage from './pages/MatchCheckSearchPage';
import TileCheckPage from './pages/TileCheckPage';
import ImportsPage from './pages/ImportsPage';
import SearchIndexPage from './pages/SearchIndexPage';
import CaptureCodesPage from './pages/CaptureCodesPage';
import TasksPage from './pages/TasksPage';
import ParticipantsPage from './pages/ParticipantsPage';
import ExperimentsPage from './pages/ExperimentsPage';
import UploadsPage from './pages/UploadsPage';

export default function App() {
  const queryClient = useQueryClient();
  const signedIn = useSyncExternalStore(tokenStore.subscribe, () => tokenStore.access !== null);

  useEffect(() => {
    if (!signedIn) queryClient.clear();
  }, [signedIn, queryClient]);

  if (!signedIn) return <LoginPage />;

  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="recipes" element={<RecipesPage />} />
        <Route path="base-glazes" element={<BaseGlazesPage />} />
        <Route path="materials" element={<MaterialsPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="imports" element={<ImportsPage />} />
        <Route path="search-index" element={<SearchIndexPage />} />
        <Route path="capture-codes" element={<CaptureCodesPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="participants" element={<ParticipantsPage />} />
        <Route path="participants/:userId" element={<ParticipantsPage />} />
        <Route path="experiments" element={<ExperimentsPage />} />
        <Route path="experiments/:id" element={<ExperimentsPage />} />
        <Route path="uploads" element={<UploadsPage />} />
        <Route path="match-check" element={<MatchCheckPage />} />
        <Route path="match-check/:searchId" element={<MatchCheckSearchPage />} />
        <Route path="tile-check" element={<TileCheckPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
