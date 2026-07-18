import { useRef, useState } from 'react';
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
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { examinationApi } from '@/api/examination';
import { ApiError } from '@/api/client';
import { fileToBase64 } from '@/lib/fileToBase64';
import { examDocumentUploadSchema } from '@/features/academic/schemas';

export function ExaminationTab({ id }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [pendingFile, setPendingFile] = useState(null);

  const { data: documents, isLoading: documentsLoading } = useQuery({
    queryKey: ['classes', id, 'examination-documents'],
    queryFn: () => examinationApi.listDocuments(id),
  });
  const { data: currentTimetable } = useQuery({
    queryKey: ['classes', id, 'examination-timetable', 'current'],
    queryFn: () => examinationApi.getCurrentTimetable(id),
    retry: false,
  });
  const { data: versions } = useQuery({
    queryKey: ['classes', id, 'examination-timetable', 'versions'],
    queryFn: () => examinationApi.listTimetableVersions(id),
  });

  const form = useForm({ resolver: zodResolver(examDocumentUploadSchema), defaultValues: { docType: 'exam_timetable' } });

  const uploadMutation = useMutation({
    mutationFn: async (values) => {
      if (!pendingFile) throw new ApiError(400, 'Choose a file first');
      const fileBase64 = await fileToBase64(pendingFile);
      return examinationApi.uploadDocument(id, {
        docType: values.docType, fileName: pendingFile.name, mimeType: pendingFile.type || 'application/octet-stream', fileBase64,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes', id, 'examination-documents'] });
      toast.success('Document uploaded');
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not upload document'),
  });

  const publishMutation = useMutation({
    mutationFn: (documentId) => examinationApi.publishTimetable(id, documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes', id, 'examination-timetable'] });
      toast.success('Timetable published');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not publish timetable'),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Examination documents</CardTitle>
          <CardDescription>Only the Class Tutor may upload — enforced by the backend.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => uploadMutation.mutateAsync(v))} className="flex items-end gap-2">
              <FormField control={form.control} name="docType" render={({ field }) => (
                <FormItem><FormLabel>Doc type</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="space-y-2">
                <label className="text-sm font-medium">File</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="block text-sm"
                  onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <Button type="submit" size="sm" disabled={uploadMutation.isPending || !pendingFile}>Upload</Button>
            </form>
          </Form>
          {documentsLoading && <Skeleton className="h-16 w-full" />}
          {documents && documents.length === 0 && <p className="text-sm text-muted-foreground">No documents yet.</p>}
          {documents && documents.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
              <span>{doc.doc_type} — {doc.file_name}</span>
              <Button size="sm" variant="outline" onClick={() => publishMutation.mutate(doc.id)} disabled={publishMutation.isPending}>
                Publish as timetable
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Current official timetable</CardTitle></CardHeader>
        <CardContent>
          {currentTimetable
            ? <p className="text-sm">Version {currentTimetable.version_number} — published {currentTimetable.published_at}</p>
            : <p className="text-sm text-muted-foreground">No official timetable published yet.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Version history</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {versions && versions.length === 0 && <p className="text-sm text-muted-foreground">No versions yet.</p>}
          {versions && versions.map((v) => (
            <div key={v.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
              <span>Version {v.version_number} — {v.published_at}</span>
              <Badge variant="secondary">{v.is_current_official ? 'Current' : 'Superseded'}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
