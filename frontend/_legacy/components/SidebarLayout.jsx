import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../App';
import {
  Rocket, LogOut, Bell, Search, Menu, X, User,
  ChevronLeft, ChevronRight, Brain
} from 'lucide-react';

export default function SidebarLayout({
  activeTab,
  onTabChange,
  menuItems = [],
  children,
  roleLabel = 'User Dashboard'
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const mainRef = useRef(null);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const handler = () => setScrolled(el.scrollTop > 16);
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  /* ── Sidebar Nav Item ── */
  const NavItem = ({ item, mini = false, onClick = () => {} }) => {
    const Icon = item.icon;
    const active = activeTab === item.id;
    return (
      <button
        title={mini ? item.label : undefined}
        onClick={() => {
          onClick();
          if (item.path) navigate(item.path);
          else onTabChange(item.id);
        }}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: mini ? 0 : 11,
          justifyContent: mini ? 'center' : 'flex-start',
          padding: mini ? '10px 0' : '10px 12px',
          borderRadius: 14,
          border: 'none',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'inherit',
          letterSpacing: '-0.012em',
          transition: 'all 0.22s cubic-bezier(0.16,1,0.3,1)',
          background: active
            ? 'rgba(0,122,255,0.13)'
            : 'transparent',
          color: active ? 'var(--ios-blue, #007AFF)' : 'var(--label-2, rgba(60,60,67,0.60))',
          position: 'relative',
          textAlign: 'left',
          WebkitTapHighlightColor: 'transparent',
        }}
        onMouseEnter={e => {
          if (!active) {
            e.currentTarget.style.background = 'rgba(120,120,128,0.09)';
            e.currentTarget.style.color = 'var(--label, #000)';
          }
        }}
        onMouseLeave={e => {
          if (!active) {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--label-2, rgba(60,60,67,0.60))';
          }
        }}
      >
        {/* Blue active indicator */}
        {active && (
          <span style={{
            position: 'absolute', left: 0, top: '50%',
            transform: 'translateY(-50%)',
            width: 3, height: 22,
            background: '#007AFF',
            borderRadius: '0 3px 3px 0',
          }} />
        )}

        {/* Icon square */}
        <span style={{
          width: 33, height: 33, borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: active
            ? 'rgba(0,122,255,0.18)'
            : 'rgba(120,120,128,0.10)',
          flexShrink: 0,
          transition: 'all 0.22s ease',
        }}>
          <Icon style={{
            width: 16, height: 16,
            color: active ? '#007AFF' : 'rgba(60,60,67,0.55)',
            transition: 'all 0.22s ease',
          }} />
        </span>

        {!mini && (
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.label}
          </span>
        )}
      </button>
    );
  };

  /* ── Inner sidebar sections ── */
  const SidebarInner = ({ mini = false, onItemClick = () => {} }) => (
    <>
      {/* Brand */}
      <div style={{ padding: mini ? '4px 0 20px' : '4px 4px 20px', marginBottom: 2 }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          gap: mini ? 0 : 11,
          justifyContent: mini ? 'center' : 'flex-start',
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: 13, flexShrink: 0,
            background: 'linear-gradient(135deg, #007AFF 0%, #5856D6 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(0,122,255,0.35), inset 0 1px 0 rgba(255,255,255,0.28)',
          }}>
            <Rocket style={{ width: 18, height: 18, color: 'white' }} />
          </div>
          {!mini && (
            <div>
              <p style={{ fontSize: 16, fontWeight: 800, color: 'var(--label, #000)', letterSpacing: '-0.035em', lineHeight: 1 }}>
                arcnave
              </p>
              <p style={{ fontSize: 9.5, color: 'var(--label-2, rgba(60,60,67,0.60))', fontWeight: 600, marginTop: 2.5, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Campus OS
              </p>
            </div>
          )}
        </div>
      </div>

      {!mini && (
        <p style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--label-3, rgba(60,60,67,0.30))', textTransform: 'uppercase', letterSpacing: '0.10em', padding: '0 4px', marginBottom: 8 }}>
          Navigation
        </p>
      )}

      {/* Nav items */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {menuItems.map(item => (
          <NavItem key={item.id} item={item} mini={mini} onClick={onItemClick} />
        ))}
      </nav>

      {/* Campus Brain shortcut */}
      {!mini && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--label-3, rgba(60,60,67,0.30))', textTransform: 'uppercase', letterSpacing: '0.10em', padding: '0 4px', marginBottom: 8 }}>
            AI
          </p>
          <button
            onClick={() => { onItemClick(); navigate('/dashboard/ai'); }}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 11,
              padding: '10px 12px', borderRadius: 14, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              background: location.pathname === '/dashboard/ai'
                ? 'rgba(175,82,222,0.13)'
                : 'transparent',
              color: location.pathname === '/dashboard/ai' ? '#AF52DE' : 'var(--label-2, rgba(60,60,67,0.60))',
              transition: 'all 0.22s ease',
            }}
            onMouseEnter={e => { if (location.pathname !== '/dashboard/ai') { e.currentTarget.style.background = 'rgba(120,120,128,0.09)'; e.currentTarget.style.color = 'var(--label)'; }}}
            onMouseLeave={e => { if (location.pathname !== '/dashboard/ai') { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--label-2)'; }}}
          >
            <span style={{ width: 33, height: 33, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: location.pathname === '/dashboard/ai' ? 'rgba(175,82,222,0.18)' : 'rgba(120,120,128,0.10)', flexShrink: 0 }}>
              <Brain style={{ width: 16, height: 16, color: location.pathname === '/dashboard/ai' ? '#AF52DE' : 'rgba(60,60,67,0.55)' }} />
            </span>
            Campus Brain
          </button>
        </div>
      )}
    </>
  );

  const SidebarFooter = ({ mini = false, onItemClick = () => {} }) => (
    <div style={{ borderTop: '0.5px solid var(--sep, rgba(60,60,67,0.10))', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 3 }}>

      {/* Profile */}
      <button
        title={mini ? 'Profile' : undefined}
        onClick={() => { onItemClick(); navigate('/profile'); }}
        style={{
          width: '100%', display: 'flex', alignItems: 'center',
          gap: mini ? 0 : 11, justifyContent: mini ? 'center' : 'flex-start',
          padding: mini ? '10px 0' : '10px 12px',
          borderRadius: 14, border: 'none', cursor: 'pointer',
          fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
          background: location.pathname === '/profile' ? 'rgba(0,122,255,0.10)' : 'transparent',
          color: location.pathname === '/profile' ? '#007AFF' : 'var(--label-2)',
          transition: 'all 0.22s ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(120,120,128,0.09)'; e.currentTarget.style.color = 'var(--label)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = location.pathname === '/profile' ? 'rgba(0,122,255,0.10)' : 'transparent'; e.currentTarget.style.color = location.pathname === '/profile' ? '#007AFF' : 'var(--label-2)'; }}
      >
        <span style={{ width: 33, height: 33, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(120,120,128,0.10)', flexShrink: 0 }}>
          <User style={{ width: 16, height: 16 }} />
        </span>
        {!mini && 'Profile'}
      </button>

      {/* Sign Out */}
      <button
        title={mini ? 'Sign Out' : undefined}
        onClick={() => { onItemClick(); handleLogout(); }}
        style={{
          width: '100%', display: 'flex', alignItems: 'center',
          gap: mini ? 0 : 11, justifyContent: mini ? 'center' : 'flex-start',
          padding: mini ? '10px 0' : '10px 12px',
          borderRadius: 14, border: 'none', cursor: 'pointer',
          fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
          background: 'transparent', color: '#FF3B30', transition: 'all 0.22s ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,59,48,0.09)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        <span style={{ width: 33, height: 33, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,59,48,0.10)', flexShrink: 0 }}>
          <LogOut style={{ width: 16, height: 16, color: '#FF3B30' }} />
        </span>
        {!mini && 'Sign Out'}
      </button>

      {/* User card — only in full mode */}
      {!mini && (
        <div style={{
          marginTop: 10, padding: '11px 13px', borderRadius: 16,
          background: 'rgba(120,120,128,0.07)',
          border: '0.5px solid var(--sep, rgba(60,60,67,0.10))',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            background: 'linear-gradient(135deg, #007AFF, #5856D6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 800, color: 'white',
            boxShadow: '0 2px 8px rgba(0,122,255,0.28)',
          }}>
            {(user?.name || user?.username || '?')[0].toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--label, #000)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.015em' }}>
              {user?.name || user?.username}
            </p>
            <p style={{ fontSize: 10, color: 'var(--label-2)', fontWeight: 600, marginTop: 1, textTransform: 'capitalize', letterSpacing: '0.01em' }}>
              {roleLabel}
            </p>
          </div>
        </div>
      )}
    </div>
  );

  const sidebarW = collapsed ? 70 : 240;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg, #F0F4FF)', position: 'relative' }}>

      {/* ── iOS BG MESH (behind everything) ── */}
      <div className="ios-bg">
        <div className="ios-bg-orb ios-bg-orb-1" />
        <div className="ios-bg-orb ios-bg-orb-2" />
        <div className="ios-bg-orb ios-bg-orb-3" />
        <div className="ios-bg-orb ios-bg-orb-4" />
      </div>

      {/* ── DESKTOP SIDEBAR — Liquid Glass ── */}
      <aside
        className="hidden md:flex"
        style={{
          width: sidebarW,
          flexShrink: 0,
          position: 'sticky',
          top: 0,
          height: '100vh',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: collapsed ? '24px 10px' : '24px 16px',
          zIndex: 40,

          /* Liquid Glass */
          background: 'var(--glass, rgba(255,255,255,0.72))',
          backdropFilter: 'blur(40px) saturate(200%)',
          WebkitBackdropFilter: 'blur(40px) saturate(200%)',
          borderRight: '0.5px solid var(--glass-border, rgba(255,255,255,0.58))',
          boxShadow: '2px 0 24px rgba(0,0,0,0.05), inset -0.5px 0 0 rgba(255,255,255,0.50)',
          transition: 'width 0.3s cubic-bezier(0.16,1,0.3,1), padding 0.3s cubic-bezier(0.16,1,0.3,1)',
          overflow: 'hidden',
        }}
      >
        {/* Specular reflection */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg, rgba(255,255,255,0.50) 0%, transparent 38%)', pointerEvents: 'none', zIndex: 0 }} />

        <div style={{ flex: 1, overflow: 'auto', position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column' }}>
          <SidebarInner mini={collapsed} />
        </div>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <SidebarFooter mini={collapsed} />
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            position: 'absolute', bottom: 100, right: -14,
            width: 28, height: 28, borderRadius: '50%',
            background: 'var(--glass-thick, rgba(255,255,255,0.88))',
            backdropFilter: 'blur(20px)',
            border: '0.5px solid var(--glass-border)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', zIndex: 50, transition: 'all 0.2s ease',
          }}
        >
          {collapsed
            ? <ChevronRight style={{ width: 13, height: 13, color: 'var(--label-2)' }} />
            : <ChevronLeft  style={{ width: 13, height: 13, color: 'var(--label-2)' }} />
          }
        </button>
      </aside>

      {/* ── MOBILE SIDEBAR DRAWER ── */}
      {mobileOpen && (
        <div
          className="md:hidden"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', zIndex: 50 }}
          onClick={() => setMobileOpen(false)}
        >
          <aside
            style={{
              width: 260, height: '100%', position: 'absolute', left: 0, top: 0,
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
              padding: '24px 16px',
              background: 'var(--glass-thick, rgba(255,255,255,0.92))',
              backdropFilter: 'blur(40px) saturate(200%)',
              WebkitBackdropFilter: 'blur(40px) saturate(200%)',
              borderRight: '0.5px solid var(--glass-border)',
              boxShadow: '4px 0 32px rgba(0,0,0,0.12)',
              animation: 'slideRight 0.38s cubic-bezier(0.16,1,0.3,1) both',
            }}
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setMobileOpen(false)}
              style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'rgba(120,120,128,0.12)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <X style={{ width: 14, height: 14, color: 'var(--label-2)' }} />
            </button>

            <div style={{ flex: 1, overflow: 'auto' }}>
              <SidebarInner onItemClick={() => setMobileOpen(false)} />
            </div>
            <SidebarFooter onItemClick={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* ── MAIN CONTENT PANEL ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative', zIndex: 1 }}>

        {/* ── Floating Glass Top Bar ── */}
        <header style={{
          position: 'sticky', top: 0, zIndex: 30,
          height: scrolled ? 54 : 62,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 20px',
          background: scrolled
            ? 'rgba(255,255,255,0.88)'
            : 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(40px) saturate(200%)',
          WebkitBackdropFilter: 'blur(40px) saturate(200%)',
          borderBottom: '0.5px solid var(--sep, rgba(60,60,67,0.10))',
          boxShadow: scrolled
            ? '0 4px 24px rgba(0,0,0,0.07), inset 0 -0.5px 0 rgba(255,255,255,0.60)'
            : '0 1px 0 rgba(255,255,255,0.65)',
          transition: 'all 0.3s cubic-bezier(0.16,1,0.3,1)',
        }}>
          {/* Left: Hamburger + Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => setMobileOpen(true)}
              className="md:hidden"
              style={{ width: 36, height: 36, borderRadius: 11, background: 'rgba(120,120,128,0.10)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              <Menu style={{ width: 18, height: 18, color: 'var(--label-2)' }} />
            </button>

            {/* iOS pill search */}
            <div style={{ position: 'relative' }}>
              <Search style={{ width: 14, height: 14, position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--label-3)', pointerEvents: 'none' }} />
              <input
                type="text"
                placeholder="Search"
                style={{
                  width: 200,
                  paddingLeft: 34, paddingRight: 14,
                  paddingTop: 8, paddingBottom: 8,
                  background: 'rgba(120,120,128,0.10)',
                  border: 'none', outline: 'none',
                  borderRadius: 999,
                  fontSize: 13, fontWeight: 500,
                  color: 'var(--label)',
                  fontFamily: 'inherit',
                  transition: 'all 0.25s ease',
                }}
                onFocus={e => { e.currentTarget.style.width = '260px'; e.currentTarget.style.background = 'rgba(0,122,255,0.08)'; }}
                onBlur={e => { e.currentTarget.style.width = '200px'; e.currentTarget.style.background = 'rgba(120,120,128,0.10)'; }}
              />
            </div>
          </div>

          {/* Right: Bell + User pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Notification bell */}
            <button style={{
              width: 36, height: 36, borderRadius: 11,
              background: 'rgba(120,120,128,0.10)',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative', transition: 'all 0.2s ease',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,122,255,0.10)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(120,120,128,0.10)'}
            >
              <Bell style={{ width: 16, height: 16, color: 'var(--label-2)' }} />
              <span style={{ position: 'absolute', top: 8, right: 8, width: 7, height: 7, borderRadius: '50%', background: '#FF3B30', border: '1.5px solid rgba(255,255,255,0.85)' }} />
            </button>

            {/* User pill */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 12px 4px 4px',
              background: 'rgba(120,120,128,0.08)',
              border: '0.5px solid var(--sep)',
              borderRadius: 999,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
              onClick={() => navigate('/profile')}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,122,255,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(120,120,128,0.08)'}
            >
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'linear-gradient(135deg, #007AFF, #5856D6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800, color: 'white', flexShrink: 0,
                boxShadow: '0 2px 8px rgba(0,122,255,0.28)',
              }}>
                {(user?.name || user?.username || '?')[0].toUpperCase()}
              </div>
              <div className="hidden sm:block" style={{ textAlign: 'left' }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--label)', letterSpacing: '-0.015em', lineHeight: 1 }}>
                  {user?.name || user?.username}
                </p>
                <p style={{ fontSize: 9.5, color: 'var(--label-2)', fontWeight: 600, marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {roleLabel}
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* ── Content Area ── */}
        <main ref={mainRef} style={{ flex: 1, padding: '24px 24px', overflowY: 'auto', minHeight: 0, position: 'relative' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
