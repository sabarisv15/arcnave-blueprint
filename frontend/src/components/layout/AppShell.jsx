import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Settings, Bell, MoreHorizontal, LogOut, User,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import { RoleGate } from './RoleGate';
import { cn } from '@/lib/utils';
import { notificationsApi } from '@/api/notifications';

const PRIMARY_NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
  { to: '/students', label: 'Students' },
  { to: '/staff', label: 'Staff' },
  { to: '/academic', label: 'Academic' },
  { to: '/finance', label: 'Finance' },
  { to: '/documents', label: 'Documents' },
  { to: '/institutional-documents', label: 'Institutional Documents' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/workflow/pending', label: 'Approvals' },
];

const MORE_NAV_ITEMS = [
  { to: '/attendance', label: 'Attendance' },
  { to: '/reports', label: 'Reports', permission: 'reports.generate' },
  { to: '/notifications', label: 'Notifications', permission: 'notifications.read' },
  { to: '/ai/copilot', label: 'ARCNAVE AI' },
  { to: '/analytics', label: 'Analytics', permission: 'analytics.attendance_rate.read' },
  { to: '/archival', label: 'Archival' },
];

function navLinkClass({ isActive }) {
  return cn(
    'rounded-full px-3.5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground',
    isActive && 'bg-dark text-dark-foreground hover:text-dark-foreground',
  );
}

function initials(value) {
  if (!value) return '?';
  return value.slice(0, 2).toUpperCase();
}

export function AppShell() {
  const { user, logout, can } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationsApi.list,
    enabled: can('notifications.read'),
  });
  const unreadCount = notifications?.length ?? 0;

  return (
    <div className="min-h-screen bg-page-gradient">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 p-3 sm:p-4">
        <header className="flex flex-wrap items-center gap-3 px-2 py-1">
          <div className="rounded-full border-[1.5px] border-foreground/70 px-4 py-2 text-[17px] font-bold tracking-tight">
            ARCNAVE
          </div>

          <nav className="flex flex-1 flex-wrap items-center justify-center gap-1">
            {PRIMARY_NAV_ITEMS.map(({ to, label }) => (
              <NavLink key={to} to={to} end={to === '/'} className={navLinkClass}>
                {label}
              </NavLink>
            ))}
            <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-full px-3.5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                >
                  <MoreHorizontal className="h-4 w-4" />
                  More
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                {MORE_NAV_ITEMS.map(({ to, label, permission }) => (
                  <RoleGate key={to} permission={permission}>
                    <DropdownMenuItem asChild>
                      <NavLink to={to} className="cursor-pointer">{label}</NavLink>
                    </DropdownMenuItem>
                  </RoleGate>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <RoleGate permission="college_profile.read">
              <NavLink
                to="/settings/college-profile"
                className="flex items-center gap-1.5 rounded-full border-[1.5px] border-foreground/20 px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
              >
                <Settings className="h-4 w-4" />
                Setting
              </NavLink>
            </RoleGate>

            <RoleGate permission="notifications.read">
              <NavLink
                to="/notifications"
                className="relative flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-sm transition-colors hover:bg-accent"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-gold-deep" />
                )}
              </NavLink>
            </RoleGate>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-dark text-xs font-bold text-dark-foreground"
                >
                  {initials(user?.role)}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled className="opacity-100">
                  <User className="h-4 w-4" />
                  <span className="font-medium text-foreground">{user?.role}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={logout} className="cursor-pointer text-destructive focus:text-destructive">
                  <LogOut className="h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
