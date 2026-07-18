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
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { RoleGate } from '@/components/layout/RoleGate';
import { documentsApi } from '@/api/documents';
import { ApiError } from '@/api/client';
import { fileToBase64 } from '@/lib/fileToBase64';
import { documentUploadFormSchema, documentReviewFormSchema, REVIEW_STATUSES } from '@/features/documents/schemas';

function DocumentRow({ doc, studentId }) {
  const queryClient = useQueryClient();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);

  const { data: ocrResults, isLoading: ocrLoading } = useQuery({
    queryKey: ['documents', doc.id, 'ocr'],
    queryFn: () => documentsApi.listOcr(doc.id),
    enabled: ocrOpen,
  });

  const reviewForm = useForm({
    resolver: zodResolver(documentReviewFormSchema),
    defaultValues: { status: 'verified', remarks: '' },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['documents', 'student', studentId] });
  }

  const reviewMutation = useMutation({
    mutationFn: (values) => documentsApi.review(doc.id, { ...values, remarks: values.remarks || undefined }),
    onSuccess: () => { invalidate(); toast.success('Document reviewed'); setReviewOpen(false); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not review document'),
  });
  const deleteMutation = useMutation({
    mutationFn: () => documentsApi.remove(doc.id),
    onSuccess: () => { invalidate(); toast.success('Document removed'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not remove document'),
  });
  const ocrMutation = useMutation({
    mutationFn: () => documentsApi.runOcr(doc.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', doc.id, 'ocr'] });
      setOcrOpen(true);
      toast.success('OCR complete');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not run OCR'),
  });

  const statusVariant = doc.status === 'verified' ? 'default' : doc.status === 'rejected' ? 'destructive' : 'outline';

  return (
    <div className="rounded-md border p-3 text-sm space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{doc.doc_type} — {doc.file_name}</div>
          {doc.remarks && <div className="text-muted-foreground">{doc.remarks}</div>}
        </div>
        <Badge variant={statusVariant}>{doc.status}</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => documentsApi.download(doc.id, doc.file_name)}>Download</Button>
        <RoleGate permission="documents.ocr.run">
          <Button size="sm" variant="outline" onClick={() => (ocrOpen ? setOcrOpen(false) : ocrMutation.mutate())} disabled={ocrMutation.isPending}>
            {ocrOpen ? 'Hide OCR' : 'Run OCR'}
          </Button>
        </RoleGate>
        <RoleGate permission="documents.review">
          {doc.status === 'uploaded' && !reviewOpen && (
            <Button size="sm" variant="outline" onClick={() => setReviewOpen(true)}>Review</Button>
          )}
        </RoleGate>
        <RoleGate permission="documents.delete">
          <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
            Delete
          </Button>
        </RoleGate>
      </div>
      {reviewOpen && (
        <Form {...reviewForm}>
          <form onSubmit={reviewForm.handleSubmit((v) => reviewMutation.mutateAsync(v))} className="flex items-end gap-2">
            <FormField control={reviewForm.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>Outcome</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {REVIEW_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={reviewForm.control} name="remarks" render={({ field }) => (
              <FormItem><FormLabel>Remarks</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <Button type="submit" size="sm" disabled={reviewMutation.isPending}>Save</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button>
          </form>
        </Form>
      )}
      {ocrOpen && (
        <div className="rounded-md bg-muted p-2 text-xs">
          {ocrLoading && <Skeleton className="h-8 w-full" />}
          {ocrResults && ocrResults.length === 0 && <p className="text-muted-foreground">No OCR results yet.</p>}
          {ocrResults && ocrResults.map((r) => (
            <div key={r.id} className="space-y-1">
              <div className="text-muted-foreground">Status: {r.status}</div>
              <div className="whitespace-pre-wrap">{r.extracted_text || '(no text found)'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StudentDocumentsTab({ studentId }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [pendingFile, setPendingFile] = useState(null);

  const { data: documents, isLoading, isError } = useQuery({
    queryKey: ['documents', 'student', studentId],
    queryFn: () => documentsApi.listForStudent(studentId),
  });

  const form = useForm({ resolver: zodResolver(documentUploadFormSchema), defaultValues: { docType: '' } });

  const uploadMutation = useMutation({
    mutationFn: async (values) => {
      if (!pendingFile) throw new ApiError(400, 'Choose a file first');
      const fileBase64 = await fileToBase64(pendingFile);
      return documentsApi.upload({
        studentId,
        docType: values.docType,
        fileName: pendingFile.name,
        mimeType: pendingFile.type || 'application/octet-stream',
        fileBase64,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', 'student', studentId] });
      toast.success('Document uploaded');
      form.reset({ docType: '' });
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not upload document'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Documents</CardTitle>
        <CardDescription>Certificates, ID proofs, and other files uploaded for this student.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <RoleGate permission="documents.upload">
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => uploadMutation.mutateAsync(v))} className="flex items-end gap-2">
              <FormField control={form.control} name="docType" render={({ field }) => (
                <FormItem><FormLabel>Document type</FormLabel><FormControl><Input placeholder="e.g. transfer_certificate" {...field} /></FormControl><FormMessage /></FormItem>
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
        </RoleGate>
        {isLoading && <Skeleton className="h-16 w-full" />}
        {isError && <p className="text-sm text-destructive">Could not load documents.</p>}
        {documents && documents.length === 0 && <p className="text-sm text-muted-foreground">No documents uploaded.</p>}
        {documents && documents.map((doc) => <DocumentRow key={doc.id} doc={doc} studentId={studentId} />)}
      </CardContent>
    </Card>
  );
}
