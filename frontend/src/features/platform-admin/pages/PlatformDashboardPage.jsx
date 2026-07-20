import { NavLink } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Building2, Users, Mail, Clock, ArrowRight, CheckCircle2, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageContainer } from '@/components/layout/PageContainer';
import { ApiError } from '@/api/client';
import { platformAdminApi } from '@/api/platform';
import { collegeFormSchema } from '@/features/platform-admin/schemas';

function StatCard({ icon: Icon, label, value, isLoading }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-foreground">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          {isLoading ? <Skeleton className="h-7 w-16" /> : <div className="text-2xl font-bold leading-none">{value}</div>}
          <div className="mt-1 text-sm text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateCollegeCard() {
  const queryClient = useQueryClient();
  const form = useForm({
    resolver: zodResolver(collegeFormSchema),
    defaultValues: { collegeId: '', name: '', subdomain: '' },
  });

  const createMutation = useMutation({
    mutationFn: (values) => platformAdminApi.createCollege(values),
    onSuccess: () => {
      toast.success('College created');
      form.reset();
      queryClient.invalidateQueries({ queryKey: ['platform', 'dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['platform', 'colleges'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not create college'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create New College</CardTitle>
        <CardDescription>Onboard a new college/organization to the platform.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => createMutation.mutateAsync(v))} className="grid gap-4 sm:grid-cols-3">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Organization Name</FormLabel><FormControl><Input placeholder="Enter college name" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="collegeId" render={({ field }) => (
              <FormItem><FormLabel>College Code</FormLabel><FormControl><Input placeholder="e.g. ABCENG" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="subdomain" render={({ field }) => (
              <FormItem><FormLabel>Subdomain</FormLabel><FormControl><Input placeholder="e.g. abceng" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="sm:col-span-3">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create College'}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function PendingInvitationsCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['platform', 'invitations', { status: 'pending', limit: 5 }],
    queryFn: () => platformAdminApi.listInvitations({ status: 'pending', limit: 5 }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Pending Invitations</CardTitle>
          <CardDescription>Awaiting principal acceptance</CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <NavLink to="/platform/invitations">View all <ArrowRight className="h-3.5 w-3.5" /></NavLink>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <Skeleton className="h-16 w-full" />}
        {isError && <p className="text-sm text-destructive">Could not load invitations.</p>}
        {data && data.length === 0 && <p className="text-sm text-muted-foreground">No pending invitations.</p>}
        {data && data.map((inv) => (
          <div key={inv.id} className="flex items-center justify-between gap-3 rounded-xl bg-accent/50 p-3">
            <div className="flex items-center gap-3 overflow-hidden">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/60 text-xs font-bold">
                <Mail className="h-4 w-4" />
              </span>
              <div className="overflow-hidden">
                <div className="truncate text-sm font-semibold">{inv.email}</div>
                <div className="truncate text-xs text-muted-foreground">{inv.college_id}</div>
              </div>
            </div>
            <div className="shrink-0 text-right text-xs text-muted-foreground">
              Expires {new Date(inv.expires_at).toLocaleDateString()}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function RecentCollegesCard({ summary, isLoading, isError }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Recent Colleges</CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <NavLink to="/platform/organizations">View all <ArrowRight className="h-3.5 w-3.5" /></NavLink>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <Skeleton className="h-16 w-full" />}
        {isError && <p className="text-sm text-destructive">Could not load colleges.</p>}
        {summary && summary.recentColleges.length === 0 && <p className="text-sm text-muted-foreground">No colleges yet.</p>}
        {summary && summary.recentColleges.map((college) => (
          <div key={college.college_id} className="flex items-center justify-between gap-3 rounded-xl bg-accent/50 p-3">
            <div className="overflow-hidden">
              <div className="truncate text-sm font-semibold">{college.name}</div>
              <div className="truncate text-xs text-muted-foreground">{college.subdomain}.arcnave.com</div>
            </div>
            <Badge variant={college.subscription_status === 'trial' ? 'outline' : 'success'}>
              {college.subscription_status}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PlatformActivityCard({ summary, isLoading, isError }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Platform Activity</CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <NavLink to="/platform/audit-logs">View all <ArrowRight className="h-3.5 w-3.5" /></NavLink>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <Skeleton className="h-16 w-full" />}
        {isError && <p className="text-sm text-destructive">Could not load activity.</p>}
        {summary && summary.recentActivity.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
        {summary && summary.recentActivity.map((entry) => (
          <div key={entry.id} className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{entry.action}</div>
              <div className="text-xs text-muted-foreground">
                {entry.entity}{entry.entity_id ? ` · ${entry.entity_id}` : ''} — {entry.actor_username || 'system'}
              </div>
            </div>
            <div className="shrink-0 text-xs text-muted-foreground">
              {new Date(entry.created_at).toLocaleString()}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SystemHealthCard({ summary, isLoading, isError }) {
  const checks = summary ? [
    { label: 'Platform API', ok: true },
    { label: 'Database', ok: true },
    { label: 'Tenant sync', ok: summary.systemHealth.healthy, detail: summary.systemHealth.healthy ? 'All colleges synced' : `${summary.systemHealth.unhealthyCount} of ${summary.systemHealth.totalCount} colleges unhealthy` },
  ] : [];

  return (
    <Card>
      <CardHeader><CardTitle>System Health</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <Skeleton className="h-16 w-full" />}
        {isError && <p className="text-sm text-destructive">Could not load system health.</p>}
        {checks.map((check) => (
          <div key={check.label} className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{check.label}</div>
              {check.detail && <div className="text-xs text-muted-foreground">{check.detail}</div>}
            </div>
            {check.ok
              ? <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Healthy</Badge>
              : <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Degraded</Badge>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function QuickActionsCard() {
  const actions = [
    { to: '/platform/organizations', label: 'Manage Organizations' },
    { to: '/platform/invitations', label: 'Manage Invitations' },
    { to: '/platform/audit-logs', label: 'View Audit Logs' },
    { to: '/platform/settings', label: 'Platform Settings' },
  ];
  return (
    <Card>
      <CardHeader><CardTitle>Quick Actions</CardTitle></CardHeader>
      <CardContent className="space-y-1">
        {actions.map((action) => (
          <NavLink
            key={action.to}
            to={action.to}
            className="flex items-center justify-between rounded-lg px-2 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            {action.label}
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          </NavLink>
        ))}
      </CardContent>
    </Card>
  );
}

export function PlatformDashboardPage() {
  const { data: summary, isLoading, isError } = useQuery({
    queryKey: ['platform', 'dashboard-summary'],
    queryFn: () => platformAdminApi.getDashboardSummary(),
  });

  return (
    <PageContainer>
      <PageHeader
        title="Platform Dashboard"
        description="Onboard new colleges, manage organizations, and monitor platform health."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Building2} label="Organizations" value={summary?.organizationsCount} isLoading={isLoading} />
        <StatCard icon={Users} label="Active Users" value={summary?.activeUsersCount} isLoading={isLoading} />
        <StatCard icon={Mail} label="Pending Invitations" value={summary?.pendingInvitationsCount} isLoading={isLoading} />
        <StatCard icon={Clock} label="Trial Colleges" value={summary?.trialCollegesCount} isLoading={isLoading} />
      </div>

      {isError && (
        <Card className="mb-6"><CardContent className="p-5 text-sm text-destructive">Could not load dashboard summary.</CardContent></Card>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <CreateCollegeCard />
        <PendingInvitationsCard />
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <div className="lg:col-span-2"><RecentCollegesCard summary={summary} isLoading={isLoading} isError={isError} /></div>
        <PlatformActivityCard summary={summary} isLoading={isLoading} isError={isError} />
        <div className="space-y-4">
          <SystemHealthCard summary={summary} isLoading={isLoading} isError={isError} />
          <QuickActionsCard />
        </div>
      </div>
    </PageContainer>
  );
}
