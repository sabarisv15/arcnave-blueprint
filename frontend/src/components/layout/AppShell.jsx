import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, Users, GraduationCap, BookOpen, CalendarCheck, Wallet,
  FileText, BarChart3, ClipboardCheck, Bell, Sparkles, Archive, CalendarDays,
  Settings, LogOut,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { RoleGate } from './RoleGate';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/students', label: 'Students', icon: Users },
  { to: '/staff', label: 'Staff', icon: GraduationCap },
  { to: '/academic', label: 'Academic', icon: BookOpen },
  { to: '/attendance', label: 'Attendance', icon: CalendarCheck },
  { to: '/finance', label: 'Finance', icon: Wallet },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/reports', label: 'Reports', icon: BarChart3, permission: 'reports.generate' },
  { to: '/workflow/pending', label: 'Approvals', icon: ClipboardCheck },
  { to: '/notifications', label: 'Notifications', icon: Bell, permission: 'notifications.read' },
  { to: '/ai/copilot', label: 'AI Copilot', icon: Sparkles },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, permission: 'analytics.attendance_rate.read' },
  { to: '/archival', label: 'Archival', icon: Archive },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/settings/college-profile', label: 'Settings', icon: Settings, permission: 'college_profile.read' },
];

export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 border-r border-border p-4 md:block">
        <div className="mb-6 px-2 text-lg font-semibold">ARCNAVE</div>
        <nav className="space-y-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon, permission }) => (
            <RoleGate key={to} permission={permission}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    isActive && 'bg-accent text-accent-foreground',
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            </RoleGate>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border px-4">
          <div className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user?.role}</span>
          </div>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
