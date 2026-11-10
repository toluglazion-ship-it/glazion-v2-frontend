import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Icon, type IconName } from '@glazion/ui';
import { myTasksQuery } from '../lib/queries';
import { isReadyForPhoto } from '../lib/tasks';
import { useOnline } from '../lib/useOnline';
import { useUploadQueue } from '../lib/uploadQueue';

const TABS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Recipes', icon: 'home', end: true },
  // Your own tiles waiting for their photo (meeting 2026-11-02).
  { to: '/to-photograph', label: 'To photo', icon: 'image' },
  { to: '/snap', label: 'Snap', icon: 'camera' },
  { to: '/history', label: 'Uploads', icon: 'clock' },
  { to: '/profile', label: 'Profile', icon: 'user' },
];

export default function AppShell() {
  const { pathname } = useLocation();
  const online = useOnline();
  const waiting = useUploadQueue().items.length;
  const toSnap = (useQuery(myTasksQuery).data ?? []).filter(isReadyForPhoto).length;
  // The capture flow is a focused task, so the tab bar steps out of the way.
  const hideTabs = pathname.startsWith('/capture');

  return (
    <div className="shell">
      {!online && (
        <div className="offline-bar" role="status">
          <Icon name="wifi-off" size={16} />
          You’re offline. Photos will upload when you reconnect.
        </div>
      )}

      <Outlet />

      {!hideTabs && (
        <nav className="tabbar" aria-label="Main">
          {TABS.map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>
              <span className="tab-icon">
                <Icon name={tab.icon} size={22} />
                {tab.to === '/history' && waiting > 0 && <span className="tab-count" aria-label={`${waiting} waiting to upload`}>{waiting}</span>}
                {tab.to === '/to-photograph' && toSnap > 0 && <span className="tab-count" aria-label={`${toSnap} ready to photograph`}>{toSnap}</span>}
              </span>
              <span>{tab.label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}

