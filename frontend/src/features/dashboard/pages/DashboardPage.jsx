import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Bell, BarChart3, Server, Wallet } from 'lucide-react';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RoleGate } from '@/components/layout/RoleGate';
import { useAuth } from '@/hooks/useAuth';
import { workflowRequestsApi } from '@/api/workflowRequests';
import { notificationsApi } from '@/api/notifications';
import { analyticsApi } from '@/api/analytics';
import { backgroundJobsApi } from '@/api/backgroundJobs';
import { financeApi } from '@/api/finance';

function WidgetCard({ icon: Icon, title, description, children }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function PendingApprovalsWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['workflow-requests', 'pending'],
    queryFn: workflowRequestsApi.listPending,
  });

  return (
    <WidgetCard icon={ClipboardCheck} title="Pending approvals" description="Waiting on your action">
      {isLoading && <Skeleton className="h-8 w-full" />}
      {isError && <p className="text-sm text-destructive">Could not load approvals.</p>}
      {data && (
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold">{data.length}</span>
          <span className="text-sm text-muted-foreground">request{data.length === 1 ? '' : 's'}</span>
        </div>
      )}
    </WidgetCard>
  );
}

function NotificationsWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationsApi.list,
  });

  return (
    <WidgetCard icon={Bell} title="Notifications" description="Drafted and submitted announcements">
      {isLoading && <Skeleton className="h-8 w-full" />}
      {isError && <p className="text-sm text-destructive">Could not load notifications.</p>}
      {data && (
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold">{data.length}</span>
          <span className="text-sm text-muted-foreground">in the ledger</span>
        </div>
      )}
    </WidgetCard>
  );
}

function AttendanceRateWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics', 'attendance-rate'],
    queryFn: () => analyticsApi.attendanceRate(),
  });

  return (
    <WidgetCard icon={BarChart3} title="Attendance rate" description="By class, all sessions to date">
      {isLoading && <Skeleton className="h-24 w-full" />}
      {isError && <p className="text-sm text-destructive">Could not load attendance data.</p>}
      {data && data.length === 0 && <p className="text-sm text-muted-foreground">No attendance sessions yet.</p>}
      {data && data.length > 0 && (
        <ul className="space-y-1">
          {data.slice(0, 5).map((row) => (
            <li key={row.classId} className="flex items-center justify-between text-sm">
              <span>{row.className}</span>
              <Badge variant={row.attendanceRatePercent === null ? 'outline' : 'secondary'}>
                {row.attendanceRatePercent === null ? 'No data' : `${row.attendanceRatePercent}%`}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function BackgroundJobsWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['background-jobs'],
    queryFn: backgroundJobsApi.list,
  });

  return (
    <WidgetCard icon={Server} title="Background jobs" description="Recent async operations">
      {isLoading && <Skeleton className="h-8 w-full" />}
      {isError && <p className="text-sm text-destructive">Could not load background jobs.</p>}
      {data && (
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold">{data.length}</span>
          <span className="text-sm text-muted-foreground">total</span>
        </div>
      )}
    </WidgetCard>
  );
}

function FeeStructuresWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['finance', 'fee-structures'],
    queryFn: () => financeApi.listFeeStructures({ limit: 50 }),
  });
  const pending = data?.filter((row) => row.status === 'Pending Approval').length ?? 0;

  return (
    <WidgetCard icon={Wallet} title="Fee structures" description="Awaiting your approval">
      {isLoading && <Skeleton className="h-8 w-full" />}
      {isError && <p className="text-sm text-destructive">Could not load fee structures.</p>}
      {data && (
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold">{pending}</span>
          <span className="text-sm text-muted-foreground">pending of {data.length}</span>
        </div>
      )}
    </WidgetCard>
  );
}

export function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Signed in as {user?.role}.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <PendingApprovalsWidget />
        <RoleGate permission="notifications.read">
          <NotificationsWidget />
        </RoleGate>
        <RoleGate permission="analytics.attendance_rate.read">
          <AttendanceRateWidget />
        </RoleGate>
        <RoleGate permission="background_jobs.read">
          <BackgroundJobsWidget />
        </RoleGate>
        <RoleGate permission="finance.fee_structures.update">
          <FeeStructuresWidget />
        </RoleGate>
      </div>
    </div>
  );
}
