import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { RoleGate } from '@/components/layout/RoleGate';
import { documentsApi } from '@/api/documents';
import { ApiError } from '@/api/client';
import { fileToBase64 } from '@/lib/fileToBase64';
import { templateMergeFormSchema } from '@/features/documents/schemas';

function TemplateUploadCard() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [pendingFile, setPendingFile] = useState(null);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!pendingFile) throw new ApiError(400, 'Choose a .docx file first');
      const fileBase64 = await fileToBase64(pendingFile);
      return documentsApi.uploadTemplate({
        fileName: pendingFile.name,
        mimeType: pendingFile.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileBase64,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', 'templates'] });
      toast.success('Template uploaded');
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not upload template'),
  });

  return (
    <RoleGate permission="documents.templates.upload">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload a template</CardTitle>
          <CardDescription>Only .docx files — merge fields are filled in as literal text, never interpreted.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">File (.docx)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx"
              className="block text-sm"
              onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <Button size="sm" onClick={() => uploadMutation.mutate()} disabled={uploadMutation.isPending || !pendingFile}>
            Upload
          </Button>
        </CardContent>
      </Card>
    </RoleGate>
  );
}

function GenerateFromTemplateRow({ template }) {
  const form = useForm({ resolver: zodResolver(templateMergeFormSchema), defaultValues: { fieldsJson: '{\n  \n}' } });
  const [open, setOpen] = useState(false);

  const mergeMutation = useMutation({
    mutationFn: (values) => documentsApi.mergeTemplate(template.id, JSON.parse(values.fieldsJson), `merged-${template.file_name}`),
    onSuccess: () => { toast.success('Document generated and downloaded'); setOpen(false); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not generate document'),
  });

  return (
    <div className="rounded-md border p-3 text-sm space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium">{template.file_name}</span>
        {!open && <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Generate</Button>}
      </div>
      {open && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mergeMutation.mutateAsync(v))} className="space-y-2">
            <FormField control={form.control} name="fieldsJson" render={({ field }) => (
              <FormItem>
                <FormLabel>Fields (JSON object merged into the template)</FormLabel>
                <FormControl>
                  <textarea
                    {...field}
                    rows={4}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={mergeMutation.isPending}>Generate &amp; download</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </form>
        </Form>
      )}
    </div>
  );
}

function TemplatesListCard() {
  const { data: templates, isLoading, isError } = useQuery({
    queryKey: ['documents', 'templates'],
    queryFn: () => documentsApi.listTemplates(),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Templates</CardTitle>
        <CardDescription>Generate a filled document from a template — fields are inserted as literal text.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <Skeleton className="h-16 w-full" />}
        {isError && <p className="text-sm text-destructive">Could not load templates.</p>}
        {templates && templates.length === 0 && <p className="text-sm text-muted-foreground">No templates uploaded yet.</p>}
        {templates && templates.map((t) => <GenerateFromTemplateRow key={t.id} template={t} />)}
      </CardContent>
    </Card>
  );
}

export function DocumentsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Documents</h1>
      <p className="text-sm text-muted-foreground">
        Per-student uploads, reviews, and OCR live on each student&apos;s Documents tab. This page manages
        college-wide document templates.
      </p>
      <TemplateUploadCard />
      <TemplatesListCard />
    </div>
  );
}
