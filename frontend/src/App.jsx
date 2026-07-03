import React, { createContext, useContext, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';

// Create Global Contexts
const AuthContext = createContext(null);
const ToastContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export function useToast() {
  return useContext(ToastContext);
}

// Global iOS 26 Glass Toast
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const cfg = {
    success: { bg: 'rgba(52,199,89,0.13)',  border: 'rgba(52,199,89,0.28)',  color: '#34C759', icon: CheckCircle2 },
    danger:  { bg: 'rgba(255,59,48,0.12)',  border: 'rgba(255,59,48,0.26)',  color: '#FF3B30', icon: XCircle },
    warning: { bg: 'rgba(255,149,0,0.12)',  border: 'rgba(255,149,0,0.26)',  color: '#FF9500', icon: AlertTriangle },
    info:    { bg: 'rgba(0,122,255,0.12)',  border: 'rgba(0,122,255,0.26)',  color: '#007AFF', icon: Info },
  };
  const c = cfg[type] || cfg.info;
  const Icon = c.icon;

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '14px 18px',
      maxWidth: 380, minWidth: 280,
      background: 'rgba(255,255,255,0.88)',
      backdropFilter: 'blur(40px) saturate(200%)',
      WebkitBackdropFilter: 'blur(40px) saturate(200%)',
      border: `1px solid ${c.border}`,
      borderRadius: 18,
      boxShadow: '0 16px 48px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.85)',
      animation: 'toastSlide 0.42s cubic-bezier(0.16,1,0.3,1) both',
    }}>
      <span style={{ width: 32, height: 32, borderRadius: 10, background: c.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon style={{ width: 16, height: 16, color: c.color }} />
      </span>
      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: 'rgba(0,0,0,0.85)', letterSpacing: '-0.01em', lineHeight: 1.4 }}>{message}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(60,60,67,0.40)', fontSize: 18, lineHeight: 1, padding: '0 2px', flexShrink: 0, transition: 'all 0.15s' }}
        onMouseEnter={e => e.currentTarget.style.color = 'rgba(60,60,67,0.80)'}
        onMouseLeave={e => e.currentTarget.style.color = 'rgba(60,60,67,0.40)'}
      >
        <X style={{ width: 15, height: 15 }} />
      </button>
      <style>{`@keyframes toastSlide { from { transform: translateY(24px) scale(0.94); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }`}</style>
    </div>
  );
}

// Protected Route Wrapper
function ProtectedRoute({ children, allowedRoles }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg,#EDF2FF 0%,#EAE5FF 40%,#E4F2FF 100%)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '36px 48px', background: 'rgba(255,255,255,0.80)', backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)', border: '1px solid rgba(255,255,255,0.70)', borderRadius: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.90)' }}>
          <div style={{ width: 44, height: 44, border: '3px solid rgba(0,122,255,0.18)', borderTopColor: '#007AFF', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(60,60,67,0.55)', letterSpacing: '-0.01em' }}>Loading Campus OS...</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
}

// Lazy Load Pages to prevent cyclic imports
import Login from './pages/Login';
import StaffDashboard from './pages/StaffDashboard';
import HodDashboard from './pages/HodDashboard';
import PrincipalDashboard from './pages/PrincipalDashboard';
import TutorClass from './pages/TutorClass';
import TutorClassMonitor from './pages/TutorClassMonitor';
import Profile from './pages/Profile';
import FacultyRegister from './pages/FacultyRegister';
import CampusBrain from './pages/CampusBrain';
// ThreeDBackground removed — aurora mesh is now in SidebarLayout's ios-bg
import CampusAICopilot from './components/CampusAICopilot';

// Index Redirect Page depending on Role
function IndexRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;

  if (user.role === 'staff' || user.role === 'faculty' || user.role === 'class_tutor') {
    return <Navigate to="/dashboard/staff/tutor-class" replace />;
  } else if (user.role === 'hod') {
    return <Navigate to="/dashboard/hod" replace />;
  } else if (user.role === 'principal') {
    return <Navigate to="/dashboard/principal" replace />;
  }
  return <Navigate to="/login" replace />;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [systemStatus, setSystemStatus] = useState({ online: true, fallback: false, gemini: false });

  // Show Toast Helper
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
  };

  const closeToast = () => setToast(null);

  // Fetch Current Session on Startup
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/me');
        if (response.ok) {
          const data = await response.json();
          setUser(data.user);
        }
      } catch (err) {
        console.warn('System appears offline or API failed.', err);
      } finally {
        setLoading(false);
      }
    };

    const checkSystem = async () => {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          const status = await res.json();
          setSystemStatus({
            online: true,
            fallback: status.dbFallbackMode,
            gemini: status.geminiEnabled
          });
        }
      } catch (e) {
        setSystemStatus({ online: false, fallback: true, gemini: false });
      }
    };

    checkAuth();
    checkSystem();
  }, []);

  const login = async (username, password, college_id) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, college_id: college_id || 'college_demo' })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to login');
    }
    const data = await res.json();
    setUser(data.user);
    showToast(`Welcome back, ${data.user.username}!`, 'success');
    return data.user;
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
    setUser(null);
    showToast('Logged out successfully.', 'warning');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, systemStatus, setUser }}>
      <ToastContext.Provider value={{ showToast }}>
        <BrowserRouter>
          {/* Fallback Mode Indicator Alert — iOS glass banner */}
          {systemStatus.fallback && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '8px 20px', background: 'rgba(255,149,0,0.14)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '0.5px solid rgba(255,149,0,0.28)', color: '#FF9500', fontSize: 12, fontWeight: 700, letterSpacing: '-0.01em' }}>
              <span>⚡</span> Fallback Mode — MongoDB offline. Using local JSON database.
            </div>
          )}

          <Routes>
            <Route path="/login" element={user ? <IndexRedirect /> : <Login />} />
            <Route path="/register-faculty" element={<FacultyRegister />} />
            
            <Route path="/" element={<ProtectedRoute><IndexRedirect /></ProtectedRoute>} />
            
            <Route path="/dashboard/staff" element={
              <ProtectedRoute allowedRoles={['staff', 'faculty', 'class_tutor']}>
                <StaffDashboard />
              </ProtectedRoute>
            } />
            
            <Route path="/dashboard/staff/tutor-class" element={
              <ProtectedRoute allowedRoles={['staff', 'faculty', 'class_tutor', 'hod']}>
                <TutorClass />
              </ProtectedRoute>
            } />
            
            <Route path="/dashboard/hod" element={
              <ProtectedRoute allowedRoles={['hod']}>
                <HodDashboard />
              </ProtectedRoute>
            } />
            
            <Route path="/dashboard/hod/tutor-class" element={
              <ProtectedRoute allowedRoles={['hod']}>
                <TutorClassMonitor />
              </ProtectedRoute>
            } />
            
            <Route path="/dashboard/principal" element={
              <ProtectedRoute allowedRoles={['principal']}>
                <PrincipalDashboard />
              </ProtectedRoute>
            } />
            
            <Route path="/dashboard/principal/tutor-class" element={
              <ProtectedRoute allowedRoles={['principal']}>
                <TutorClassMonitor />
              </ProtectedRoute>
            } />

            <Route path="/profile" element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            } />
            <Route path="/profile/:username" element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            } />

            <Route path="/dashboard/ai" element={
              <ProtectedRoute>
                <CampusBrain />
              </ProtectedRoute>
            } />

             <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>

          {/* Interactive 3D AI Assistant floating bubble (shown only when logged in) */}
          {user && <CampusAICopilot />}
        </BrowserRouter>
        
        {toast && (
          <Toast 
            message={toast.message} 
            type={toast.type} 
            onClose={closeToast} 
          />
        )}
      </ToastContext.Provider>
    </AuthContext.Provider>
  );
}
