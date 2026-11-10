import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiError, getStoredUser, isAccountPending, overviewApi, signOut, usersApi } from '@glazion/api-client';
import { AccountStatus } from '@glazion/types';
import { Icon, initials, type IconName } from '@glazion/ui';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

/** In the order an admin's work goes: what needs doing, what's in the catalogue, who, and the machinery. */
const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: 'Review',
    items: [
      { to: '/', label: 'Overview', icon: 'grid', end: true },
      { to: '/uploads', label: 'Upload review', icon: 'inbox' },
      { to: '/match-check', label: 'Match check', icon: 'search' },
      { to: '/tile-check', label: 'Tile check', icon: 'image' },
    ],
  },
  {
    title: 'Catalogue',
    items: [
      { to: '/recipes', label: 'Tile recipes', icon: 'flask' },
      { to: '/base-glazes', label: 'Base glazes', icon: 'sliders' },
      { to: '/experiments', label: 'Cup experiments', icon: 'flask' },
      { to: '/materials', label: 'Materials', icon: 'layers' },
      { to: '/library', label: 'Photo library', icon: 'image' },
    ],
  },
  {
    title: 'People',
    items: [
      { to: '/users', label: 'Users', icon: 'users' },
      { to: '/participants', label: 'Participants', icon: 'user' },
      { to: '/tasks', label: 'Tasks', icon: 'clock' },
      { to: '/capture-codes', label: 'Capture codes', icon: 'key' },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/imports', label: 'Imports', icon: 'upload' },
      { to: '/search-index', label: 'Search index', icon: 'search' },
    ],
  },
];

export default function DashboardLayout() {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const user = getStoredUser();
  const name = user?.displayName ?? user?.username ?? 'Admin';

  // Shares its cache with the Overview page and feeds the review count in the nav.
  const overview = useQuery({ queryKey: ['overview'], queryFn: overviewApi.get, refetchInterval: 60_000 });
  const pending = overview.data?.pendingReview ?? 0;
  // Sign-ups waiting for approval, for the count next to Users.
  const waitingUsers = useQuery({
    queryKey: ['pending-users'],
    queryFn: () => usersApi.list({ status: AccountStatus.Pending, pageSize: 1 }),
    refetchInterval: 60_000,
    enabled: !overview.isError,
  });
  const signUps = waitingUsers.data?.totalCount ?? 0;
  const forbidden = overview.error instanceof ApiError && overview.error.status === 403;
  const awaitingActivation = isAccountPending(overview.error);

  useEffect(() => setMenuOpen(false), [pathname]);

  // The phone menu: focus moves into it when it opens, and Escape (or the backdrop) closes it and
  // puts focus back on the menu button.
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  function closeMenu() {
    setMenuOpen(false);
    menuButton.current?.focus();
  }
  useEffect(() => {
    if (!menuOpen) return;
    sidebar.current?.querySelector<HTMLElement>('.nav-link')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  if (forbidden) {
    return (
      <div className="gate">
        <img src="/logo.png" alt="Glazion" className="gate-logo" />
        <h1 className="gate-title">{awaitingActivation ? 'This account isn’t active yet' : 'This account can’t use the admin'}</h1>
        <p className="gate-text">
          {awaitingActivation
            ? `You’re signed in as ${name}. Another admin needs to activate the account before it can be used.`
            : `You’re signed in as ${name}, which doesn’t have admin access. Sign in with an admin account instead.`}
        </p>
        <button className="btn btn-primary" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="layout">
      <header className="mobile-bar">
        <button ref={menuButton} className="btn btn-ghost btn-icon" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen} aria-controls="sidebar">
          <Icon name="menu" size={22} />
        </button>
        <Link to="/" className="mobile-bar-home" aria-label="Glazion admin home">
          <img src="/logo.png" alt="" className="mobile-bar-logo" />
        </Link>
      </header>

      {menuOpen && <div className="scrim" onClick={closeMenu} />}

      <aside id="sidebar" ref={sidebar} className={`sidebar${menuOpen ? ' is-open' : ''}`}>
        <Link to="/" className="brand" aria-label="Glazion admin home">
          <img src="/logo.png" alt="" />
          <span>Admin</span>
        </Link>

        <nav className="nav" aria-label="Main">
          {NAV.map((group) => (
            <div key={group.title} className="nav-group" role="group" aria-labelledby={`nav-${group.title}`}>
              <div className="nav-group-title" id={`nav-${group.title}`}>
                {group.title}
              </div>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}>
                  <Icon name={item.icon} size={18} />
                  <span>{item.label}</span>
                  {item.to === '/uploads' && pending > 0 && <span className="nav-count">{pending}</span>}
                  {item.to === '/users' && signUps > 0 && (
                    <span className="nav-count" title={`${signUps} waiting for approval`}>
                      {signUps}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="avatar">{initials(name)}</div>
          <div className="sidebar-user truncate">{name}</div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => signOut()} aria-label="Sign out" title="Sign out">
            <Icon name="log-out" size={18} />
          </button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
