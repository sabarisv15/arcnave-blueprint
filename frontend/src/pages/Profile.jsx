import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth, useToast } from '../App';
import Header from '../components/Header';
import SidebarLayout from '../components/SidebarLayout';
import { 
  User, Calendar, Hash, Briefcase, Phone, Shield, 
  Edit3, Save, ArrowLeft, Check, X, CalendarDays, ExternalLink, GraduationCap, BarChart3, Users
} from 'lucide-react';

export default function Profile() {
  const { username } = useParams();
  const navigate = useNavigate();
  const { user: currentUser, setUser: setCurrentUser } = useAuth();
  const { showToast } = useToast();

  const [profileUser, setProfileUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    joined_year: '',
    aicte_id: '',
    department: '',
    phone_number: '',
    staff_id: ''
  });

  const [workloadData, setWorkloadData] = useState({
    total_approved_hours: 0,
    total_tentative_hours: 0,
    approved_workload: [],
    tentative_workload: []
  });

  const targetUsername = username || currentUser?.username;
  const isOwnProfile = !username || username === currentUser?.username;

  const fetchProfile = async () => {
    if (!targetUsername) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/users/${targetUsername}`);
      if (res.ok) {
        const data = await res.json();
        setProfileUser(data.user);
        setFormData({
          name: data.user.name || '',
          joined_year: data.user.joined_year || '',
          aicte_id: data.user.aicte_id || '',
          department: data.user.department || '',
          phone_number: data.user.phone_number || '',
          staff_id: data.user.staff_id || ''
        });
      } else {
        showToast('Profile not found', 'danger');
        navigate('/');
      }
    } catch (e) {
      console.error(e);
      showToast('Error loading profile', 'danger');
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkload = async () => {
    try {
      const res = await fetch('/api/staff/workload');
      if (res.ok) {
        const data = await res.json();
        setWorkloadData(data);
      }
    } catch (err) {
      console.error('Failed to load workload:', err);
    }
  };

  useEffect(() => {
    fetchProfile();
    fetchWorkload();
  }, [targetUsername]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        const data = await res.json();
        setProfileUser(data.user);
        setCurrentUser(data.user);
        setIsEditing(false);
        showToast('Profile updated successfully!', 'success');
      } else {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update profile');
      }
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  const handleAcceptInvitation = async (tutorId) => {
    try {
      const res = await fetch('/api/tutor/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutor_id: tutorId })
      });
      if (res.ok) {
        showToast('Invitation accepted!', 'success');
        fetchProfile();
        // Update global auth context user
        const meRes = await fetch('/api/auth/me');
        if (meRes.ok) {
          const meData = await meRes.json();
          setCurrentUser(meData.user);
        }
      } else throw new Error('Failed to accept');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  const handleRejectInvitation = async (tutorId) => {
    try {
      const res = await fetch('/api/tutor/invitations/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutor_id: tutorId })
      });
      if (res.ok) {
        showToast('Invitation rejected', 'warning');
        fetchProfile();
        // Update global auth context user
        const meRes = await fetch('/api/auth/me');
        if (meRes.ok) {
          const meData = await meRes.json();
          setCurrentUser(meData.user);
        }
      } else throw new Error('Failed to reject');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: '#F7F9FC' }}>
        <Header />
        <div className="flex items-center justify-center h-72">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
            <span className="text-slate-500 text-sm font-semibold">Loading profile...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!profileUser) return null;

  const menuItems = currentUser?.role === 'principal' ? [
    { id: 'dashboard', label: 'Dashboard Hub', icon: BarChart3, path: '/dashboard/principal' }
  ] : currentUser?.role === 'hod' ? [
    { id: 'dashboard', label: 'Dashboard Hub', icon: BarChart3, path: '/dashboard/hod' },
    { id: 'monitor', label: 'Class Monitor', icon: Users, path: '/dashboard/hod/tutor-class' }
  ] : [
    { id: 'class', label: 'My Class', icon: Users, path: '/dashboard/staff/tutor-class' }
  ];

  return (
    <SidebarLayout
      activeTab="profile"
      onTabChange={() => {}}
      menuItems={menuItems}
      roleLabel={`${currentUser?.role?.toUpperCase()} · Settings`}
    >
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Back navigation */}
        <div className="flex items-center justify-between">
          <button 
            onClick={() => navigate(-1)} 
            className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-amber-600 transition-all bg-white border border-slate-200 px-3 py-1.5 rounded-xl hover-lift"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>

          {isOwnProfile && !isEditing && (
            <button 
              onClick={() => setIsEditing(true)} 
              className="flex items-center gap-1.5 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 transition-all px-4 py-1.5 rounded-xl hover-lift shadow-sm shadow-amber-500/20"
            >
              <Edit3 className="w-3.5 h-3.5" /> Edit Profile
            </button>
          )}
        </div>

        {/* Profile Card */}
        <div className="card p-6 md:p-8 animate-slide-up relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl" />
          
          <div className="flex flex-col md:flex-row md:items-center gap-6 pb-6 border-b border-slate-100">
            {/* Avatar block */}
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-3xl font-black text-amber-700 flex-shrink-0 shadow-inner"
              style={{ background: 'linear-gradient(135deg, #fef3c7, #fde68a)' }}>
              {profileUser.username.charAt(0).toUpperCase()}
            </div>
            
            <div className="space-y-1">
              <h2 className="text-2xl font-black text-slate-800 tracking-tight">
                {profileUser.name || 'No Name Set'}
              </h2>
              <p className="text-xs font-bold text-slate-450 uppercase tracking-wider">
                @{profileUser.username} · <span className="text-amber-650">{profileUser.role}</span>
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-md">
                  Dept: {profileUser.department || 'N/A'}
                </span>
                <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-md">
                  Staff ID: {profileUser.staff_id || 'N/A'}
                </span>
              </div>
            </div>
          </div>

          {/* Details / Form */}
          {isEditing ? (
            <form onSubmit={handleSave} className="pt-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                <div className="space-y-1">
                  <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">Full Name</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      name="name" 
                      value={formData.name} 
                      onChange={handleInputChange} 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-10 pr-4 text-slate-800 text-sm font-semibold focus:outline-none focus:border-amber-500 focus:bg-white transition-all"
                      placeholder="e.g. Staff CSE Profile" 
                      required 
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">Staff ID</label>
                  <div className="relative">
                    <Shield className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      name="staff_id" 
                      value={formData.staff_id} 
                      onChange={handleInputChange} 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-10 pr-4 text-slate-800 text-sm font-semibold focus:outline-none focus:border-amber-500 focus:bg-white transition-all"
                      placeholder="e.g. Staff CSE" 
                      required 
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">Department</label>
                  <div className="relative">
                    <Briefcase className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      name="department" 
                      value={formData.department} 
                      onChange={handleInputChange} 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-10 pr-4 text-slate-800 text-sm font-semibold focus:outline-none focus:border-amber-500 focus:bg-white transition-all"
                      placeholder="e.g. CSE" 
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">Joined Year</label>
                  <div className="relative">
                    <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      name="joined_year" 
                      value={formData.joined_year} 
                      onChange={handleInputChange} 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-10 pr-4 text-slate-800 text-sm font-semibold focus:outline-none focus:border-amber-500 focus:bg-white transition-all"
                      placeholder="e.g. 2021" 
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">AICTE ID</label>
                  <div className="relative">
                    <Hash className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      name="aicte_id" 
                      value={formData.aicte_id} 
                      onChange={handleInputChange} 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-10 pr-4 text-slate-800 text-sm font-semibold focus:outline-none focus:border-amber-500 focus:bg-white transition-all"
                      placeholder="e.g. AICTE-CSE-01" 
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">Phone Number</label>
                  <div className="relative">
                    <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      name="phone_number" 
                      value={formData.phone_number} 
                      onChange={handleInputChange} 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-10 pr-4 text-slate-800 text-sm font-semibold focus:outline-none focus:border-amber-500 focus:bg-white transition-all"
                      placeholder="e.g. 9876543210" 
                    />
                  </div>
                </div>

              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button 
                  type="button" 
                  onClick={() => setIsEditing(false)} 
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 transition-all px-4 py-2 rounded-xl"
                >
                  <X className="w-4 h-4" /> Cancel
                </button>
                <button 
                  type="submit" 
                  className="flex items-center gap-1.5 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 transition-all px-4 py-2 rounded-xl shadow-sm"
                >
                  <Save className="w-4 h-4" /> Save Details
                </button>
              </div>
            </form>
          ) : (
            <div className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center text-slate-450 flex-shrink-0">
                  <User className="w-5 h-5 text-slate-500" />
                </div>
                <div>
                  <p className="text-[10px] font-extrabold text-slate-450 uppercase tracking-wider">Full Name</p>
                  <p className="text-sm font-bold text-slate-750">{profileUser.name || 'Not Specified'}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center text-slate-450 flex-shrink-0">
                  <Shield className="w-5 h-5 text-slate-500" />
                </div>
                <div>
                  <p className="text-[10px] font-extrabold text-slate-450 uppercase tracking-wider">Staff ID</p>
                  <p className="text-sm font-bold text-slate-750">{profileUser.staff_id || 'Not Specified'}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center text-slate-450 flex-shrink-0">
                  <Briefcase className="w-5 h-5 text-slate-500" />
                </div>
                <div>
                  <p className="text-[10px] font-extrabold text-slate-450 uppercase tracking-wider">Department</p>
                  <p className="text-sm font-bold text-slate-750">{profileUser.department || 'Not Specified'}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center text-slate-450 flex-shrink-0">
                  <Calendar className="w-5 h-5 text-slate-500" />
                </div>
                <div>
                  <p className="text-[10px] font-extrabold text-slate-450 uppercase tracking-wider">Joined Year</p>
                  <p className="text-sm font-bold text-slate-750">{profileUser.joined_year || 'Not Specified'}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center text-slate-450 flex-shrink-0">
                  <Hash className="w-5 h-5 text-slate-500" />
                </div>
                <div>
                  <p className="text-[10px] font-extrabold text-slate-450 uppercase tracking-wider">AICTE ID</p>
                  <p className="text-sm font-bold text-slate-750">{profileUser.aicte_id || 'Not Specified'}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center text-slate-450 flex-shrink-0">
                  <Phone className="w-5 h-5 text-slate-500" />
                </div>
                <div>
                  <p className="text-[10px] font-extrabold text-slate-450 uppercase tracking-wider">Phone Number</p>
                  <p className="text-sm font-bold text-slate-750">{profileUser.phone_number || 'Not Specified'}</p>
                </div>
              </div>

            </div>
          )}
        </div>

        {/* Action / Linked Section (Only visible for 'staff' role profiles) */}
        {profileUser.role === 'staff' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Linked Classes List */}
            <div className="card p-6 space-y-4">
              <div className="flex items-center gap-2 border-b pb-3 border-slate-100">
                <GraduationCap className="w-5 h-5 text-amber-500" />
                <h3 className="font-extrabold text-slate-800 text-sm">Linked Classes</h3>
              </div>
              <div className="space-y-2">
                {/* Tutor managed class (self) */}
                {profileUser.tutored_class && (
                  <div className="flex items-center justify-between p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                    <div>
                      <span className="text-xs font-black text-amber-900 block">Class Tutoring (Self)</span>
                      <span className="text-[11px] font-bold text-amber-750 mt-0.5">{profileUser.tutored_class}</span>
                    </div>
                    <Link 
                      to="/dashboard/staff/tutor-class" 
                      className="text-[10px] font-bold text-white bg-amber-500 hover:bg-amber-600 px-2.5 py-1 rounded-lg transition-all"
                    >
                      Manage Class
                    </Link>
                  </div>
                )}

                {/* Other invitation-linked classes */}
                {profileUser.linked_classes && profileUser.linked_classes.length > 0 ? (
                  profileUser.linked_classes.map((tutorId, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-slate-50/50 hover:bg-slate-50 border border-slate-100 rounded-xl transition-all">
                      <span className="text-xs font-bold text-slate-750">Class managed by @{tutorId}</span>
                      <Link 
                        to="/dashboard/staff/tutor-class" 
                        className="text-[10px] font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1"
                      >
                        Go to Dashboard <ExternalLink className="w-3 h-3" />
                      </Link>
                    </div>
                  ))
                ) : !profileUser.tutored_class ? (
                  <p className="text-xs text-slate-450 text-center py-6 font-medium">No classes linked yet.</p>
                ) : null}
              </div>
            </div>
            {/* Teaching Workload Overview list */}
            <div className="card p-6 space-y-4">
              <div className="flex items-center gap-2 border-b pb-3 border-slate-100">
                <CalendarDays className="w-5 h-5 text-indigo-500" />
                <h3 className="font-extrabold text-slate-800 text-sm">Teaching Workload Overview</h3>
              </div>
              
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl text-center">
                  <span className="text-[10px] font-black text-indigo-950 uppercase tracking-wider block">Approved Hours</span>
                  <span className="text-xl font-extrabold text-indigo-650 block mt-1">{workloadData.total_approved_hours}</span>
                  <span className="text-[9px] text-slate-400 font-semibold">hrs / week</span>
                </div>
                <div className="p-3 bg-amber-50/50 border border-amber-200/50 rounded-xl text-center">
                  <span className="text-[10px] font-black text-amber-950 uppercase tracking-wider block">Tentative Hours</span>
                  <span className="text-xl font-extrabold text-amber-600 block mt-1">{workloadData.total_tentative_hours}</span>
                  <span className="text-[9px] text-slate-400 font-semibold">awaiting approval</span>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1">Assigned Workload Items</p>
                {workloadData.approved_workload.length === 0 && workloadData.tentative_workload.length === 0 ? (
                  <p className="text-xs text-slate-450 text-center py-6 font-medium">No active teaching hours scheduled.</p>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {/* Display Approved items */}
                    {(() => {
                      const summary = {};
                      workloadData.approved_workload.forEach(item => {
                        const key = `${item.class_name}_${item.subject}`;
                        if (!summary[key]) summary[key] = { ...item, count: 0 };
                        summary[key].count++;
                      });
                      return Object.values(summary).map((item, idx) => (
                        <div key={`app_${idx}`} className="flex justify-between items-center p-2.5 bg-slate-50 border border-slate-100 rounded-xl">
                          <div>
                            <span className="text-xs font-bold text-slate-750 block">{item.subject}</span>
                            <span className="text-[9px] text-slate-455">{item.class_name}</span>
                          </div>
                          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-lg whitespace-nowrap">
                            {item.count} hrs/week
                          </span>
                        </div>
                      ));
                    })()}

                    {/* Display Tentative items */}
                    {(() => {
                      const summary = {};
                      workloadData.tentative_workload.forEach(item => {
                        const key = `${item.class_name}_${item.subject}`;
                        if (!summary[key]) summary[key] = { ...item, count: 0 };
                        summary[key].count++;
                      });
                      return Object.values(summary).map((item, idx) => (
                        <div key={`tent_${idx}`} className="flex justify-between items-center p-2.5 bg-amber-50 border border-amber-100/50 rounded-xl">
                          <div>
                            <span className="text-xs font-bold text-amber-955 block">{item.subject}</span>
                            <span className="text-[9px] text-amber-600">{item.class_name}</span>
                          </div>
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-100/30 border border-amber-200/55 px-2 py-0.5 rounded-lg whitespace-nowrap">
                            {item.count} hrs/week (Tentative)
                          </span>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

      </div>
    </SidebarLayout>
  );
}
