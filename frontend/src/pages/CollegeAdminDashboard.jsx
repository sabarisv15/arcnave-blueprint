import React, { useState, useEffect } from 'react';
import SidebarLayout from '../components/SidebarLayout';
import { useToast, useAuth } from '../App';
import { Building, Plus, Edit3, Trash2, Save } from 'lucide-react';

// College Admin's own dashboard — BusinessRules.md's College Admin
// resolution, item 3: maintaining the college's own profile/details is
// this role's ongoing operational duty. One tab this slice: "College
// Profile" (the 3 colleges columns + departments CRUD), same
// card+list+modal convention PrincipalDashboard.jsx's Fee Structures
// tab already uses. Bulk-provisioning (item 1) and template management
// (item 2) are separate, not-yet-built slices of this same role — not
// guessed at here.
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

  const menuItems = [{ id: 'college_profile', label: 'College Profile', icon: Building }];

  return (
    <SidebarLayout activeTab="college_profile" onTabChange={() => {}} menuItems={menuItems} roleLabel="College Admin">
      <div className="space-y-6 animate-slide-up">
        <div>
          <p className="section-title mb-1">College Admin · Institution Profile</p>
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
