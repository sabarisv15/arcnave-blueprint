import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LogOut, User } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { usePlatformAuth } from '@/hooks/usePlatformAuth';
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

export function PlatformAppShell() {
  const { logout } = usePlatformAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/platform/login');
  }

  return (
    <div className="min-h-screen bg-page-gradient">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 p-3 sm:p-4">
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

        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
