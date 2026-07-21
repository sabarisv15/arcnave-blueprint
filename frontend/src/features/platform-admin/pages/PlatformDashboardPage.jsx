import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, Users, Mail, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    defaultValues: {
      collegeId: '', name: '', subdomain: '', level1PositionTitle: '',
    },
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
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="shrink-0">
        <CardTitle>Create New College</CardTitle>
        <CardDescription>
          Onboard a new college/organization to the platform. When its Principal invitation is
          accepted, a Level 1 Institutional Position Account is also provisioned alongside the
          Principal user.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 overflow-y-auto">
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
            <FormField control={form.control} name="level1PositionTitle" render={({ field }) => (
              <FormItem className="sm:col-span-3">
                <FormLabel>Level 1 Position Title (optional)</FormLabel>
                <FormControl><Input placeholder="e.g. Principal, Director" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
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

export function PlatformDashboardPage() {
  const { data: summary, isLoading, isError } = useQuery({
    queryKey: ['platform', 'dashboard-summary'],
    queryFn: () => platformAdminApi.getDashboardSummary(),
  });

  return (
    <PageContainer className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Platform Dashboard"
        description="Onboard new colleges, manage organizations, and monitor platform health."
      />

      <div className="mb-4 grid shrink-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Building2} label="Organizations" value={summary?.organizationsCount} isLoading={isLoading} />
        <StatCard icon={Users} label="Active Users" value={summary?.activeUsersCount} isLoading={isLoading} />
        <StatCard icon={Mail} label="Pending Invitations" value={summary?.pendingInvitationsCount} isLoading={isLoading} />
        <StatCard icon={Clock} label="Trial Colleges" value={summary?.trialCollegesCount} isLoading={isLoading} />
      </div>

      {isError && (
        <Card className="mb-4 shrink-0"><CardContent className="p-5 text-sm text-destructive">Could not load dashboard summary.</CardContent></Card>
      )}

      <div className="min-h-0 flex-1">
        <CreateCollegeCard />
      </div>
    </PageContainer>
  );
}
