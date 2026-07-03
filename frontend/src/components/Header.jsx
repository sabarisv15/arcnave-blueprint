import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { LogOut, Rocket, LayoutDashboard, Users, Brain } from 'lucide-react';

export default function Header() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  if (!user) return null;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const getRoleColor = (role) => {
    if (role === 'principal') return 'badge-rose';
    if (role === 'hod') return 'badge-cyan';
    return 'badge-violet';
  };

  const getRoleLabel = (role) => {
    if (role === 'principal') return 'Principal';
    if (role === 'hod') return `HOD · ${user.department}`;
    return `Tutor · ${user.department}`;
  };

  const isActive = (path) => location.pathname === path;

  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 40 }}>
      <div style={{
        background: 'rgba(255,255,255,0.80)',
        backdropFilter: 'blur(40px) saturate(200%)',
        WebkitBackdropFilter: 'blur(40px) saturate(200%)',
        borderBottom: '0.5px solid var(--sep, rgba(60,60,67,0.10))',
        boxShadow: '0 1px 0 rgba(255,255,255,0.70), 0 2px 14px rgba(0,0,0,0.04)',
      }}>
        <div style={{ maxWidth: '80rem', margin: '0 auto', padding: '0 20px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>

          {/* Left: Brand + Nav */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {/* Logo */}
            <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', transition: 'opacity 0.2s ease' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                background: 'linear-gradient(135deg, #007AFF 0%, #5856D6 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 3px 10px rgba(0,122,255,0.30), inset 0 1px 0 rgba(255,255,255,0.25)',
                transition: 'transform 0.2s ease',
              }}>
                <Rocket style={{ width: 15, height: 15, color: 'white' }} />
              </div>
              <span style={{
                fontWeight: 900, fontSize: 18, letterSpacing: '-0.04em',
                background: 'linear-gradient(135deg, #007AFF 0%, #5856D6 60%, #AF52DE 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>
                arcnave
              </span>
            </Link>

            {/* Navigation pills */}
            {user.role === 'staff' && (
              <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }} className="hidden sm:flex">
                <Link to="/dashboard/staff/tutor-class"
                  className={`nav-pill ${isActive('/dashboard/staff/tutor-class') ? 'active' : ''}`}>
                  <Users style={{ width: 13, height: 13 }} /> My Class
                </Link>
                <Link to="/dashboard/ai"
                  className={`nav-pill ${isActive('/dashboard/ai') ? 'active' : ''}`}
                  style={{ color: isActive('/dashboard/ai') ? 'var(--ios-purple)' : undefined }}>
                  <Brain style={{ width: 13, height: 13 }} /> Campus Brain
                </Link>
              </nav>
            )}

            {user.role === 'hod' && (
              <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }} className="hidden sm:flex">
                <Link to="/dashboard/hod"
                  className={`nav-pill ${isActive('/dashboard/hod') ? 'active' : ''}`}>
                  <LayoutDashboard style={{ width: 13, height: 13 }} /> Workload & Staff
                </Link>
                <Link to="/dashboard/hod/tutor-class"
                  className={`nav-pill ${isActive('/dashboard/hod/tutor-class') ? 'active' : ''}`}>
                  <Users style={{ width: 13, height: 13 }} /> Class Monitor
                </Link>
                <Link to="/dashboard/ai"
                  className={`nav-pill ${isActive('/dashboard/ai') ? 'active' : ''}`}
                  style={{ color: isActive('/dashboard/ai') ? 'var(--ios-purple)' : undefined }}>
                  <Brain style={{ width: 13, height: 13 }} /> Campus Brain
                </Link>
              </nav>
            )}

            {user.role === 'principal' && (
              <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }} className="hidden sm:flex">
                <Link to="/dashboard/principal"
                  className={`nav-pill ${isActive('/dashboard/principal') ? 'active' : ''}`}>
                  <LayoutDashboard style={{ width: 13, height: 13 }} /> Approvals
                </Link>
                <Link to="/dashboard/principal/tutor-class"
                  className={`nav-pill ${isActive('/dashboard/principal/tutor-class') ? 'active' : ''}`}>
                  <Users style={{ width: 13, height: 13 }} /> All Classes
                </Link>
                <Link to="/dashboard/ai"
                  className={`nav-pill ${isActive('/dashboard/ai') ? 'active' : ''}`}
                  style={{ color: isActive('/dashboard/ai') ? 'var(--ios-purple)' : undefined }}>
                  <Brain style={{ width: 13, height: 13 }} /> Campus Brain
                </Link>
              </nav>
            )}
          </div>

          {/* Right: User + Logout */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* User card */}
            <Link to="/profile" style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '5px 12px 5px 5px',
              background: 'rgba(120,120,128,0.08)',
              border: '0.5px solid var(--sep)',
              borderRadius: 999, textDecoration: 'none', cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
              className="hidden sm:flex"
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,122,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(0,122,255,0.20)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(120,120,128,0.08)'; e.currentTarget.style.borderColor = 'var(--sep)'; }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #007AFF, #5856D6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800, color: 'white',
                boxShadow: '0 2px 8px rgba(0,122,255,0.28)',
              }}>
                {user.username.charAt(0).toUpperCase()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--label,#000)', letterSpacing: '-0.015em' }}>{user.name || user.username}</span>
                <span className={`badge ${getRoleColor(user.role)}`} style={{ fontSize: '0.59rem', padding: '0.1rem 0.5rem', marginTop: 3 }}>
                  {getRoleLabel(user.role)}
                </span>
              </div>
            </Link>

            {/* Logout */}
            <button
              onClick={handleLogout}
              id="logout-btn"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
                background: 'rgba(255,59,48,0.08)', color: '#FF3B30',
                fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
                letterSpacing: '-0.01em', transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,59,48,0.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,59,48,0.08)'; }}
            >
              <LogOut style={{ width: 14, height: 14 }} />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
