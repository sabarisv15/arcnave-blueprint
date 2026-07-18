import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { RoleGate } from '@/components/layout/RoleGate';
import { notificationsApi } from '@/api/notifications';
import { ApiError } from '@/api/client';
import { NOTIFICATION_CHANNELS, notificationDraftFormSchema } from '@/features/workflow/schemas';

function DraftNotificationForm() {
  const queryClient = useQueryClient();
  const form = useForm({
    resolver: zodResolver(notificationDraftFormSchema),
    defaultValues: { channel: 'email', toAddress: '', subject: '', body: '' },
  });

  const draftMutation = useMutation({
    mutationFn: (values) => {
      const payload = { ...values };
      if (!payload.subject) delete payload.subject;
      return notificationsApi.draft(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('Notification drafted');
      form.reset({ channel: 'email', toAddress: '', subject: '', body: '' });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not draft notification'),
  });

  return (
    <RoleGate permission="notifications.draft">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Draft a notification</CardTitle>
          <CardDescription>Every outbound notification is a row before it&apos;s sent — draft, then submit for approval.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => draftMutation.mutateAsync(v))} className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="channel" render={({ field }) => (
                <FormItem>
                  <FormLabel>Channel</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {NOTIFICATION_CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="toAddress" render={({ field }) => (
                <FormItem><FormLabel>Recipient</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="subject" render={({ field }) => (
                <FormItem><FormLabel>Subject</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="col-span-2">
                <FormField control={form.control} name="body" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Body</FormLabel>
                    <FormControl>
                      <textarea
                        {...field}
                        rows={3}
                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="col-span-2">
                <Button type="submit" size="sm" disabled={draftMutation.isPending}>Draft</Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </RoleGate>
  );
}

function NotificationRow({ notification }) {
  const queryClient = useQueryClient();
  const submitMutation = useMutation({
    mutationFn: () => notificationsApi.submit(notification.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('Submitted for approval');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not submit for approval'),
  });

  const statusVariant = notification.status === 'Dispatched' ? 'default'
    : notification.status === 'Rejected' ? 'destructive' : 'secondary';

  return (
    <div className="flex items-center justify-between rounded-md border p-3 text-sm">
      <div>
        <div className="font-medium">{notification.channel} — {notification.to_address}</div>
        <div className="text-muted-foreground">{notification.subject || notification.body}</div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={statusVariant}>{notification.status}</Badge>
        <RoleGate permission="notifications.submit">
          {notification.status === 'Draft' && (
            <Button size="sm" variant="outline" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
              Submit for approval
            </Button>
          )}
        </RoleGate>
      </div>
    </div>
  );
}

export function NotificationsPage() {
  const { data: notifications, isLoading, isError } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Notifications</h1>
      <DraftNotificationForm />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ledger</CardTitle>
          <CardDescription>Draft → submitted for approval → approved/rejected → dispatched.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <Skeleton className="h-16 w-full" />}
          {isError && <p className="text-sm text-destructive">Could not load notifications.</p>}
          {notifications && notifications.length === 0 && <p className="text-sm text-muted-foreground">No notifications yet.</p>}
          {notifications && notifications.map((n) => <NotificationRow key={n.id} notification={n} />)}
        </CardContent>
      </Card>
    </div>
  );
}
