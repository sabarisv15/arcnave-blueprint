import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, LogOut, Mail, User } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { usePlatformAuth } from '@/hooks/usePlatformAuth';
import { platformAdminApi } from '@/api/platform';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/platform/dashboard', label: 'Dashboard' },
  { to: '/platform/organizations', label: 'Organizations' },
  { to: '/platform/invitations', label: 'Invitations' },
  { to: '/platform/audit-logs', label: 'Audit Logs' },
  { to: '/platform/settings', label: 'Settings' },
];

function navLinkClass({ isActive }) {
  return cn(
    'rounded-full px-3.5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground',
    isActive && 'bg-dark text-dark-foreground hover:text-dark-foreground',
  );
}

function NotificationsBell() {
  const { data, isLoading } = useQuery({
    queryKey: ['platform', 'invitations', { status: 'pending', limit: 5 }],
    queryFn: () => platformAdminApi.listInvitations({ status: 'pending', limit: 5 }),
  });
  const count = data?.length ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative flex h-10 w-10 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {count}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Pending invitations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isLoading && <DropdownMenuItem disabled>Loading…</DropdownMenuItem>}
        {!isLoading && count === 0 && <DropdownMenuItem disabled>No pending invitations.</DropdownMenuItem>}
        {data?.map((inv) => (
          <DropdownMenuItem key={inv.id} disabled className="flex items-start gap-2 opacity-100">
            <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="overflow-hidden">
              <div className="truncate text-sm font-medium text-foreground">{inv.email}</div>
              <div className="truncate text-xs text-muted-foreground">
                {inv.college_id} · Expires {new Date(inv.expires_at).toLocaleDateString()}
              </div>
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer justify-center text-sm font-medium">
          <NavLink to="/platform/invitations">View all</NavLink>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PlatformAppShell() {
  const { logout } = usePlatformAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/platform/login');
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-page-gradient">
      <div className="mx-auto flex h-full w-full max-w-[1600px] flex-col gap-4 overflow-hidden p-3 sm:p-4">
        <header className="flex flex-wrap items-center gap-3 px-2 py-1">
          <div className="rounded-full border-[1.5px] border-foreground/70 px-4 py-2 text-[17px] font-bold tracking-tight">
            ARCNAVE
            <span className="ml-1.5 text-xs font-medium text-muted-foreground">Platform Admin</span>
          </div>

          <nav className="flex flex-1 flex-wrap items-center justify-center gap-1">
            {NAV_ITEMS.map(({ to, label }) => (
              <NavLink key={to} to={to} className={navLinkClass}>
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <NotificationsBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-dark text-xs font-bold text-dark-foreground"
                >
                  PA
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled className="opacity-100">
                  <User className="h-4 w-4" />
                  <span className="font-medium text-foreground">Platform admin</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleLogout} className="cursor-pointer text-destructive focus:text-destructive">
                  <LogOut className="h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
