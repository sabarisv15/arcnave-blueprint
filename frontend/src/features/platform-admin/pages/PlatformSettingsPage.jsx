import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription,
} from '@/components/ui/form';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageContainer } from '@/components/layout/PageContainer';
import { ApiError } from '@/api/client';
import { platformAdminApi } from '@/api/platform';
import { platformSettingsFormSchema } from '@/features/platform-admin/schemas';

export function PlatformSettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['platform', 'settings'],
    queryFn: () => platformAdminApi.getSettings(),
  });

  const form = useForm({
    resolver: zodResolver(platformSettingsFormSchema),
    defaultValues: {
      platformName: '', supportEmail: '', defaultTimezone: '', dateFormat: '', itemsPerPage: 20,
    },
  });

  useEffect(() => {
    if (!data) return;
    form.reset({
      platformName: data.platform_name || '',
      supportEmail: data.support_email || '',
      defaultTimezone: data.default_timezone || '',
      dateFormat: data.date_format || '',
      itemsPerPage: data.items_per_page ?? 20,
    });
  }, [data, form]);

  const updateMutation = useMutation({
    mutationFn: (values) => platformAdminApi.updateSettings(values),
    onSuccess: () => {
      toast.success('Settings saved');
      queryClient.invalidateQueries({ queryKey: ['platform', 'settings'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not save settings'),
  });

  return (
    <PageContainer>
      <PageHeader title="Settings" description="Configure platform preferences and settings." />

      {isError && <p className="text-sm text-destructive">Could not load settings.</p>}

      <Card>
        <CardHeader>
          <CardTitle>General Settings</CardTitle>
          <CardDescription>Platform-wide identity and defaults.</CardDescription>
        </CardHeader>
        {isLoading ? (
          <CardContent><Skeleton className="h-64 w-full" /></CardContent>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => updateMutation.mutateAsync(v))}>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <FormField control={form.control} name="platformName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Platform Name</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormDescription>This will be shown across the platform.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="supportEmail" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Support Email</FormLabel>
                    <FormControl><Input type="email" {...field} /></FormControl>
                    <FormDescription>Support email for all communications.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="defaultTimezone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default Time Zone</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="dateFormat" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date Format</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="itemsPerPage" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Items Per Page</FormLabel>
                    <FormControl><Input type="number" min={5} max={200} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
              <CardFooter>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
                </Button>
              </CardFooter>
            </form>
          </Form>
        )}
      </Card>
    </PageContainer>
  );
}
