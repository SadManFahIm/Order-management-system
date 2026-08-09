import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { useI18n, LANGUAGES } from '../i18n';
import { Logo, Button } from './ui';

const LINKS = [
  { to: '/dashboard', key: 'nav.dashboard', icon: <IconChart /> },
  { to: '/menu', key: 'nav.menu', icon: <IconGrid /> },
  { to: '/products', key: 'nav.products', icon: <IconGrid /> },
  { to: '/promotions', key: 'nav.promotions', icon: <IconTag /> },
  { to: '/orders', key: 'nav.orders', icon: <IconBox /> },
  { to: '/orders/new', key: 'nav.newOrder', icon: <IconPlus /> },
  { to: '/tables', key: 'nav.qrMenu', icon: <IconQr /> },
  { to: '/settings', key: 'nav.settings', icon: <IconGear /> },
];

export default function Navbar() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t, lang, toggleLang } = useI18n();

  const initials =
    (user?.name || user?.email || '?')
      .split(/[\s@]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join('') || '?';

  return (
    <nav className="oms-nav">
      <Link to="/products" className="oms-nav__brand">
        <Logo mark="O" />
      </Link>
      <div className="oms-nav__links">
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === '/products'}
            className={({ isActive }) =>
              `oms-nav__link ${isActive ? 'oms-nav__link--active' : ''}`
            }
          >
            {l.icon}
            <span>{t(l.key)}</span>
          </NavLink>
        ))}
      </div>
      <div className="oms-nav__right">
        <TenantSwitcher />
        <button
          className="oms-icon-btn oms-lang-btn"
          onClick={toggleLang}
          aria-label={lang === 'en' ? 'বাংলায় দেখুন' : 'Switch to English'}
          title={lang === 'en' ? 'বাংলা' : 'English'}
        >
          {LANGUAGES.find((l) => l.code !== lang)?.short}
        </button>
        <button
          className="oms-icon-btn"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          title={theme === 'light' ? 'Dark mode' : 'Light mode'}
        >
          {theme === 'light' ? <IconMoon /> : <IconSun />}
        </button>
        {user && (
          <span className="oms-user">
            <span className="oms-user__avatar">{initials}</span>
            <span className="oms-user__email">{user.email}</span>
          </span>
        )}
        <Button variant="outline" size="sm" onClick={logout}>
          {t('nav.logOut')}
        </Button>
      </div>
    </nav>
  );
}

/* ---------------- Workspace switcher ---------------- */

function TenantSwitcher() {
  const { tenants, activeTenantId, switchTenant } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const active = tenants.find((t) => Number(t.id) === Number(activeTenantId));

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Single-workspace users don't need a switcher.
  if (tenants.length < 1) return null;

  return (
    <div className="oms-tenant" ref={ref}>
      <button
        type="button"
        className={`oms-tenant__trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t('nav.switchWorkspace')}
      >
        <span className="oms-tenant__dot" />
        <span className="oms-tenant__name">
          {active?.name ||
            (tenants.length ? t('nav.selectWorkspace') : t('nav.noWorkspace'))}
        </span>
        <IconChevron />
      </button>
      {open && (
        <div className="oms-tenant__menu" role="listbox" aria-label="Workspaces">
          {tenants.map((tenant) => (
            <button
              type="button"
              key={tenant.id}
              role="option"
              aria-selected={Number(tenant.id) === Number(activeTenantId)}
              className={`oms-tenant__item ${
                Number(tenant.id) === Number(activeTenantId) ? 'is-active' : ''
              }`}
              onClick={() => {
                if (Number(tenant.id) !== Number(activeTenantId))
                  switchTenant(tenant.id);
                setOpen(false);
              }}
            >
              <span className="oms-tenant__item-name">{tenant.name}</span>
              <span className="oms-tenant__item-role">
                {t(`roles.${tenant.role}`) || tenant.role}
              </span>
              {Number(tenant.id) === Number(activeTenantId) && (
                <span className="oms-tenant__check">
                  <IconCheck />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function IconChevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/* Inline icons (no icon dependency — keeps the bundle lean) */

function IconChart() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-7" />
    </svg>
  );
}
function IconGrid() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function IconTag() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
      <circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconBox() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8.5v7a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 15.5v-7a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4a2 2 0 0 1 1 1.73Z" />
      <path d="M3.3 7 12 12l8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function IconGear() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}
function IconQr() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3z" />
      <path d="M14 14h3v3h-3zM20 14h1v1h-1zM14 20h1v1h-1zM18 18h1v1h-1zM21 18v-1M21 21h-1" />
    </svg>
  );
}
function IconMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}
function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </svg>
  );
}
