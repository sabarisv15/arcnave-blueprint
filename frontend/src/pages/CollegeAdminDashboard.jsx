import React, { useState, useEffect } from 'react';
import SidebarLayout from '../components/SidebarLayout';
import { useToast, useAuth } from '../App';
import { Building, Plus, Edit3, Trash2, Save, FileText, Upload } from 'lucide-react';

// Institution profile page — originally College Admin's own dashboard.
// BusinessRules.md's College Admin — final model made College Admin
// an ARCNAVE support employee with no seat in any tenant, so this
// page (college profile columns + departments CRUD + document
// template upload) is now reached by Principal instead — see
// App.jsx's route (principal-only) and middleware/permissions.js
// (college_profile.*/departments.*/documents.templates.upload all
// moved to ['principal']). Same card+list+modal convention
// PrincipalDashboard.jsx's Fee Structures tab already uses; not yet
// folded into PrincipalDashboard's own tab set as a follow-up polish
// item, reachable as its own route for now.
export default function CollegeAdminDashboard() {
  const { accessToken } = useAuth();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [profileForm, setProfileForm] = useState({ affiliating_university: '', year_established: '', address: '' });
  const [savingProfile, setSavingProfile] = useState(false);

  const [departments, setDepartments] = useState([]);
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [editingDept, setEditingDept] = useState(null);
  const [deptForm, setDeptForm] = useState({ name: '', approved_intake: '' });
  const [savingDept, setSavingDept] = useState(false);

  const [templates, setTemplates] = useState([]);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);

  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };

  const loadData = async () => {
    setLoading(true);
    try {
      const profileRes = await fetch('/api/v1/college-profile', { headers: authHeaders });
      if (profileRes.ok) {
        const data = await profileRes.json();
        setProfile(data);
        setProfileForm({
          affiliating_university: data.affiliating_university || '',
          year_established: data.year_established || '',
          address: data.address || '',
        });
      }

      const deptRes = await fetch('/api/v1/departments', { headers: authHeaders });
      if (deptRes.ok) setDepartments((await deptRes.json()) || []);

      const templatesRes = await fetch('/api/v1/documents/templates', { headers: authHeaders });
      if (templatesRes.ok) setTemplates((await templatesRes.json()) || []);
    } catch (e) {
      showToast('Error loading college profile', 'danger');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await fetch('/api/v1/college-profile', {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({
          affiliating_university: profileForm.affiliating_university || null,
          year_established: profileForm.year_established ? Number(profileForm.year_established) : null,
          address: profileForm.address || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to save college profile');
      }
      setProfile(await res.json());
      showToast('College profile saved!', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setSavingProfile(false);
    }
  };

  const openAddDept = () => {
    setEditingDept(null);
    setDeptForm({ name: '', approved_intake: '' });
    setShowDeptModal(true);
  };
  const openEditDept = (dept) => {
    setEditingDept(dept);
    setDeptForm({ name: dept.name || '', approved_intake: dept.approved_intake || '' });
    setShowDeptModal(true);
  };

  const handleDeptSubmit = async (e) => {
    e.preventDefault();
    setSavingDept(true);
    try {
      const body = {
        name: deptForm.name,
        approved_intake: deptForm.approved_intake ? Number(deptForm.approved_intake) : null,
      };
      const res = await fetch(
        editingDept ? `/api/v1/departments/${editingDept.id}` : '/api/v1/departments',
        { method: editingDept ? 'PUT' : 'POST', headers: authHeaders, body: JSON.stringify(body) },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to save department');
      }
      showToast(editingDept ? 'Department updated!' : 'Department created!', 'success');
      setShowDeptModal(false);
      loadData();
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setSavingDept(false);
    }
  };

  // Template-fill: upload is the one write POST /documents/templates
  // gates to college_admin (routes/documents.js's own comment) — real
  // bytes, base64-in-JSON, same "no multipart parser exists yet"
  // convention routes/documents.js's own UPLOAD_BODY_FIELDS comment
  // already documents for the general upload route.
  const handleTemplateUpload = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploadingTemplate(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/v1/documents/templates', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ file_base64: base64, file_name: file.name, mime_type: file.type }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to upload template');
      }
      showToast('Template uploaded!', 'success');
      loadData();
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setUploadingTemplate(false);
      e.target.value = '';
    }
  };

  const handleDeleteDept = async (dept) => {
    try {
      const res = await fetch(`/api/v1/departments/${dept.id}`, { method: 'DELETE', headers: authHeaders });
      if (!res.ok && res.status !== 204) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to delete department');
      }
      showToast('Department removed!', 'success');
      loadData();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  const menuItems = [{ id: 'college_profile', label: 'Institution Profile', icon: Building }];

  return (
    <SidebarLayout activeTab="college_profile" onTabChange={() => {}} menuItems={menuItems} roleLabel="Principal">
      <div className="space-y-6 animate-slide-up">
        <div>
          <p className="section-title mb-1">Principal · Institution Profile</p>
          <h1 className="text-3xl font-black text-slate-805 tracking-tight">College Profile</h1>
          <p className="text-slate-500 text-sm mt-1">Maintain your college's own profile details and departments.</p>
        </div>

        {!loading && (
          <div className="space-y-8 animate-slide-up">
            <div className="card p-6 space-y-4">
              <h3 className="font-extrabold text-slate-805 text-sm flex items-center gap-1.5 border-b pb-3 border-slate-50">
                <Building className="w-4 h-4 text-indigo-500" /> College Details
              </h3>
              <form onSubmit={handleProfileSubmit} className="space-y-3 max-w-xl">
                <div>
                  <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider block mb-1">Affiliating University</label>
                  <input
                    type="text"
                    value={profileForm.affiliating_university}
                    onChange={(e) => setProfileForm({ ...profileForm, affiliating_university: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-sm font-semibold focus:outline-none focus:border-indigo-400"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider block mb-1">Year Established</label>
                  <input
                    type="number"
                    value={profileForm.year_established}
                    onChange={(e) => setProfileForm({ ...profileForm, year_established: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-sm font-semibold focus:outline-none focus:border-indigo-400"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider block mb-1">Address</label>
                  <textarea
                    rows="2"
                    value={profileForm.address}
                    onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-sm font-semibold focus:outline-none focus:border-indigo-400"
                  />
                </div>
                <button type="submit" disabled={savingProfile} className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5 disabled:opacity-50">
                  <Save className="w-3.5 h-3.5" /> {savingProfile ? 'Saving…' : 'Save Profile'}
                </button>
              </form>
            </div>

            <div className="card p-6 space-y-4">
              <div className="flex justify-between items-center border-b pb-3 border-slate-50">
                <h3 className="font-extrabold text-slate-805 text-sm flex items-center gap-1.5">
                  <Building className="w-4 h-4 text-indigo-500" /> Departments
                </h3>
                <button onClick={openAddDept} className="btn-primary text-[10px] py-1.5 px-3 flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> Add Department
                </button>
              </div>
              <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                {(departments || []).length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-6 text-center">No departments added yet.</p>
                ) : (
                  departments.map((d) => (
                    <div key={d.id} className="p-3 bg-white border border-slate-150 rounded-xl flex items-center justify-between hover:border-slate-350 transition-colors">
                      <div>
                        <p className="text-xs font-extrabold text-slate-805">{d.name}</p>
                        <p className="text-[9px] text-slate-400 font-semibold">
                          {d.approved_intake ? `Approved intake: ${d.approved_intake}` : 'No approved intake set'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => openEditDept(d)} className="p-1.5 rounded text-slate-500 hover:text-amber-500 hover:bg-slate-100 transition-all" title="Edit">
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDeleteDept(d)} className="p-1.5 rounded text-slate-500 hover:text-rose-500 hover:bg-slate-100 transition-all" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="card p-6 space-y-4">
              <div className="flex justify-between items-center border-b pb-3 border-slate-50">
                <div>
                  <h3 className="font-extrabold text-slate-805 text-sm flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-indigo-500" /> Document Templates
                  </h3>
                  <p className="text-slate-450 text-[10px] font-semibold mt-0.5">
                    Upload a .docx with {'{{field}}'} placeholders — any field name, filled from real data when generated.
                  </p>
                </div>
                <label className="btn-primary text-[10px] py-1.5 px-3 flex items-center gap-1 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" /> {uploadingTemplate ? 'Uploading…' : 'Upload Template'}
                  <input
                    type="file"
                    accept=".docx"
                    className="hidden"
                    disabled={uploadingTemplate}
                    onChange={handleTemplateUpload}
                  />
                </label>
              </div>
              <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                {(templates || []).length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-6 text-center">No templates uploaded yet.</p>
                ) : (
                  templates.map((t) => (
                    <div key={t.id} className="p-3 bg-white border border-slate-150 rounded-xl flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <p className="text-xs font-extrabold text-slate-805">{t.file_name}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {showDeptModal && (
        <div className="modal-backdrop">
          <div className="modal-panel w-full max-w-md animate-scale-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h2 className="text-sm font-extrabold text-slate-800">{editingDept ? 'Edit Department' : 'Add Department'}</h2>
              <button onClick={() => setShowDeptModal(false)} className="text-slate-500 hover:text-slate-800 text-xl font-bold leading-none">&times;</button>
            </div>
            <form onSubmit={handleDeptSubmit} className="p-6 space-y-3">
              <div>
                <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider block mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={deptForm.name}
                  onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-sm font-semibold focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider block mb-1">Approved Intake</label>
                <input
                  type="number"
                  value={deptForm.approved_intake}
                  onChange={(e) => setDeptForm({ ...deptForm, approved_intake: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-sm font-semibold focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowDeptModal(false)} className="btn-ghost text-xs" disabled={savingDept}>Cancel</button>
                <button type="submit" disabled={savingDept} className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50">
                  {savingDept ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </SidebarLayout>
  );
}
