import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Download, FolderOpen, History, Link2, Loader2, Search, Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { RoleGate } from '@/components/layout/RoleGate';
import { documentsApi } from '@/api/documents';
import { documentCategoriesApi } from '@/api/documentCategories';
import { academicYearsApi } from '@/api/academicYears';
import { ApiError } from '@/api/client';
import { fileToBase64 } from '@/lib/fileToBase64';

const YEAR_STORAGE_KEY = 'arcnave.institutionalDocuments.academicYearId';
const ALL_YEARS = 'all';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Draft/Published/Superseded/Archived — task #4's publish lifecycle.
// Colors mirror the existing house convention (default = the
// "healthy"/current state, outline = neutral/in-progress, destructive-
// adjacent muted tones for retired states) without inventing a new
// badge variant.
const STATUS_BADGE_VARIANT = {
  Draft: 'outline',
  Published: 'default',
  Superseded: 'secondary',
  Archived: 'secondary',
};

function StatusBadge({ status }) {
  if (!status) return null;
  return <Badge variant={STATUS_BADGE_VARIANT[status] || 'outline'}>{status}</Badge>;
}

// Bulk upload dialog — every selected file is uploaded with the SAME
// category/academic-year/department (batch metadata, per the phased
// plan's own "Bulk upload" requirement), and a per-file title defaulted
// to its filename (stripped of extension) so a multi-file drop never
// blocks on typing N titles by hand — still editable per file before
// submitting.
// duplicates (task #3): a 409 from the API carries err.body.duplicates
// — this dialog surfaces them as a confirm-or-cancel step rather than
// silently retrying or silently giving up, matching "warn/flag rather
// than silently allowing exact re-uploads" from this session's own
// task. Retrying re-sends the SAME already-base64-encoded file list
// with confirmUpload: true, so the user never has to re-pick files.
function UploadDialog({ categories, departments, academicYearId, onUploaded }) {
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [yearOverride, setYearOverride] = useState('');
  const [files, setFiles] = useState([]);
  const [duplicateWarning, setDuplicateWarning] = useState(null);
  const fileInputRef = useRef(null);

  async function performUpload({ confirmUpload }) {
    if (!categoryId) throw new ApiError(400, 'Choose a category first');
    if (files.length === 0) throw new ApiError(400, 'Choose at least one file');
    const effectiveYearId = yearOverride || (academicYearId !== ALL_YEARS ? academicYearId : undefined);
    for (const { file, title } of files) {
      // eslint-disable-next-line no-await-in-loop
      const fileBase64 = await fileToBase64(file);
      // eslint-disable-next-line no-await-in-loop
      await documentsApi.uploadInstitutional({
        title: title || file.name,
        categoryId,
        academicYearId: effectiveYearId || undefined,
        departmentId: departmentId || undefined,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileBase64,
        confirmUpload,
      });
    }
  }

  const uploadMutation = useMutation({
    mutationFn: () => performUpload({ confirmUpload: false }),
    onSuccess: () => {
      toast.success(files.length > 1 ? `${files.length} documents uploaded` : 'Document uploaded');
      setFiles([]);
      setCategoryId('');
      setDepartmentId('');
      setYearOverride('');
      setDuplicateWarning(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setOpen(false);
      onUploaded();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && err.body && Array.isArray(err.body.duplicates)) {
        setDuplicateWarning(err.body.duplicates);
        return;
      }
      toast.error(err instanceof ApiError ? err.detail : 'Could not upload document(s)');
    },
  });

  const confirmUploadMutation = useMutation({
    mutationFn: () => performUpload({ confirmUpload: true }),
    onSuccess: () => {
      toast.success(files.length > 1 ? `${files.length} documents uploaded` : 'Document uploaded');
      setFiles([]);
      setCategoryId('');
      setDepartmentId('');
      setYearOverride('');
      setDuplicateWarning(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setOpen(false);
      onUploaded();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not upload document(s)'),
  });

  function stripExtension(name) {
    const idx = name.lastIndexOf('.');
    return idx > 0 ? name.slice(0, idx) : name;
  }

  function handleFilesChosen(fileList) {
    setFiles(Array.from(fileList).map((file) => ({ file, title: stripExtension(file.name) })));
  }

  function updateTitle(index, title) {
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, title } : f)));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><Upload className="h-4 w-4" /> Upload</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload documents</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Files</label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="mt-1 block w-full text-sm"
              onChange={(e) => e.target.files && handleFilesChosen(e.target.files)}
            />
          </div>
          {files.length > 0 && (
            <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-2">
              {files.map((f, i) => (
                <Input
                  key={f.file.name + i}
                  value={f.title}
                  placeholder="Title"
                  onChange={(e) => updateTitle(i, e.target.value)}
                />
              ))}
            </div>
          )}
          <div>
            <label className="text-sm font-medium">Category</label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Choose a category" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Department (optional — leave blank for college-wide)</label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="College-wide" /></SelectTrigger>
              <SelectContent>
                {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {duplicateWarning && (
            <div className="rounded-md border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">
              <p className="font-medium">Possible duplicate{duplicateWarning.length > 1 ? 's' : ''} found</p>
              <ul className="mt-1 list-disc pl-4">
                {duplicateWarning.slice(0, 5).map((d) => (
                  <li key={d.id}>{d.title || d.file_name} ({formatDate(d.created_at)})</li>
                ))}
              </ul>
              <p className="mt-1 text-xs">Upload anyway if this is intentional (e.g. a correction), or cancel and use "Versions" on the existing document instead.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          {duplicateWarning ? (
            <>
              <Button variant="outline" onClick={() => setDuplicateWarning(null)}>Cancel</Button>
              <Button onClick={() => confirmUploadMutation.mutate()} disabled={confirmUploadMutation.isPending}>
                {confirmUploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Upload anyway'}
              </Button>
            </>
          ) : (
            <Button onClick={() => uploadMutation.mutate()} disabled={uploadMutation.isPending}>
              {uploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Upload${files.length > 1 ? ` (${files.length})` : ''}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Version history + cross-year lineage (tasks #1/#2) in one dialog:
// every version of this logical document (newest first), a pick-two-
// compare action, and the document's lineage (ancestor/successor
// across academic years) with an inline "link to previous year" form.
function VersionHistoryDialog({ document, onClose }) {
  const [compareIds, setCompareIds] = useState([]);
  const [lineageDocId, setLineageDocId] = useState('');
  const queryClient = useQueryClient();

  const { data: versions, isLoading: versionsLoading } = useQuery({
    queryKey: ['documents', 'institutional', 'versions', document.document_group_id],
    queryFn: () => documentsApi.listVersions(document.document_group_id),
    enabled: Boolean(document),
  });

  const { data: lineage } = useQuery({
    queryKey: ['documents', 'institutional', 'lineage', document.id],
    queryFn: () => documentsApi.getLineage(document.id),
    enabled: Boolean(document),
  });

  const { data: comparison, isFetching: comparing } = useQuery({
    queryKey: ['documents', 'institutional', 'compare', ...compareIds],
    queryFn: () => documentsApi.compareVersions(compareIds[0], compareIds[1]),
    enabled: compareIds.length === 2,
  });

  const linkMutation = useMutation({
    mutationFn: () => documentsApi.linkLineage(document.id, lineageDocId),
    onSuccess: () => {
      toast.success('Linked to previous year');
      setLineageDocId('');
      queryClient.invalidateQueries({ queryKey: ['documents', 'institutional', 'lineage', document.id] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not link documents'),
  });

  function toggleCompare(id) {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Versions &amp; lineage — {document.title || document.file_name}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          <div>
            <h3 className="mb-2 text-sm font-medium">Version history</h3>
            {versionsLoading && <Skeleton className="h-16 w-full" />}
            <div className="space-y-2">
              {(versions || []).map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={compareIds.includes(v.id)} onChange={() => toggleCompare(v.id)} />
                    <span>v{v.version_number} — {v.file_name}</span>
                    <StatusBadge status={v.publication_status} />
                  </label>
                  <span className="text-muted-foreground">{formatDate(v.created_at)}</span>
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Pick two versions to compare.</p>
            {compareIds.length === 2 && (
              <div className="mt-2 rounded-md border p-2 text-xs">
                {comparing && <Loader2 className="h-4 w-4 animate-spin" />}
                {comparison && (
                  <div className="space-y-1">
                    <p className="font-medium">Metadata changes</p>
                    {Object.keys(comparison.metadataDiff).length === 0 && <p>No metadata differences.</p>}
                    {Object.entries(comparison.metadataDiff).map(([field, { from, to }]) => (
                      <p key={field}>{field}: <span className="line-through">{String(from)}</span> → {String(to)}</p>
                    ))}
                    {comparison.contentDiff && comparison.contentDiff.identical && <p className="font-medium">Content is identical.</p>}
                    {comparison.contentDiff && !comparison.contentDiff.identical && comparison.contentDiff.type === 'text' && (
                      <p>{comparison.contentDiff.changes.length} line(s) differ.</p>
                    )}
                    {comparison.contentDiff && comparison.contentDiff.type === 'unsupported' && (
                      <p>Content diff not available for this file type — see metadata above.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-2 flex items-center gap-1 text-sm font-medium"><Link2 className="h-4 w-4" /> Cross-year lineage</h3>
            {lineage && lineage.ancestors.length > 0 && (
              <p className="text-xs text-muted-foreground">Earlier: {lineage.ancestors.map((a) => a.title || a.file_name).join(' → ')}</p>
            )}
            {lineage && lineage.descendants.length > 0 && (
              <p className="text-xs text-muted-foreground">Later: {lineage.descendants.map((d) => d.title || d.file_name).join(', ')}</p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <Input
                placeholder="Previous year document id"
                value={lineageDocId}
                onChange={(e) => setLineageDocId(e.target.value)}
                className="text-xs"
              />
              <Button size="sm" variant="outline" onClick={() => linkMutation.mutate()} disabled={!lineageDocId || linkMutation.isPending}>
                Link
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Academic Year defaults to the college's Active year and is
// remembered across visits (localStorage) — the common case is "I'm
// working in this year's documents," per the product decision, without
// forcing every browse session through a year picker first. "All
// years" is always one click away for the "find it from years ago"
// case.
export function InstitutionalDocumentsPage() {
  const queryClient = useQueryClient();
  const [academicYearId, setAcademicYearId] = useState(() => localStorage.getItem(YEAR_STORAGE_KEY) || '');
  const [categoryId, setCategoryId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [search, setSearch] = useState('');
  const [versionsDoc, setVersionsDoc] = useState(null);

  const { data: years } = useQuery({ queryKey: ['academic-years'], queryFn: () => academicYearsApi.list() });
  const { data: activeYear } = useQuery({ queryKey: ['academic-years', 'active'], queryFn: () => academicYearsApi.getActive() });
  const { data: categories } = useQuery({ queryKey: ['document-categories'], queryFn: () => documentCategoriesApi.list() });
  const { data: departments } = useQuery({ queryKey: ['documents', 'institutional', 'departments'], queryFn: () => documentsApi.listInstitutionalDepartments() });

  useEffect(() => {
    if (!academicYearId && activeYear) {
      setAcademicYearId(activeYear.id);
    }
  }, [academicYearId, activeYear]);

  useEffect(() => {
    if (academicYearId) localStorage.setItem(YEAR_STORAGE_KEY, academicYearId);
  }, [academicYearId]);

  const listParams = useMemo(() => ({
    academicYearId: academicYearId && academicYearId !== ALL_YEARS ? academicYearId : undefined,
    categoryId: categoryId || undefined,
    departmentId: departmentId || undefined,
    search: search || undefined,
  }), [academicYearId, categoryId, departmentId, search]);

  const { data: documents, isLoading, isError } = useQuery({
    queryKey: ['documents', 'institutional', 'list', listParams],
    queryFn: () => documentsApi.listInstitutional(listParams),
  });

  const categoryNameById = useMemo(() => {
    const map = new Map();
    (categories || []).forEach((c) => map.set(c.id, c.name));
    return map;
  }, [categories]);
  const departmentNameById = useMemo(() => {
    const map = new Map();
    (departments || []).forEach((d) => map.set(d.id, d.name));
    return map;
  }, [departments]);

  function invalidateList() {
    queryClient.invalidateQueries({ queryKey: ['documents', 'institutional', 'list'] });
  }

  // Publish/supersede submit a WorkflowService approval request (task
  // #4) — they do not flip the document's status themselves; a
  // principal resolves it from the existing Pending Approvals page
  // (routes/workflowRequests.js's own generic dispatch, extended for
  // entity_type 'institutional_document_publish'/'_supersede'). Archive
  // is the one direct action (no approval gate — see
  // documentService.archiveInstitutionalDocument's own comment).
  const publishMutation = useMutation({
    mutationFn: (id) => documentsApi.submitPublish(id),
    onSuccess: () => { toast.success('Submitted for publish approval'); invalidateList(); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not submit for publish'),
  });
  const supersedeMutation = useMutation({
    mutationFn: (id) => documentsApi.submitSupersede(id),
    onSuccess: () => { toast.success('Submitted for supersede approval'); invalidateList(); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not submit for supersede'),
  });
  const archiveMutation = useMutation({
    mutationFn: (id) => documentsApi.archive(id),
    onSuccess: () => { toast.success('Document archived'); invalidateList(); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not archive document'),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Institutional Documents</h1>
          <p className="text-sm text-muted-foreground">Curriculum, circulars, and other institution-wide documents — the same repository ARCNAVE AI reads from.</p>
        </div>
        <RoleGate permission="documents.institutional.upload">
          <UploadDialog
            categories={categories || []}
            departments={departments || []}
            academicYearId={academicYearId || ALL_YEARS}
            onUploaded={invalidateList}
          />
        </RoleGate>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={academicYearId || ALL_YEARS} onValueChange={(v) => setAcademicYearId(v === ALL_YEARS ? ALL_YEARS : v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Academic Year" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_YEARS}>All years</SelectItem>
            {(years || []).map((y) => (
              <SelectItem key={y.id} value={y.id}>
                {y.year_label}{y.status === 'Active' ? ' (Active)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={departmentId || 'all'} onValueChange={(v) => setDepartmentId(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Department" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {(departments || []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="w-56 pl-8" placeholder="Search title or file name" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge
          variant={categoryId === '' ? 'default' : 'outline'}
          className="cursor-pointer"
          onClick={() => setCategoryId('')}
        >
          <FolderOpen className="mr-1 h-3 w-3" /> All categories
        </Badge>
        {(categories || []).map((c) => (
          <Badge
            key={c.id}
            variant={categoryId === c.id ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => setCategoryId(c.id)}
          >
            {c.name}
          </Badge>
        ))}
      </div>

      <Card>
        <CardContent className="pt-4">
          {isLoading && <Skeleton className="h-32 w-full" />}
          {isError && <p className="text-sm text-destructive">Could not load documents.</p>}
          {documents && documents.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No documents match these filters.</p>
          )}
          {documents && documents.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium">{doc.title || doc.file_name}</TableCell>
                    <TableCell>{categoryNameById.get(doc.category_id) || doc.doc_type}</TableCell>
                    <TableCell>{departmentNameById.get(doc.department_id) || 'College-wide'}</TableCell>
                    <TableCell><StatusBadge status={doc.publication_status} /></TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(doc.created_at)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setVersionsDoc(doc)} title="Versions & lineage">
                          <History className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => documentsApi.download(doc.id, doc.file_name)} title="Download">
                          <Download className="h-4 w-4" />
                        </Button>
                        <RoleGate permission="documents.institutional.upload">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" title="Lifecycle actions">⋮</Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {doc.publication_status === 'Draft' && (
                                <DropdownMenuItem onClick={() => publishMutation.mutate(doc.id)}>
                                  Submit for publish
                                </DropdownMenuItem>
                              )}
                              {doc.publication_status === 'Published' && (
                                <DropdownMenuItem onClick={() => supersedeMutation.mutate(doc.id)}>
                                  Submit for supersede
                                </DropdownMenuItem>
                              )}
                              {(doc.publication_status === 'Published' || doc.publication_status === 'Superseded') && (
                                <DropdownMenuItem onClick={() => archiveMutation.mutate(doc.id)}>
                                  Archive
                                </DropdownMenuItem>
                              )}
                              {doc.publication_status === 'Archived' && (
                                <DropdownMenuItem disabled>No actions available</DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </RoleGate>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {versionsDoc && <VersionHistoryDialog document={versionsDoc} onClose={() => setVersionsDoc(null)} />}
    </div>
  );
}
