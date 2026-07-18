import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { aiApi } from '@/api/ai';
import { ApiError } from '@/api/client';
import { askFormSchema, invokeToolFormSchema } from '@/features/ai/schemas';

const TEXTAREA_CLASS = 'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background '
  + 'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

function AskAgentCard() {
  const [result, setResult] = useState(null);
  const form = useForm({ resolver: zodResolver(askFormSchema), defaultValues: { question: '' } });

  const askMutation = useMutation({
    mutationFn: (values) => aiApi.ask(values.question),
    onSuccess: (data) => setResult(data),
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not reach the assistant'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ask the assistant</CardTitle>
        <CardDescription>
          The assistant picks a tool for you if your question matches one, or answers directly. It never takes an
          action beyond what a tool actually runs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => askMutation.mutateAsync(v))} className="space-y-2">
            <FormField control={form.control} name="question" render={({ field }) => (
              <FormItem>
                <FormLabel>Question</FormLabel>
                <FormControl><textarea {...field} rows={2} className={TEXTAREA_CLASS} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" size="sm" disabled={askMutation.isPending}>Ask</Button>
          </form>
        </Form>
        {result && (
          <div className="rounded-md border p-3 text-sm space-y-2">
            {result.toolUsed && <Badge variant="secondary">Used tool: {result.toolUsed}</Badge>}
            {result.answer && <p className="whitespace-pre-wrap">{result.answer}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InvokeToolCard({ tool }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null);
  const form = useForm({
    resolver: zodResolver(invokeToolFormSchema),
    defaultValues: { paramsJson: '', question: '' },
  });

  const invokeMutation = useMutation({
    mutationFn: (values) => aiApi.invokeTool(
      tool.name,
      values.paramsJson.trim() ? JSON.parse(values.paramsJson) : {},
      values.question || undefined,
    ),
    onSuccess: (data) => setResult(data),
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not invoke tool'),
  });

  return (
    <div className="rounded-md border p-3 text-sm space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{tool.name}</div>
          <div className="text-muted-foreground">{tool.description}</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{tool.level}</Badge>
          {!open && <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Invoke</Button>}
        </div>
      </div>
      {open && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => invokeMutation.mutateAsync(v))} className="space-y-2">
            <FormField control={form.control} name="paramsJson" render={({ field }) => (
              <FormItem>
                <FormLabel>Params (JSON object, or blank)</FormLabel>
                <FormControl><textarea {...field} rows={2} className={`${TEXTAREA_CLASS} font-mono`} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="question" render={({ field }) => (
              <FormItem>
                <FormLabel>Question about the result (optional — asks the LLM)</FormLabel>
                <FormControl><textarea {...field} rows={1} className={TEXTAREA_CLASS} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={invokeMutation.isPending}>Run</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Close</Button>
            </div>
          </form>
        </Form>
      )}
      {result && (
        <div className="rounded-md bg-muted p-2 text-xs space-y-1">
          {result.answer && <p className="whitespace-pre-wrap">{result.answer}</p>}
          <pre className="whitespace-pre-wrap">{JSON.stringify(result.entries || result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function ToolsCard() {
  const { data: tools, isLoading, isError } = useQuery({ queryKey: ['ai', 'tools'], queryFn: () => aiApi.listTools() });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Available tools</CardTitle>
        <CardDescription>Invoke a specific tool directly — each still runs through the same Policy Gate as Ask.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <Skeleton className="h-16 w-full" />}
        {isError && <p className="text-sm text-destructive">Could not load tools.</p>}
        {tools && tools.map((tool) => <InvokeToolCard key={tool.name} tool={tool} />)}
      </CardContent>
    </Card>
  );
}

export function CopilotPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">AI Copilot</h1>
      <AskAgentCard />
      <ToolsCard />
    </div>
  );
}
