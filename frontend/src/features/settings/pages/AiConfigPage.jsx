import { useEffect } from 'react';
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
import { aiConfigApi } from '@/api/aiConfig';
import { ApiError } from '@/api/client';
import { AI_PROVIDERS, aiConfigFormSchema } from '@/features/ai/schemas';

export function AiConfigPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['ai-config'], queryFn: () => aiConfigApi.get() });

  const form = useForm({
    resolver: zodResolver(aiConfigFormSchema),
    defaultValues: {
      provider: 'nim', model: '', embeddingModel: '', baseUrl: '', apiKey: '',
    },
  });

  useEffect(() => {
    if (data) {
      form.reset({
        provider: data.provider || 'nim',
        model: data.model || '',
        embeddingModel: data.embeddingModel || '',
        baseUrl: data.baseUrl || '',
        apiKey: '',
      });
    }
  }, [data, form]);

  const updateMutation = useMutation({
    mutationFn: (values) => {
      const payload = { ...values };
      if (!payload.apiKey) delete payload.apiKey;
      for (const key of ['model', 'embeddingModel', 'baseUrl']) {
        if (payload[key] === '') delete payload[key];
      }
      return aiConfigApi.update(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-config'] });
      toast.success('AI configuration saved');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not save AI configuration'),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">AI configuration</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provider</CardTitle>
          <CardDescription>
            {data && (
              <>API key: <Badge variant={data.hasApiKey ? 'default' : 'outline'}>{data.hasApiKey ? 'Configured' : 'Not set'}</Badge></>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <Skeleton className="h-40 w-full" />}
          {isError && <p className="text-sm text-destructive">Could not load AI configuration.</p>}
          {data && (
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => updateMutation.mutateAsync(v))} className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="provider" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Provider</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {AI_PROVIDERS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="model" render={({ field }) => (
                  <FormItem><FormLabel>Model</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="embeddingModel" render={({ field }) => (
                  <FormItem><FormLabel>Embedding model</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="baseUrl" render={({ field }) => (
                  <FormItem><FormLabel>Base URL</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="apiKey" render={({ field }) => (
                  <FormItem>
                    <FormLabel>API key</FormLabel>
                    <FormControl><Input type="password" placeholder={data.hasApiKey ? 'Leave blank to keep current key' : ''} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="col-span-2">
                  <Button type="submit" size="sm" disabled={updateMutation.isPending}>Save</Button>
                </div>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
