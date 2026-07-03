import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import SidebarLayout from '../components/SidebarLayout';
import { useToast, useAuth } from '../App';
import { 
  Clock, CheckCircle, XCircle, FileText, Check, X, Eye, 
  UserPlus, Edit3, GraduationCap, CalendarDays, Calendar, 
  User, Hash, Phone, Shield, ExternalLink, RefreshCw, AlertTriangle, Activity,
  BookOpen, Search, SlidersHorizontal, Zap, Download, UserCheck, Users, Trash2, Plus, BarChart3,
  Award, DollarSign, Building, TrendingUp, Bell, Settings, CloudSun, HelpCircle, MapPin, Sparkles, Briefcase, FileCheck, Gauge, ChevronRight, Bot
} from 'lucide-react';

const getCurrentPeriod = (timetable) => {
  if (!timetable || !timetable.headers || !timetable.rows) return null;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const currentDayName = days[new Date().getDay()];
  
  const dayRow = timetable.rows.find(r => r[0].toLowerCase() === currentDayName.toLowerCase());
  if (!dayRow) return null;
  
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  
  for (let i = 1; i < timetable.headers.length; i++) {
    const header = timetable.headers[i];
    const value = dayRow[i];
    
    const timeMatch = header.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const startH = parseInt(timeMatch[1]);
      const startM = parseInt(timeMatch[2]);
      const endH = parseInt(timeMatch[3]);
      const endM = parseInt(timeMatch[4]);
      const startMin = startH * 60 + startM;
      const endMin = endH * 60 + endM;
      
      if (currentMinutes >= startMin && currentMinutes < endMin) {
        let subject = value;
        let staff = 'N/A';
        const valMatch = value.match(/([^(]+)\(([^)]+)\)/);
        if (valMatch) {
          subject = valMatch[1].trim();
          staff = valMatch[2].trim();
        }
        return {
          hour: `Hour ${i}`,
          time: header,
          startMin,
          endMin,
          subject,
          staff,
          active: true
        };
      }
    }
  }
  return null;
};

function StatusBadge({ status }) {
  if (status === 'Approved') return <span className="badge badge-emerald"><CheckCircle className="w-3 h-3" /> Approved</span>;
  if (status === 'Rejected') return <span className="badge badge-rose"><XCircle className="w-3 h-3" /> Rejected</span>;
  if (status === 'Pending Principal') return <span className="badge badge-amber"><Clock className="w-3 h-3" /> Pending Principal</span>;
  return <span className="badge badge-violet"><Clock className="w-3 h-3" /> {status}</span>;
}

// Extract staff workload from all class timetables
const getStaffWorkload = (monitorData) => {
  if (!monitorData) return {};
  const workload = {};
  const skipCells = ['lunch', 'library', 'sports', 'placement', 'free', 'mini project', ''];

  monitorData.forEach(cls => {
    const tt = cls.timetable_data;
    if (!tt || !tt.headers || !tt.rows) return;

    tt.rows.forEach(row => {
      const dayName = row[0];
      for (let i = 1; i < row.length; i++) {
        const cell = (row[i] || '').trim();
        if (!cell || skipCells.includes(cell.toLowerCase())) continue;

        const isLab = cell.toLowerCase().startsWith('lab');
        let subject = cell;
        let staffName = null;
        const match = cell.match(/([^(]+)\(([^)]+)\)/);
        if (match) {
          subject = match[1].trim();
          staffName = match[2].trim();
        }

        if (!staffName && !isLab) continue;
        if (!staffName && isLab) staffName = subject;

        const key = staffName.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!workload[key]) {
          workload[key] = {
            name: staffName,
            subjects: new Set(),
            classes: new Set(),
            hoursPerWeek: 0,
            dayBreakdown: {}
          };
        }

        workload[key].subjects.add(subject);
        workload[key].classes.add(cls.class_name || cls.semester || 'Unknown');
        workload[key].hoursPerWeek += 1;
        workload[key].dayBreakdown[dayName] = (workload[key].dayBreakdown[dayName] || 0) + 1;
      }
    });
  });

  Object.values(workload).forEach(w => {
    w.subjects = [...w.subjects];
    w.classes = [...w.classes];
  });

  return workload;
};

// Extract staff workload mapping from pending timetable data
const getWorkloadFromPending = (selectedTimetable) => {
  const workload = {};
  if (!selectedTimetable || !selectedTimetable.pending_timetable_data) return workload;
  const td = selectedTimetable.pending_timetable_data;
  if (!td.rows || !td.headers) return workload;
  
  for (const row of td.rows) {
    const day = row[0];
    for (let i = 1; i < row.length; i++) {
      const cell = row[i];
      if (!cell) continue;
      const m = cell.match(/([^(]+)\(([^)]+)\)/);
      if (m) {
        const key = `${day}_Hour${i}`;
        workload[key] = {
          subject: m[1].trim(),
          staffDisplay: m[2].trim(),
          time: td.headers[i] || ''
        };
      }
    }
  }
  return workload;
};

export default function PrincipalDashboard() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  
  // Loading & Data States
  const [loading, setLoading] = useState(true);
  const [viewSection, setViewSection] = useState('overview'); // 'overview', 'timetable_approvals', 'marksheet_approvals', 'admin'
  const [submissions, setSubmissions] = useState([]);
  const [pendingTimetables, setPendingTimetables] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [classesList, setClassesList] = useState([]);
  const [monitorData, setMonitorData] = useState([]);

  // Selection / Modal States
  const [selectedSub, setSelectedSub] = useState(null);
  const [selectedTimetable, setSelectedTimetable] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);

  // Overview visual states
  const [activeChartTab, setActiveChartTab] = useState('attendance');
  const [overviewSearch, setOverviewSearch] = useState('');
  const [overviewClassFilter, setOverviewClassFilter] = useState('all');
  const [overviewAttendanceFilter, setOverviewAttendanceFilter] = useState('all'); // 'all', 'critical', 'perfect'
  const [selectedMetricCard, setSelectedMetricCard] = useState(null);
  const [hoveredChartIndex, setHoveredChartIndex] = useState(null);

  // Overview pagination state
  const [overviewPage, setOverviewPage] = useState(1);
  const studentsPerPage = 5;

  // Onboarding staff states
  const [editingStaff, setEditingStaff] = useState(null);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [staffForm, setStaffForm] = useState({
    name: '',
    joined_year: new Date().getFullYear(),
    aicte_id: '',
    phone_number: '',
    staff_id: '',
    username: '', // empty for creation
    department: 'CSE'
  });
  const [generatedCredentials, setGeneratedCredentials] = useState(null);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Fetch monitor data (all-college tutor classes)
      const monRes = await fetch('/api/monitor/tutor-classes');
      if (monRes.ok) {
        const monData = await monRes.json();
        setMonitorData(monData.tutors_data || []);
      }
      
      // 2. Fetch all staff list
      const staffRes = await fetch('/api/hod/staff');
      if (staffRes.ok) {
        const staffData = await staffRes.json();
        setStaffList(staffData.staff || []);
      }

      // 3. Fetch all classes list
      const classRes = await fetch('/api/hod/classes');
      if (classRes.ok) {
        const classData = await classRes.json();
        setClassesList(classData.classes || []);
      }

      // 4. Fetch pending timetables
      const ttRes = await fetch('/api/timetable/pending');
      if (ttRes.ok) {
        const ttData = await ttRes.json();
        setPendingTimetables(ttData.pending_timetables || []);
      }

      // 5. Fetch submissions (marksheets)
      const subRes = await fetch('/api/submissions');
      if (subRes.ok) {
        const subData = await subRes.json();
        setSubmissions(subData.submissions || []);
      }
    } catch (e) {
      console.error(e);
      showToast('Error loading principal dashboard data', 'danger');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // MARKSHEET REVIEW
  const openSubReview = (sub) => { setSelectedSub(sub); setRemarks(''); };
  const closeSubReview = () => setSelectedSub(null);
  const handleSubReview = async (status) => {
    if (!selectedSub) return;
    setReviewLoading(true);
    try {
      const res = await fetch(`/api/submissions/${selectedSub._id || selectedSub.id}/principal-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, remarks })
      });
      if (!res.ok) throw new Error('Failed to review submission');
      showToast(`Submission successfully ${status === 'Approved' ? 'approved' : 'rejected'}!`, 'success');
      closeSubReview();
      loadData();
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setReviewLoading(false);
    }
  };

  // TIMETABLE REVIEW
  const openTimetableReview = (tt) => { setSelectedTimetable(tt); setRemarks(''); };
  const closeTimetableReview = () => setSelectedTimetable(null);
  const handleTimetableReview = async (action) => {
    if (!selectedTimetable) return;
    setReviewLoading(true);
    try {
      const res = await fetch(`/api/principal/timetable-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutor_id: selectedTimetable.tutor_id, action, remarks })
      });
      if (!res.ok) throw new Error('Failed to review timetable');
      showToast(`Timetable successfully ${action === 'Approve' ? 'approved!' : 'rejected.'}`, 'success');
      closeTimetableReview();
      loadData();
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setReviewLoading(false);
    }
  };

  // Onboard / Link Tutor Confirmation handler
  const handleLinkTutor = async (semester, tutorUsername) => {
    try {
      // Find class mapping object
      const targetCls = classesList.find(c => c.semester === semester);
      const reqBody = {
        semester,
        staff_username: tutorUsername,
        className: targetCls ? targetCls.className : undefined
      };

      const res = await fetch('/api/hod/link-tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody)
      });
      if (!res.ok) throw new Error('Failed to assign class tutor');
      showToast('Class tutor assigned successfully!', 'success');
      loadData();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  // Staff onboarding creation/edit handler
  const handleStaffFormSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/hod/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(staffForm)
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to submit staff details');
      }
      const data = await res.json();
      showToast(data.message, 'success');
      if (data.credentials) {
        setGeneratedCredentials(data.credentials);
      } else {
        setShowStaffModal(false);
      }
      loadData();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  const openAddStaff = () => {
    setEditingStaff(null);
    setGeneratedCredentials(null);
    setStaffForm({
      name: '',
      joined_year: new Date().getFullYear(),
      aicte_id: '',
      phone_number: '',
      staff_id: '',
      username: '',
      department: 'CSE'
    });
    setShowStaffModal(true);
  };

  const openEditStaff = (staff) => {
    setEditingStaff(staff);
    setGeneratedCredentials(null);
    setStaffForm({
      name: staff.name || '',
      joined_year: staff.joined_year || new Date().getFullYear(),
      aicte_id: staff.aicte_id || '',
      phone_number: staff.phone_number || '',
      staff_id: staff.staff_id || '',
      username: staff.username || '',
      department: staff.department || 'CSE'
    });
    setShowStaffModal(true);
  };

  // Derive workload matrix college-wide
  const staffWorkload = useMemo(() => getStaffWorkload(monitorData), [monitorData]);

  // Derive students list across all college classes
  const allStudents = useMemo(() => {
    const list = [];
    monitorData.forEach(c => {
      if (c.students) {
        c.students.forEach(s => {
          list.push({
            ...s,
            className: c.class_name,
            tutor_id: c.tutor_id
          });
        });
      }
    });
    return list;
  }, [monitorData]);

  // Roster filtering logic
  const filteredOverviewStudents = useMemo(() => {
    return (allStudents || []).filter(s => {
      const matchSearch = (s.name || '').toLowerCase().includes(overviewSearch.toLowerCase()) || 
                          (s.roll_number || '').toLowerCase().includes(overviewSearch.toLowerCase());
      const matchClass = overviewClassFilter === 'all' || s.className === overviewClassFilter;
      
      let matchAtt = true;
      if (overviewAttendanceFilter === 'critical') matchAtt = s.attendance_pct < 70;
      else if (overviewAttendanceFilter === 'perfect') matchAtt = s.attendance_pct === 100;
      
      return matchSearch && matchClass && matchAtt;
    });
  }, [allStudents, overviewSearch, overviewClassFilter, overviewAttendanceFilter]);

  // Roster pagination logic
  const paginatedOverviewStudents = useMemo(() => {
    const startIdx = (overviewPage - 1) * studentsPerPage;
    return (filteredOverviewStudents || []).slice(startIdx, startIdx + studentsPerPage);
  }, [filteredOverviewStudents, overviewPage]);

  const totalOverviewPages = Math.ceil(filteredOverviewStudents.length / studentsPerPage) || 1;

  const avgAttendanceVal = useMemo(() => {
    if (!allStudents || allStudents.length === 0) return 92;
    const totalPct = allStudents.reduce((acc, s) => {
      const attVal = s.attendance_pct || s.attendance || parseInt(s.sem2_attendance) || parseInt(s.sem1_attendance) || 90;
      return acc + attVal;
    }, 0);
    return Math.round(totalPct / allStudents.length);
  }, [allStudents]);

  // Filter lists for pending submissions
  const pendingSubs = (submissions || []).filter(s => s.status === 'Pending Principal');
  const historySubs = (submissions || []).filter(s => s.status !== 'Pending HOD' && s.status !== 'Pending Principal');

  // Workload confirmation helper
  const confirmedWorkloadMap = useMemo(() => {
    if (!selectedTimetable) return {};
    return getWorkloadFromPending(selectedTimetable);
  }, [selectedTimetable]);

  const groupedWorkload = useMemo(() => {
    const groups = {};
    Object.entries(confirmedWorkloadMap).forEach(([key, val]) => {
      const dayName = key.split('_')[0];
      const hourName = key.split('_')[1];
      const staffName = val.staffDisplay;
      if (!groups[staffName]) groups[staffName] = [];
      groups[staffName].push({ day: dayName, hour: hourName, subject: val.subject });
    });
    return groups;
  }, [confirmedWorkloadMap]);

  const menuItems = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'timetable_approvals', label: 'Timetable Approvals', icon: CalendarDays },
    { id: 'marksheet_approvals', label: 'Marksheet Approvals', icon: FileText },
    { id: 'admin', label: 'Workload & Staff', icon: Settings }
  ];

  return (
    <SidebarLayout
      activeTab={viewSection}
      onTabChange={setViewSection}
      menuItems={menuItems}
      roleLabel="Principal"
    >
      <div className="space-y-6 animate-slide-up">
        {/* Page Header banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="section-title mb-1">Principal · Institution Dashboard</p>
            <h1 className="text-3xl font-black text-slate-805 tracking-tight">Principal Overview & Approvals Engine</h1>
            <p className="text-slate-500 text-sm mt-1">Institutional overview, class scheduling, staff mapping, and final academic approvals.</p>
          </div>
          <div className="flex items-center gap-3 self-start">
            <button onClick={() => navigate('/dashboard/ai')}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 999, cursor: 'pointer', background: 'linear-gradient(135deg, #007AFF, #5856D6)', border: 'none', fontSize: 13, fontWeight: 800, color: 'white', boxShadow: '0 6px 20px rgba(0,122,255,0.35)', transition: 'all 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 10px 28px rgba(0,122,255,0.45)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,122,255,0.35)'; }}>
              🧠 Campus Brain
            </button>
            <button onClick={loadData} className="btn-ghost flex items-center gap-1.5" title="Refresh">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </div>
        </div>
        {/* VIEW 1: OVERVIEW PANEL */}
        {viewSection === 'overview' && (
          <div className="space-y-8 animate-slide-up">            {/* ── ROW 1: CAMPUS ACADEMIC CARDS (Batches, Students, Average Attendance) ── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Card 1: Total Batches */}
              <div className="card p-6 flex flex-col justify-between">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Batches</span>
                    <h3 className="text-3xl font-black text-slate-805 mt-2">
                      {classesList?.length || 0}<span className="text-sm font-semibold text-slate-500"> classes</span>
                    </h3>
                  </div>
                  <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2.5 py-0.8 rounded-full flex items-center gap-1">
                    +2 active <span className="text-[8px] font-semibold text-emerald-500">this term</span>
                  </span>
                </div>
                
                {/* Mini Sparkline Bar Chart */}
                <div className="mt-6 flex items-end gap-1.5 h-12">
                  {[20, 25, 22, 28, 30, 28, 32, 35, 34, 38].map((h, i) => (
                    <div 
                      key={i} 
                      className={`w-full rounded-t-md transition-all ${i === 8 ? 'bg-indigo-600' : 'bg-indigo-100 hover:bg-indigo-250'}`}
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-[8px] font-bold text-slate-400 mt-2 uppercase">
                  <span>CSE</span>
                  <span>ECE</span>
                  <span>EEE</span>
                  <span>MECH</span>
                  <span>IT</span>
                </div>
              </div>

              {/* Card 2: Total Students */}
              <div className="card p-6 flex flex-col justify-between">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--label-2)' }}>Total Students</span>
                    <h3 className="text-3xl font-black mt-2" style={{ color: 'var(--label)' }}>
                      {allStudents?.length || 0} <span className="text-sm font-semibold text-slate-500">enrolled</span>
                    </h3>
                  </div>
                  <span className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-650 flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4" />
                  </span>
                </div>

                {/* Mini Sparkline Bar Chart */}
                <div className="mt-6 flex items-end gap-1.5 h-12">
                  {[45, 55, 60, 68, 70, 75, 82, 85, 90, 95].map((h, i) => (
                    <div 
                      key={i} 
                      className={`w-full rounded-t-md transition-all ${i === 9 ? 'bg-indigo-600' : 'bg-indigo-100 hover:bg-indigo-250'}`}
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-[8px] font-bold text-slate-400 mt-2 uppercase">
                  <span>2022</span>
                  <span>2023</span>
                  <span>2024</span>
                  <span>2025</span>
                  <span>2026</span>
                </div>
              </div>

              {/* Card 3: Average Attendance */}
              <div className="card p-6 flex flex-col justify-between">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--label-2)' }}>Campus Attendance</span>
                    <h3 className="text-3xl font-black mt-2" style={{ color: 'var(--label)' }}>
                      {avgAttendanceVal}%
                    </h3>
                  </div>
                  <span className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-655 flex items-center justify-center shrink-0">
                    <Clock className="w-4 h-4" />
                  </span>
                </div>

                <div className="mt-6 flex items-center justify-between gap-4">
                  {/* Legend */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[9px] font-black text-slate-600">
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                      <span>Present</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[9px] font-black text-slate-600">
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-250" />
                      <span>Absent</span>
                    </div>
                  </div>

                  {/* Circular Pie Chart */}
                  <div className="relative w-14 h-14 shrink-0">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="16" fill="none" stroke="#F1F5F9" strokeWidth="3.5" />
                      <circle 
                        cx="18" 
                        cy="18" 
                        r="16" 
                        fill="none" 
                        stroke="#007AFF" 
                        strokeWidth="3.5" 
                        strokeDasharray={`${avgAttendanceVal} 100`} 
                      />
                      <circle 
                        cx="18" 
                        cy="18" 
                        r="16" 
                        fill="none" 
                        stroke="rgba(0,122,255,0.20)" 
                        strokeWidth="3.5" 
                        strokeDasharray={`${100 - avgAttendanceVal} 100`} 
                        strokeDashoffset={`-${avgAttendanceVal}`} 
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center text-[9px] font-black text-slate-700">{avgAttendanceVal}%</div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── ROW 2: CALENDAR, TIMELINE, RATING, MAP GRID ── */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Card 4: Calendar Widget */}
              <div className="card p-6 lg:col-span-3 flex flex-col justify-between">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Calendar</h4>
                  <span className="w-5 h-5 rounded-full bg-slate-50 border border-slate-150 flex items-center justify-center font-bold text-[9px] text-slate-400 cursor-pointer hover:text-slate-800 transition-colors">
                    →
                  </span>
                </div>
                
                {/* Mon-Sun Header */}
                <div className="grid grid-cols-7 text-center text-[8px] font-bold text-slate-400 mb-2 uppercase">
                  <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                </div>

                {/* Calendar grid */}
                <div className="grid grid-cols-7 gap-1.5 text-center font-bold text-[9px]">
                  {Array.from({ length: 31 }, (_, i) => {
                    const day = i + 1;
                    const isSelectedBlue = [12, 18, 25].includes(day);
                    const isSelectedGreen = [8, 15, 22].includes(day);
                    const isToday = day === 29;
                    
                    let bgClass = "text-slate-600 hover:bg-slate-50 rounded-full";
                    if (isSelectedBlue) bgClass = "bg-indigo-600 text-white rounded-full shadow-sm";
                    else if (isSelectedGreen) bgClass = "bg-emerald-500 text-white rounded-full shadow-sm";
                    else if (isToday) bgClass = "bg-slate-800 text-white rounded-full shadow-sm";

                    return (
                      <div key={i} className={`w-6 h-6 flex items-center justify-center mx-auto transition-all cursor-pointer ${bgClass}`}>
                        {day}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Card 5 & 6: Rating & Live hour timeline Combined Sidebar */}
              <div className="lg:col-span-5 flex flex-col gap-6">
                
                {/* Rating Card */}
                <div className="card p-5 flex items-center justify-between">
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Satisfaction Index</span>
                    <p className="text-[9px] text-slate-450 mt-0.5">Based on tutor course feedbacks</p>
                    <h4 className="text-2xl font-black text-slate-805 mt-1.5 flex items-center gap-1">
                      4.8 <span className="text-amber-400 text-xl">★</span>
                    </h4>
                  </div>
                  <span className="w-6 h-6 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center font-extrabold text-slate-455 hover:text-slate-850 cursor-pointer">
                    ↗
                  </span>
                </div>

                {/* Live Hour Timeline Card */}
                <div className="card p-6 flex-grow flex flex-col justify-between">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Today's Class Hours</h4>
                    <span className="w-5 h-5 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center font-bold text-[9px] text-slate-400 hover:text-slate-700 cursor-pointer">
                      ↗
                    </span>
                  </div>

                  {/* Vertical Dashed Timeline */}
                  <div className="space-y-4 relative pl-5 flex-grow justify-center flex flex-col">
                    <div className="absolute left-1.5 top-2 bottom-2 w-0.5 border-l-2 border-dashed border-indigo-200" />
                    
                    {/* Hour 1 */}
                    <div className="relative">
                      <span className="absolute -left-5 top-1.5 w-2.5 h-2.5 rounded-full bg-indigo-650 ring-4 ring-indigo-50" />
                      <div className="flex justify-between items-start text-[10px]">
                        <div>
                          <p className="text-[8px] font-bold text-slate-400 uppercase">Hour 1 (9:00 - 9:50)</p>
                          <p className="font-extrabold text-slate-805 mt-0.5">Applied Sciences & Labs</p>
                        </div>
                        <span className="text-[9px] font-bold text-emerald-600 mt-0.5">Completed</span>
                      </div>
                    </div>

                    {/* Hour 2 */}
                    <div className="relative">
                      <span className="absolute -left-5 top-1.5 w-2.5 h-2.5 rounded-full bg-indigo-400 ring-4 ring-indigo-50" />
                      <div className="flex justify-between items-start text-[10px]">
                        <div>
                          <p className="text-[8px] font-bold text-slate-400 uppercase">Hour 2 (9:50 - 10:40)</p>
                          <p className="font-extrabold text-slate-805 mt-0.5">Database Systems Core</p>
                        </div>
                        <span className="text-[9px] font-bold text-emerald-600 mt-0.5">Completed</span>
                      </div>
                    </div>

                    {/* Hour 3 */}
                    <div className="relative">
                      <span className="absolute -left-5 top-1.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-50" />
                      <div className="flex justify-between items-start text-[10px]">
                        <div>
                          <p className="text-[8px] font-bold text-slate-400 uppercase">Hour 3 (10:50 - 11:40)</p>
                          <p className="font-extrabold text-slate-805 mt-0.5">AI & Machine Learning Lab</p>
                        </div>
                        <span className="text-[9px] font-bold text-indigo-650 mt-0.5">Active now</span>
                      </div>
                    </div>
                  </div>

                  {/* Period active badge */}
                  <div className="mt-4 bg-indigo-50 border border-indigo-100 p-2.5 rounded-xl flex items-center justify-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-650" />
                    <span className="text-[10px] font-black text-indigo-655">Currently: Lunch Recess Break Next</span>
                  </div>
                </div>
              </div>

              {/* Card 7: Map Route Tracker */}
              <div className="card p-6 lg:col-span-4 flex flex-col justify-between min-h-[300px]">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Campus Map Core</h4>
                  <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-lg">Active blocks</span>
                </div>
                
                {/* Map SVG drawing */}
                <div className="flex-grow bg-slate-50 rounded-2xl relative overflow-hidden border border-slate-150/60 min-h-[200px]">
                  <svg className="w-full h-full" viewBox="0 0 200 140" fill="none">
                    <path d="M 30,110 L 90,60 L 170,40" stroke="#4F46E5" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="3,3" opacity="0.3" />
                    <path d="M 30,110 L 90,60 L 170,40" stroke="#4F46E5" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M 90,60 L 150,110" stroke="#4F46E5" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="2,2" />
                    
                    {/* Node 1: Main Gate */}
                    <circle cx="30" cy="110" r="4.5" fill="#10B981" />
                    <circle cx="30" cy="110" r="8.5" stroke="#10B981" strokeWidth="1" strokeOpacity="0.3" />
                    <text x="30" y="123" fill="#475569" fontSize="7" fontWeight="black" textAnchor="middle">Gate</text>

                    {/* Node 2: Academic Block */}
                    <circle cx="90" cy="60" r="4.5" fill="#3B82F6" />
                    <circle cx="90" cy="60" r="8.5" stroke="#3B82F6" strokeWidth="1" strokeOpacity="0.3" />
                    <text x="90" y="48" fill="#475569" fontSize="7" fontWeight="black" textAnchor="middle">Blocks</text>

                    {/* Node 3: Hostel Blocks */}
                    <circle cx="170" cy="40" r="4.5" fill="#6366F1" />
                    <circle cx="170" cy="40" r="8.5" stroke="#6366F1" strokeWidth="1" strokeOpacity="0.3" />
                    <text x="170" y="28" fill="#475569" fontSize="7" fontWeight="black" textAnchor="middle">Hostels</text>

                    {/* Node 4: Library */}
                    <circle cx="150" cy="110" r="4" fill="#F59E0B" />
                    <circle cx="150" cy="110" r="7" stroke="#F59E0B" strokeWidth="1" strokeOpacity="0.3" />
                    <text x="150" y="123" fill="#475569" fontSize="7" fontWeight="black" textAnchor="middle">Library</text>

                    {/* Active pulsing cursor simulating AI activity on network */}
                    <g transform="translate(90, 60)">
                      <circle cx="0" cy="0" r="7.5" stroke="#3B82F6" strokeWidth="1.5" strokeOpacity="0.5" className="animate-ping" />
                    </g>
                  </svg>
                  
                  {/* Zoom controls overlay */}
                  <div className="absolute bottom-3 right-3 flex flex-col gap-1">
                    <button className="w-5 h-5 rounded-md bg-white border border-slate-205 text-slate-600 flex items-center justify-center font-bold text-xs shadow-sm hover:bg-slate-50">+</button>
                    <button className="w-5 h-5 rounded-md bg-white border border-slate-205 text-slate-600 flex items-center justify-center font-bold text-xs shadow-sm hover:bg-slate-50">-</button>
                  </div>
                </div>
              </div>
            </div>

            {/* ── ROW 3: DEPT SHUTTLES SCHEDULE & VEHICLE DETAILS ── */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Card 8: Schedule of Trips Table */}
              <div className="card p-6 lg:col-span-8 space-y-4">
                <div className="flex justify-between items-center border-b pb-3 border-slate-100">
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Live Class Tutor Status Monitor</h4>
                  <span className="w-5 h-5 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center font-bold text-[9px] text-slate-400 hover:text-slate-700 cursor-pointer">
                    ↗
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[10px] font-semibold text-slate-600">
                    <thead>
                      <tr className="border-b border-slate-150 text-[8px] text-slate-400 uppercase tracking-wider">
                        <th className="pb-2">Class semester</th>
                        <th className="pb-2">Active Subject</th>
                        <th className="pb-2">Tutor Account</th>
                        <th className="pb-2">Marked Attendance</th>
                        <th className="pb-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(monitorData || []).slice(0, 4).map((c, idx) => {
                        const currentPeriod = getCurrentPeriod(c.timetable_data);
                        const presents = c.present_today || 0;
                        const total = c.students?.length || 0;
                        const isMarked = c.present_today !== undefined;

                        return (
                          <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                            <td className="py-3 font-extrabold text-slate-805">{c.class_name || c.semester}</td>
                            <td className="py-3">
                              <span className="text-[8px] font-black bg-indigo-50 border border-indigo-100 text-indigo-650 px-2 py-0.5 rounded-full">
                                {currentPeriod ? currentPeriod.subject : 'No Class'}
                              </span>
                            </td>
                            <td className="py-3 font-extrabold text-slate-805">@{c.tutor_id}</td>
                            <td className="py-3 text-slate-450">{isMarked ? `${presents}/${total} present` : 'Pending'}</td>
                            <td className="py-3 text-right">
                              <span className={`px-2.5 py-0.8 rounded-full text-[8px] font-black border uppercase tracking-wider ${
                                isMarked ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-rose-50 text-rose-700 border-rose-100'
                              }`}>
                                {isMarked ? 'Marked' : 'Pending'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Card 9: AI Copilot System Specs */}
              <div className="card p-6 lg:col-span-4 flex flex-col justify-between min-h-[300px]">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">AI Copilot Node Health</h4>
                  <span className="w-5 h-5 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center font-bold text-[9px] text-slate-400 hover:text-slate-700 cursor-pointer">
                    ↗
                  </span>
                </div>

                {/* SVG Processor design */}
                <div className="my-2 bg-slate-50 border border-slate-150 rounded-2xl p-4 flex items-center justify-center relative overflow-hidden">
                  <svg className="w-40 h-20" viewBox="0 0 160 80" fill="none">
                    <rect x="35" y="10" width="90" height="60" rx="8" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2" />
                    <path d="M15,20 L35,20" stroke="#94A3B8" strokeWidth="1.5" />
                    <path d="M15,40 L35,40" stroke="#94A3B8" strokeWidth="1.5" />
                    <path d="M15,60 L35,60" stroke="#94A3B8" strokeWidth="1.5" />
                    <path d="M125,20 L145,20" stroke="#94A3B8" strokeWidth="1.5" />
                    <path d="M125,40 L145,40" stroke="#94A3B8" strokeWidth="1.5" />
                    <path d="M125,60 L145,60" stroke="#94A3B8" strokeWidth="1.5" />
                    
                    <rect x="55" y="20" width="50" height="40" rx="4" fill="#5B5FEF" opacity="0.1" stroke="#5B5FEF" strokeWidth="1.5" />
                    <rect x="65" y="28" width="30" height="24" rx="2" fill="#5B5FEF" />
                    <circle cx="80" cy="40" r="3" fill="#FFFFFF" className="animate-pulse" />
                    <circle cx="45" cy="20" r="2.5" fill="#10B981" />
                    <circle cx="45" cy="60" r="2.5" fill="#10B981" />
                  </svg>
                </div>

                {/* Specs list */}
                <div className="space-y-2 mt-2 text-[10px] font-semibold text-slate-650">
                  <div className="flex justify-between border-b pb-1.5 border-slate-50">
                    <span className="text-slate-400">AI Engine:</span>
                    <span className="font-extrabold text-slate-855">Gemini 1.5 Pro</span>
                  </div>
                  <div className="flex justify-between border-b pb-1.5 border-slate-50">
                    <span className="text-slate-400">Sync:</span>
                    <span className="font-extrabold text-indigo-650 bg-indigo-50 px-1.5 py-0.5 rounded">WhatsApp Live sync</span>
                  </div>
                  <div className="flex justify-between border-b pb-1.5 border-slate-50">
                    <span className="text-slate-400">Memory usage:</span>
                    <span className="font-extrabold text-slate-805">42MB / 512MB</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Node Status:</span>
                    <span className="font-extrabold text-emerald-600">Stable (99.8% Healthy)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── LIVE STUDENT MONITOR ROSTER TABLE ── */}
            <div className="card p-6 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 border-b pb-4 border-slate-100">
                <div>
                  <h3 className="font-extrabold text-slate-800 text-sm flex items-center gap-2">
                    <Bot className="w-4 h-4 text-indigo-500" />
                    College Live Student Monitoring Roster
                  </h3>
                  <p className="text-slate-450 text-[10px] font-semibold mt-0.5">Aggregated student database list with custom attendance filters</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input 
                      type="text" 
                      placeholder="Search name / roll..." 
                      value={overviewSearch}
                      onChange={e => { setOverviewSearch(e.target.value); setOverviewPage(1); }}
                      className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
                    />
                  </div>
                  <select 
                    value={overviewClassFilter}
                    onChange={e => { setOverviewClassFilter(e.target.value); setOverviewPage(1); }}
                    className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none font-semibold text-slate-600"
                  >
                    <option value="all">All Classes</option>
                    {monitorData?.map((c, i) => (
                      <option key={i} value={c.class_name}>{c.class_name}</option>
                    ))}
                  </select>
                  <select 
                    value={overviewAttendanceFilter}
                    onChange={e => { setOverviewAttendanceFilter(e.target.value); setOverviewPage(1); }}
                    className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none font-semibold text-slate-600"
                  >
                    <option value="all">All Attendance</option>
                    <option value="critical">Critical (&lt;70%)</option>
                    <option value="perfect">Perfect (100%)</option>
                  </select>
                </div>
              </div>

              {filteredOverviewStudents.length === 0 ? (
                <div className="py-8 text-center text-slate-400 italic text-xs font-semibold">No monitored students match selected search filters.</div>
              ) : (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs font-semibold text-slate-600">
                      <thead>
                        <tr className="border-b border-slate-200 text-[10px] text-slate-400 uppercase tracking-wider">
                          <th className="pb-2">Student Name</th>
                          <th className="pb-2">Roll Number</th>
                          <th className="pb-2">Class Group</th>
                          <th className="pb-2">Tutor Account</th>
                          <th className="pb-2 text-right">Attendance Pct</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedOverviewStudents?.map((s, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td>
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-150 text-indigo-650 flex items-center justify-center font-bold text-xs">
                                  {(s.name || '').charAt(0).toUpperCase() || 'S'}
                                </div>
                                <div>
                                  <p className="font-bold text-slate-805 text-xs">{s.name}</p>
                                  <p className="text-[9px] text-slate-400 font-semibold">{s.phone || 'No phone'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="font-mono text-xs font-semibold text-slate-600">{s.roll_number}</td>
                            <td className="text-xs font-bold text-slate-700">{s.className}</td>
                            <td className="text-xs text-slate-500 font-bold">@{s.tutor_id}</td>
                            <td className="text-right">
                              <span className={`font-black text-xs ${s.attendance_pct < 70 ? 'text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full' : 'text-slate-700'}`}>
                                {s.attendance_pct}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-[10px] text-slate-400 font-bold">
                    <span>Showing {(overviewPage - 1) * studentsPerPage + 1} to {Math.min(overviewPage * studentsPerPage, filteredOverviewStudents.length)} of {filteredOverviewStudents.length} entries</span>
                    <div className="flex gap-2">
                      <button 
                        disabled={overviewPage === 1}
                        onClick={() => setOverviewPage(p => p - 1)}
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg disabled:opacity-50 transition-colors"
                      >
                        Prev
                      </button>
                      <button 
                        disabled={overviewPage === totalOverviewPages}
                        onClick={() => setOverviewPage(p => p + 1)}
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg disabled:opacity-50 transition-colors"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 2: TIMETABLE APPROVALS PANEL */}
        {viewSection === 'timetable_approvals' && (
          <div className="space-y-6 animate-slide-up">
            <h2 className="font-extrabold text-slate-800 text-base flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-indigo-500" />
              Pending Institutional Timetables
              {pendingTimetables.length > 0 && <span className="badge badge-amber">{pendingTimetables.length}</span>}
            </h2>

            {pendingTimetables.length === 0 ? (
              <div className="card p-8 text-center text-slate-450 font-semibold bg-white/50 border-dashed">
                <CheckCircle className="w-8 h-8 text-emerald-500/30 mx-auto mb-2" />
                No pending timetables awaiting institutional confirmation. Clear desk!
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {pendingTimetables?.map((tt, i) => (
                  <div key={i} className="card p-5 flex flex-col justify-between hover-lift border-l-4 border-l-amber-500">
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-extrabold text-slate-800 text-sm">{tt.class_name}</p>
                          <p className="text-[10px] text-slate-400 font-bold">Tutor: <span className="text-slate-655">@{tt.tutor_id}</span></p>
                        </div>
                        <span className="badge badge-amber">Awaiting confirmation</span>
                      </div>
                      <p className="text-[10px] text-slate-455 mt-1 font-bold">Submitted: {new Date(tt.submitted_at).toLocaleString()}</p>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-100 mt-4">
                      <span className="text-[10px] font-bold text-slate-450">Tutor upload matrix</span>
                      <button onClick={() => openTimetableReview(tt)} className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5" /> Review
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW 3: MARKSHEETS APPROVALS PANEL */}
        {viewSection === 'marksheet_approvals' && (
          <div className="space-y-6 animate-slide-up">
            <h2 className="font-extrabold text-slate-800 text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-500" />
              Pending Academic Transcripts & Marksheets
              {pendingSubs.length > 0 && <span className="badge badge-amber">{pendingSubs.length}</span>}
            </h2>

            {pendingSubs.length === 0 ? (
              <div className="card p-8 text-center text-slate-455 font-semibold bg-white/50 border-dashed">
                <CheckCircle className="w-8 h-8 text-emerald-500/30 mx-auto mb-2" />
                No pending transcripts awaiting final signature. Clear desk!
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {pendingSubs?.map((sub, i) => (
                  <div key={i} className="card p-5 flex flex-col justify-between hover-lift border-l-4 border-l-amber-500">
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-extrabold text-slate-800">{sub.student_name}</p>
                          <p className="font-mono text-xs text-slate-400">{sub.roll_number}</p>
                        </div>
                        <span className="badge badge-violet">{sub.semester}</span>
                      </div>
                      <div className="text-xs text-slate-500 flex flex-col gap-1 font-bold">
                        <span>Dept: <strong className="text-slate-750">{sub.department}</strong> | Marks: <strong className="text-slate-750">{sub.total_marks || '—'}</strong> | GPA: <strong className="text-slate-750">{sub.gpa || '—'}</strong></span>
                        {sub.hod_remarks && <p className="text-[10px] text-amber-700 bg-amber-50 p-1.5 rounded-lg mt-1 border border-amber-100">HOD: {sub.hod_remarks}</p>}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 mt-4">
                      <span className="text-xs text-slate-455 font-bold">By: <span className="text-slate-600">@{sub.submitted_by}</span></span>
                      <button onClick={() => openSubReview(sub)} className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5" /> Review
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* MARKSHEET HISTORY */}
            {historySubs.length > 0 && (
              <section className="space-y-3 pt-6 border-t border-slate-200">
                <h3 className="font-extrabold text-slate-800 text-sm flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  Approval & Review History log
                </h3>
                <div className="card p-0 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs font-semibold text-slate-600">
                      <thead className="bg-slate-50 border-b border-slate-100 text-[10px] text-slate-400 uppercase tracking-wider">
                        <tr>
                          <th className="p-3">Student Name</th>
                          <th className="p-3">Roll Number</th>
                          <th className="p-3">Department</th>
                          <th className="p-3">Total Marks</th>
                          <th className="p-3">GPA</th>
                          <th className="p-3">Remarks</th>
                          <th className="p-3">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historySubs?.map((sub, i) => (
                          <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50">
                            <td className="p-3 font-extrabold text-slate-750">{sub.student_name}</td>
                            <td className="p-3 font-mono text-slate-455">{sub.roll_number}</td>
                            <td className="p-3">{sub.department}</td>
                            <td className="p-3 font-bold">{sub.total_marks}</td>
                            <td className="p-3 font-mono font-bold text-indigo-650">{sub.gpa}</td>
                            <td className="p-3 text-[10px] text-slate-450 font-bold truncate max-w-xs">{sub.principal_remarks || sub.hod_remarks || '—'}</td>
                            <td className="p-3"><StatusBadge status={sub.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        {/* VIEW 4: ADMIN / WORKLOAD PANEL */}
        {viewSection === 'admin' && (
          <div className="space-y-8 animate-slide-up">
            
            {/* WORKLOAD MATRIX */}
            <div className="card p-6 space-y-4">
              <div>
                <h3 className="font-extrabold text-slate-805 text-sm flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-indigo-500" />
                  College-Wide Staff Workload Distribution Matrix
                </h3>
                <p className="text-slate-450 text-[10px] font-semibold mt-0.5">Calculated active workload allocation from approved class schedules</p>
              </div>

              {Object.keys(staffWorkload || {}).length === 0 ? (
                <p className="text-xs text-slate-400 italic py-4 text-center">No workloads mapped. Upload timetables to attribute hourly schedules.</p>
              ) : (
                <div className="space-y-2.5">
                  {Object.values(staffWorkload)
                    .sort((a, b) => b.hoursPerWeek - a.hoursPerWeek)
                    ?.map((w, idx) => {
                      const maxHours = Math.max(...Object.values(staffWorkload).map(s => s.hoursPerWeek), 1);
                      const pct = Math.round((w.hoursPerWeek / maxHours) * 100);
                      const isHeavy = w.hoursPerWeek >= 20;
                      const isLight = w.hoursPerWeek <= 8;
                      return (
                        <div key={idx} className="group">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5">
                              <div className="w-5 h-5 rounded-md bg-amber-100 flex items-center justify-center font-black text-amber-700 text-[8px] flex-shrink-0">
                                {(w.name || '').charAt(0).toUpperCase() || 'W'}
                              </div>
                              <span className="text-[11px] font-bold text-slate-700">{w.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {isHeavy && <span className="text-[8px] font-extrabold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded">Heavy</span>}
                              {isLight && <span className="text-[8px] font-extrabold text-sky-500 bg-sky-50 px-1.5 py-0.5 rounded">Light</span>}
                              <span className="text-[10px] font-black text-slate-600">{w.hoursPerWeek} hrs/week</span>
                            </div>
                          </div>

                          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                            <div 
                              className={`h-full transition-all duration-500 rounded-full ${
                                isHeavy ? 'bg-rose-500' : isLight ? 'bg-sky-500' : 'bg-indigo-600'
                              }`} 
                              style={{ width: `${pct}%` }} 
                            />
                          </div>

                          <div className="mt-1 flex flex-wrap gap-1 items-center">
                            <span className="text-[9px] font-bold text-slate-400">Subjects:</span>
                            {w.subjects?.map((sub, si) => (
                              <span key={si} className="text-[8px] font-bold bg-slate-100 text-slate-505 px-1 py-0.5 rounded">{sub}</span>
                            ))}
                            <span className="text-[9px] font-bold text-slate-400 ml-2">Classes:</span>
                            {w.classes?.map((cl, ci) => (
                              <span key={ci} className="text-[8px] font-bold bg-indigo-50 text-indigo-505 px-1 py-0.5 rounded">{cl}</span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* CLASS TUTOR ASSIGNMENTS & STAFF ONBOARDING GRID */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              
              {/* Tutor Assignment */}
              <div className="card p-6 lg:col-span-5 space-y-4 h-fit">
                <div>
                  <h3 className="font-extrabold text-slate-800 text-sm flex items-center gap-1.5">
                    <GraduationCap className="w-4 h-4 text-indigo-500" />
                    Class Tutor Assignments
                  </h3>
                  <p className="text-slate-450 text-[10px] font-semibold mt-0.5">Link staff profiles to tutor specific class semesters</p>
                </div>

                <div className="space-y-3.5 max-h-[360px] overflow-y-auto pr-1">
                  {classesList?.map((cls, idx) => {
                    return (
                      <div key={idx} className="p-3 bg-slate-50/50 border border-slate-105 rounded-xl flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-black text-slate-800">{cls.semester}</p>
                          <p className="text-[9px] text-slate-400 font-semibold mt-0.5">{cls.className}</p>
                        </div>
                        <select 
                          value={cls.tutor_id || ''}
                          onChange={e => handleLinkTutor(cls.semester, e.target.value)}
                          className="px-2 py-1.5 text-[10px] bg-white border border-slate-200 rounded-lg focus:outline-none font-bold text-slate-655 max-w-[130px]"
                        >
                          <option value="">Unassigned</option>
                          {staffList?.map((staff, sidx) => (
                            <option key={sidx} value={staff.username}>{staff.name} (@{staff.username})</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Staff Profiles list */}
              <div className="card p-6 lg:col-span-7 space-y-4">
                <div className="flex justify-between items-center border-b pb-3 border-slate-50">
                  <div>
                    <h3 className="font-extrabold text-slate-805 text-sm flex items-center gap-1.5">
                      <UserCheck className="w-4 h-4 text-indigo-500" />
                      Academic Staff Directory
                    </h3>
                    <p className="text-slate-450 text-[10px] font-semibold mt-0.5">Manage details and credentials of institution staff</p>
                  </div>
                  <button onClick={openAddStaff} className="btn-primary text-[10px] py-1.5 px-3 flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> Add Staff
                  </button>
                </div>

                <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                  {staffList?.map((staff, idx) => {
                    return (
                      <div key={idx} className="p-3 bg-white border border-slate-150 rounded-xl flex items-center justify-between hover:border-slate-350 transition-colors">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center font-bold text-xs flex-shrink-0">
                            {(staff.name || '').charAt(0).toUpperCase() || 'S'}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-extrabold text-slate-805">{staff.name}</p>
                              <span className="text-[8px] font-bold bg-slate-100 px-1 py-0.2 rounded">{staff.department}</span>
                            </div>
                            <p className="text-[9px] text-slate-400 font-semibold">Username: @{staff.username} | ID: {staff.staff_id || 'N/A'}</p>
                          </div>
                        </div>
                        <button onClick={() => openEditStaff(staff)} className="p-1.5 bg-slate-50 text-slate-500 rounded-lg hover:bg-slate-100 hover:text-slate-800 transition-colors">
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MARKSHEET REVIEW MODAL */}
      {selectedSub && (
        <div className="modal-backdrop">
          <div className="modal-panel w-full max-w-2xl animate-scale-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h2 className="text-sm font-extrabold text-slate-800">Academic Transcript Review</h2>
                <p className="text-xs text-slate-400 font-semibold mt-0.5">Student: {selectedSub.student_name} ({selectedSub.roll_number})</p>
              </div>
              <button onClick={closeSubReview} className="text-slate-500 hover:text-slate-800 text-xl font-bold leading-none">&times;</button>
            </div>

            <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4 text-xs font-bold text-slate-600 bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div>
                  <span className="text-[9px] uppercase text-slate-400">Total Marks</span>
                  <p className="text-sm font-black text-indigo-650">{selectedSub.total_marks || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-[9px] uppercase text-slate-400">GPA</span>
                  <p className="text-sm font-black text-indigo-650">{selectedSub.gpa || 'N/A'}</p>
                </div>
              </div>

              <div>
                <p className="section-title mb-2">Subject Performance Grades</p>
                <div className="border border-slate-150 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs font-semibold text-slate-600">
                    <thead className="bg-slate-50/80 border-b border-slate-150 text-[10px] text-slate-400 uppercase">
                      <tr>
                        <th className="p-2.5">Subject</th>
                        <th className="p-2.5">Grade</th>
                        <th className="p-2.5">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedSub.marks || []).map((row, i) => (
                        <tr key={i} className="border-b border-slate-100 last:border-0">
                          <td className="p-2.5 font-bold text-slate-700">{row.subject}</td>
                          <td className="p-2.5 font-mono text-indigo-600">{row.grade}</td>
                          <td className="p-2.5 font-mono">{row.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedSub.hod_remarks && (
                <div className="p-3.5 bg-amber-50 border border-amber-100 rounded-xl text-xs">
                  <p className="text-[10px] font-black uppercase text-amber-800">HOD Verification Remarks</p>
                  <p className="text-amber-700 mt-1 font-semibold">{selectedSub.hod_remarks}</p>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-wide">Principal Remarks (Optional)</label>
                <textarea 
                  value={remarks}
                  onChange={e => setRemarks(e.target.value)}
                  placeholder="Enter approval confirmation details or rejection reasons..."
                  className="w-full text-xs font-bold text-slate-700 p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 h-20"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center bg-slate-50/50">
              <button 
                onClick={() => handleSubReview('Rejected')} 
                disabled={reviewLoading}
                className="btn-ghost-danger text-xs font-black uppercase py-2.5 px-4 flex items-center gap-1.5"
              >
                <X className="w-4 h-4" /> Reject & Return
              </button>
              <button 
                onClick={() => handleSubReview('Approved')} 
                disabled={reviewLoading}
                className="btn-primary text-xs font-black uppercase py-2.5 px-5 flex items-center gap-1.5 shadow-sm"
              >
                <Check className="w-4 h-4" /> Sign & Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TIMETABLE REVIEW MODAL */}
      {selectedTimetable && (
        <div className="modal-backdrop">
          <div className="modal-panel w-full max-w-4xl animate-scale-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h2 className="text-sm font-extrabold text-slate-800">Final Timetable Approval</h2>
                <p className="text-xs text-slate-450 mt-0.5 font-bold">Class: {selectedTimetable.class_name} · By: @{selectedTimetable.tutor_id}</p>
              </div>
              <button onClick={closeTimetableReview} className="text-slate-500 hover:text-slate-800 text-xl font-bold leading-none">&times;</button>
            </div>

            <div className="p-6 space-y-5 max-h-[65vh] overflow-y-auto">
              
              <div>
                <p className="section-title mb-2">Timetable Layout Grid</p>
                {selectedTimetable.pending_timetable_data ? (
                  <div className="card p-4 overflow-x-auto bg-slate-50/50">
                    <table className="w-full text-left border-collapse text-[10px] font-semibold text-slate-655">
                      <thead>
                        <tr className="border-b border-slate-200">
                          {selectedTimetable?.pending_timetable_data?.headers?.map((header, idx) => (
                            <th key={idx} className="pb-1.5 font-bold text-slate-500 p-2 whitespace-nowrap">{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedTimetable?.pending_timetable_data?.rows?.map((row, rIdx) => (
                          <tr key={rIdx} className="border-b border-slate-100 hover:bg-slate-50">
                            {row?.map((cell, cIdx) => (
                              <td key={cIdx} className={`p-2 ${cIdx === 0 ? 'font-bold text-amber-800' : 'text-slate-600'}`}>
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-slate-450 py-4 italic text-center">No parsed data available.</p>
                )}
              </div>

              {selectedTimetable.timetable_remarks && (
                <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl">
                  <p className="text-xs font-black uppercase text-amber-800 tracking-wider">HOD Remarks</p>
                  <p className="text-xs font-bold text-amber-700 mt-1">{selectedTimetable.timetable_remarks}</p>
                </div>
              )}

              <div>
                <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-wide mb-2">Confirm Projected Workloads</h4>
                <p className="text-[10px] text-slate-400 font-bold mb-3">
                  The following workload assignments will be automatically confirmed and linked to their staff accounts on approval:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-1">
                  {Object.entries(groupedWorkload).map(([staffName, periods], sIdx) => (
                    <div key={sIdx} className="p-3 bg-white border border-slate-150 rounded-xl shadow-sm">
                      <p className="text-xs font-black text-slate-800 flex items-center gap-1.5 border-b pb-1.5 mb-2">
                        <span className="w-5 h-5 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-[10px]">
                          {(staffName || '').charAt(0).toUpperCase() || 'S'}
                        </span>
                        {staffName}
                      </p>
                      <div className="space-y-1">
                        {periods?.map((p, pIdx) => (
                          <div key={pIdx} className="text-[10px] text-slate-500 flex justify-between items-center bg-slate-50 px-2 py-1 rounded">
                            <span>
                              <strong className="text-slate-700">{p.day}</strong> · {p.hour} ({p.subject})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-455">Review Remarks (Optional)</label>
                <textarea 
                  value={remarks}
                  onChange={e => setRemarks(e.target.value)}
                  placeholder="Enter remarks for HOD/Tutor..."
                  className="w-full text-xs font-bold text-slate-700 p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 h-16"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-between bg-slate-50/50">
              <button 
                onClick={() => handleTimetableReview('Reject')}
                disabled={reviewLoading}
                className="btn-ghost-danger text-xs font-black uppercase py-2 px-4 flex items-center gap-1.5"
              >
                <X className="w-4 h-4" /> Reject Timetable
              </button>
              <button 
                onClick={() => handleTimetableReview('Approve')}
                disabled={reviewLoading}
                className="btn-primary text-xs font-black uppercase py-2 px-5 flex items-center gap-1.5 shadow-sm"
              >
                <Check className="w-4 h-4" /> Confirm & Activate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STAFF ONBOARDING / EDIT MODAL */}
      {showStaffModal && (
        <div className="modal-backdrop">
          <div className="modal-panel w-full max-w-md animate-scale-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h2 className="text-sm font-extrabold text-slate-800">{editingStaff ? 'Edit Staff Profile' : 'Onboard New Staff'}</h2>
                <p className="text-xs text-slate-400 font-semibold mt-0.5">{editingStaff ? `Editing: @${editingStaff.username}` : 'Create login credentials and workload details'}</p>
              </div>
              <button onClick={() => setShowStaffModal(false)} className="text-slate-500 hover:text-slate-800 text-xl font-bold leading-none">&times;</button>
            </div>

            {generatedCredentials ? (
              <div className="p-6 space-y-4 text-center">
                <div className="w-12 h-12 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto text-xl">
                  <CheckCircle className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-black text-slate-800">Staff Account Created Successfully!</h3>
                <p className="text-xs text-slate-400">Share these auto-generated login credentials with the staff member:</p>
                <div className="bg-slate-50 p-4 border border-slate-150 rounded-xl text-xs font-bold text-left space-y-1.5">
                  <p>Username: <code className="text-indigo-650 bg-indigo-50 px-1.5 py-0.5 rounded font-mono font-black">{generatedCredentials.username}</code></p>
                  <p>Password: <code className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded font-mono font-black">{generatedCredentials.password}</code></p>
                </div>
                <button onClick={() => setShowStaffModal(false)} className="btn-primary w-full py-2 text-xs uppercase font-extrabold tracking-wider">
                  Done & Close
                </button>
              </div>
            ) : (
              <form onSubmit={handleStaffFormSubmit}>
                <div className="p-6 space-y-4 text-xs font-bold text-slate-655 max-h-[60vh] overflow-y-auto">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400">Staff Full Name</label>
                    <input 
                      type="text" 
                      required
                      value={staffForm.name}
                      onChange={e => setStaffForm({ ...staffForm, name: e.target.value })}
                      placeholder="e.g. Dr. Ramesh Kumar"
                      className="w-full text-xs font-semibold p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400">AICTE Registration ID</label>
                      <input 
                        type="text" 
                        required
                        value={staffForm.aicte_id}
                        onChange={e => setStaffForm({ ...staffForm, aicte_id: e.target.value })}
                        placeholder="e.g. 1-45239103"
                        className="w-full text-xs font-semibold p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400">Staff ID (Biometric)</label>
                      <input 
                        type="text" 
                        required
                        value={staffForm.staff_id}
                        onChange={e => setStaffForm({ ...staffForm, staff_id: e.target.value })}
                        placeholder="e.g. CSE-42"
                        className="w-full text-xs font-semibold p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400">Joined Year</label>
                      <input 
                        type="number" 
                        required
                        value={staffForm.joined_year}
                        onChange={e => setStaffForm({ ...staffForm, joined_year: parseInt(e.target.value) })}
                        placeholder="e.g. 2024"
                        className="w-full text-xs font-semibold p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400">Phone Number</label>
                      <input 
                        type="text" 
                        required
                        value={staffForm.phone_number}
                        onChange={e => setStaffForm({ ...staffForm, phone_number: e.target.value })}
                        placeholder="e.g. +91 9845201928"
                        className="w-full text-xs font-semibold p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400">Academic Department</label>
                    <select 
                      value={staffForm.department}
                      onChange={e => setStaffForm({ ...staffForm, department: e.target.value })}
                      className="w-full text-xs font-semibold p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                    >
                      <option value="CSE">Computer Science & Engineering (CSE)</option>
                      <option value="ECE">Electronics & Communication (ECE)</option>
                    </select>
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-100 flex justify-between bg-slate-50/50">
                  <button 
                    type="button" 
                    onClick={() => setShowStaffModal(false)}
                    className="btn-ghost text-xs font-black uppercase py-2 px-4"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="btn-primary text-xs font-black uppercase py-2 px-5 shadow-sm"
                  >
                    {editingStaff ? 'Save Changes' : 'Generate Account'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </SidebarLayout>
  );
}
