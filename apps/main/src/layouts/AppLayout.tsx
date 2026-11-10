import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { getStoredUser } from '@glazion/api-client';
import { Icon, initials, type IconName } from '@glazion/ui';

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/search', label: 'Find tiles', icon: 'search' },
  { to: '/umf', label: 'UMF calculator', icon: 'calculator' },
  { to: '/chat', label: 'Ask Glazion', icon: 'message' },
];

/** The app's frame. `children` stand in for the page while there isn't one yet, e.g. while the account loads. */
export default function AppLayout({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const user = getStoredUser();
  const name = user?.displayName ?? user?.username ?? 'Account';

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

  return (
    <div className="layout">
      <header className="mobile-bar">
        <button ref={menuButton} className="btn btn-ghost btn-icon" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen} aria-controls="sidebar">
          <Icon name="menu" size={22} />
        </button>
        <Link to="/search" className="mobile-bar-home" aria-label="Glazion home">
          <img src="/logo.png" alt="" className="mobile-bar-logo" />
        </Link>
      </header>

      {menuOpen && <div className="scrim" onClick={closeMenu} />}

      <aside id="sidebar" ref={sidebar} className={`sidebar${menuOpen ? ' is-open' : ''}`}>
        <Link to="/search" className="brand">
          <img src="/logo.png" alt="Glazion" />
        </Link>

        <nav className="nav" aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}>
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* The whole row opens Account, where Sign out is: no small icon to hit by mistake beside the name. */}
        <div className="sidebar-foot">
          <NavLink to="/account" className={({ isActive }) => `sidebar-account${isActive ? ' is-active' : ''}`}>
            <span className="avatar" aria-hidden="true">
              {initials(name)}
            </span>
            <span className="sidebar-user truncate">{name}</span>
          </NavLink>
        </div>
      </aside>

      <main className="main">{children ?? <Outlet />}</main>
    </div>
  );
}

