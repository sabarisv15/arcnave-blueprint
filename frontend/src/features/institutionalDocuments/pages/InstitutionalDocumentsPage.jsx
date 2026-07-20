import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FolderOpen, Loader2, Search, Upload } from 'lucide-react';
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

// Bulk upload dialog — every selected file is uploaded with the SAME
// category/academic-year/department (batch metadata, per the phased
// plan's own "Bulk upload" requirement), and a per-file title defaulted
// to its filename (stripped of extension) so a multi-file drop never
// blocks on typing N titles by hand — still editable per file before
// submitting.
function UploadDialog({ categories, departments, academicYearId, onUploaded }) {
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [yearOverride, setYearOverride] = useState('');
  const [files, setFiles] = useState([]);
  const fileInputRef = useRef(null);

  const uploadMutation = useMutation({
    mutationFn: async () => {
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
        });
      }
    },
    onSuccess: () => {
      toast.success(files.length > 1 ? `${files.length} documents uploaded` : 'Document uploaded');
      setFiles([]);
      setCategoryId('');
      setDepartmentId('');
      setYearOverride('');
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
        </div>
        <DialogFooter>
          <Button onClick={() => uploadMutation.mutate()} disabled={uploadMutation.isPending}>
            {uploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Upload${files.length > 1 ? ` (${files.length})` : ''}`}
          </Button>
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
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium">{doc.title || doc.file_name}</TableCell>
                    <TableCell>{categoryNameById.get(doc.category_id) || doc.doc_type}</TableCell>
                    <TableCell>{departmentNameById.get(doc.department_id) || 'College-wide'}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(doc.created_at)}</TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => documentsApi.download(doc.id, doc.file_name)}>
                        <Download className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
