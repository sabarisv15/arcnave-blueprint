import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import SidebarLayout from '../components/SidebarLayout';
import { useToast, useAuth } from '../App';
import StudentEditorModal from '../components/StudentEditorModal';
import CsvExportModal from '../components/CsvExportModal';
import LowAttendanceModal from '../components/LowAttendanceModal';
import {
  Users, Upload, ImageIcon, Link2, Edit3, Trash2, Plus,
  Download, AlertTriangle, CalendarDays, UserCheck,
  Activity, Phone, Shield, Car, TrendingDown,
  RefreshCw, BookOpen, Zap, Search, SlidersHorizontal, UserPlus, Clock
} from 'lucide-react';

const FALLBACK_STUDENTS = [
  { _id: 'fb1', name: 'Aarav Sharma', roll_number: 'CS21001', phone: '9876543210', parent_name: 'Devendra Sharma', parent_phone: '9876543200', entry_type: 'Regular', attendance: 82, sem2_grade: 'A', sem2_result: 'Pass' },
  { _id: 'fb2', name: 'Priya Menon', roll_number: 'CS21002', phone: '9876500011', parent_name: 'Ravi Menon', parent_phone: '9876500010', entry_type: 'Lateral Entry', attendance: 63, sem2_grade: 'C', sem2_result: 'Pass' },
  { _id: 'fb3', name: 'Karthik Raj', roll_number: 'CS21003', phone: '9123456789', parent_name: 'Mohan Raj', parent_phone: '9123456780', entry_type: 'Regular', attendance: 91, sem2_grade: 'S', sem2_result: 'Pass' },
  { _id: 'fb4', name: 'Divya Lakshmi', roll_number: 'CS21004', phone: '9988776655', parent_name: 'Srinivasan K', parent_phone: '9988776600', entry_type: 'Regular', attendance: 57, sem2_grade: 'F', sem2_result: 'Fail' },
  { _id: 'fb5', name: 'Arun Kumar', roll_number: 'CS21005', phone: '9012345678', parent_name: 'Ganesh Kumar', parent_phone: '9012345600', entry_type: 'Lateral Entry', attendance: 88, sem2_grade: 'B', sem2_result: 'Pass' },
];

const DEFAULT_TIMETABLE = {
  headers: ["Day", "09:00 - 10:00", "10:00 - 11:00", "11:00 - 12:00", "12:00 - 13:00", "13:00 - 14:00", "14:00 - 15:00", "15:00 - 16:00"],
  rows: [
    ["Monday", "DBMS (Dr. Amit)", "PQT (Prof. Priya)", "Networks (Dr. Raj)", "Lunch", "OS (Prof. Sanjay)", "Lab (Staff CSE)", "Lab (Staff CSE)"],
    ["Tuesday", "PQT (Prof. Priya)", "DBMS (Dr. Amit)", "Networks (Dr. Raj)", "Lunch", "OS (Prof. Sanjay)", "Seminar (Prof. Sanjay)", "Library"],
    ["Wednesday", "Networks (Dr. Raj)", "PQT (Prof. Priya)", "DBMS (Dr. Amit)", "Lunch", "OS (Prof. Sanjay)", "Lab (Staff CSE)", "Lab (Staff CSE)"],
    ["Thursday", "OS (Prof. Sanjay)", "DBMS (Dr. Amit)", "PQT (Prof. Priya)", "Lunch", "Networks (Dr. Raj)", "Library", "Sports"],
    ["Friday", "DBMS (Dr. Amit)", "Networks (Dr. Raj)", "PQT (Prof. Priya)", "Lunch", "OS (Prof. Sanjay)", "Seminar (Prof. Sanjay)", "Placement"]
  ]
};

const FALLBACK_SETTINGS = {
  class_name: '2nd Year 4th Sem', student_group_link: '', parent_group_link: '',
  timetable_path: '', timetable_data: DEFAULT_TIMETABLE, present_today: 0, present_this_hour: 0,
};

// ─── Bento Stat Card ───────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, accent, onClick, animated }) {
  const accents = {
    violet: { border: '#7c3aed', glow: 'rgba(124,58,237,0.1)', icon: 'rgba(124,58,237,0.08)', iconColor: '#6d28d9' },
    cyan:   { border: '#06b6d4', glow: 'rgba(6,182,212,0.15)',  icon: 'rgba(6,182,212,0.08)',  iconColor: '#0891b2' },
    rose:   { border: '#f43f5e', glow: 'rgba(244,63,94,0.15)',  icon: 'rgba(244,63,94,0.08)',  iconColor: '#e11d48' },
    emerald:{ border: '#10b981', glow: 'rgba(16,185,129,0.15)', icon: 'rgba(16,185,129,0.08)', iconColor: '#059669' },
    amber:  { border: '#f59e0b', glow: 'rgba(245,158,11,0.15)', icon: 'rgba(245,158,11,0.08)', iconColor: '#d97706' },
  };
  const a = accents[accent] || accents.violet;

  return (
    <div
      className={`card p-5 flex items-center gap-4 cursor-${onClick ? 'pointer' : 'default'} hover-lift`}
      style={{ borderLeft: `4px solid ${a.border}` }}
      onClick={onClick}
    >
      <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: a.icon }}>
        <Icon className="w-6 h-6" style={{ color: a.iconColor }} />
      </div>
      <div>
        <p className="section-title mb-0.5" style={{ color: '#78350f' }}>{label}</p>
        <p className={`text-2xl font-black text-slate-800 ${animated ? 'animate-count-up' : ''}`}>{value}</p>
        {sub && <p className="text-xs font-semibold mt-0.5 text-slate-500">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Attendance Pill ────────────────────────────────────────────
function AttPill({ value }) {
  const v = value || 0;
  const color = v < 65 ? '#ef4444' : v < 75 ? '#f59e0b' : '#10b981';
  const bg    = v < 65 ? 'rgba(239,68,68,0.08)' : v < 75 ? 'rgba(245,158,11,0.08)' : 'rgba(16,185,129,0.08)';
  return (
    <div className="flex items-center gap-2">
      <span className="font-extrabold text-xs" style={{ color, background: bg, padding: '3px 10px', borderRadius: 999, border: `1px solid ${color}20` }}>
        {v}%
      </span>
      <div className="att-bar w-14 hidden sm:block">
        <div className="att-bar-fill" style={{ width: `${Math.min(v, 100)}%`, background: color }} />
      </div>
    </div>
  );
}

const getCurrentPeriod = (timetable) => {
  if (!timetable || !timetable.headers || !timetable.rows) return null;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const currentDayName = days[new Date().getDay()];
  
  // Find the row for today
  const dayRow = timetable.rows.find(r => r[0].toLowerCase() === currentDayName.toLowerCase());
  if (!dayRow) return { status: 'No class scheduled', details: 'Weekend/Holiday' };
  
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  
  // Loop through headers (skipping index 0 which is 'Day')
  for (let i = 1; i < timetable.headers.length; i++) {
    const header = timetable.headers[i]; // e.g. "09:00 - 10:00"
    const value = dayRow[i]; // e.g. "DBMS (Dr. Amit)"
    
    // Parse time range
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
  
  return { status: 'No ongoing class', details: 'Free Hour / Break' };
};

const gradeGPA = (grade) => {
  const g = String(grade || '').toUpperCase().trim();
  if (g === 'S') return 10;
  if (g === 'A') return 9;
  if (g === 'B') return 8;
  if (g === 'C') return 7;
  if (g === 'D') return 6;
  if (g === 'E') return 5;
  if (g === 'F') return 0;
  return 0;
};

const getStaffScheduleForToday = (timetable, username) => {
  if (!timetable || !timetable.headers || !timetable.rows || !username) return [];
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const currentDayName = days[new Date().getDay()];
  
  const dayRow = timetable.rows.find(r => r[0].toLowerCase() === currentDayName.toLowerCase());
  if (!dayRow) return [];
  
  const normUser = username.toLowerCase().replace(/[^a-z0-9]/g, '');
  const schedule = [];
  
  for (let i = 1; i < timetable.headers.length; i++) {
    const periodValue = dayRow[i];
    if (!periodValue || ['lunch', 'library', 'sports', 'placement', 'free'].includes(periodValue.toLowerCase())) continue;
    
    let subject = periodValue;
    let staff = 'N/A';
    const valMatch = periodValue.match(/([^(]+)\(([^)]+)\)/);
    if (valMatch) {
      subject = valMatch[1].trim();
      staff = valMatch[2].trim();
    }
    
    const normStaff = staff.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normUser === normStaff || normStaff.includes(normUser) || normUser.includes(normStaff)) {
      schedule.push({
        hour: `Hour ${i}`,
        time: timetable.headers[i],
        subject,
        staff
      });
    }
  }
  return schedule;
};

export default function TutorClass() {
  const { showToast } = useToast();
  const { user, accessToken } = useAuth();

  const [currentUser, setCurrentUser] = useState(user);
  const [selectedTutorId, setSelectedTutorId] = useState('');

  const [students, setStudents] = useState([]);
  const [settings, setSettings] = useState(FALLBACK_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [lowAttOpen, setLowAttOpen] = useState(false);

  const [editingLiveAtt, setEditingLiveAtt] = useState(false);
  const [livePresToday, setLivePresToday] = useState(0);
  const [livePresHour, setLivePresHour] = useState(0);
  const [uploadingTimetable, setUploadingTimetable] = useState(false);
  const [deptClasses, setDeptClasses] = useState([]);

  // Repointed to the real API (routes/classes.js). Unlike the old
  // /api/hod/classes prototype endpoint (never existed in the Node
  // backend, always 404'd), GET /api/v1/classes is real, requireAuth-gated
  // (needs the Authorization header below), and returns a bare array, not
  // a { classes: [...] } envelope. Its rows carry tutor_user_id (a real
  // users.id UUID) instead of the prototype's tutor_id (a username
  // string) — the dropdown below is updated to match. See .ai/TASK.md.
  useEffect(() => {
    if (user?.role === 'hod') {
      fetch('/api/v1/classes', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            setDeptClasses(data);
          }
        })
        .catch(err => console.error('Failed to fetch department classes:', err));
    }
  }, [user, accessToken]);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('roll_number');
  const [attendanceFilter, setAttendanceFilter] = useState('all');
  const [resultFilter, setResultFilter] = useState('all');

  // Timetable Period Marking States
  const [markedAbsentees, setMarkedAbsentees] = useState([]);
  const [attendanceMarked, setAttendanceMarked] = useState(false);
  const [activeMarker, setActiveMarker] = useState('');
  const [forceMarkingOpen, setForceMarkingOpen] = useState(false); // Demo Mode override

  useEffect(() => {
    setCurrentUser(user);
    if (user?.username && !selectedTutorId) {
      setSelectedTutorId(user.username);
    }
  }, [user]);

  const fetchUserProfile = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setCurrentUser(data.user);
      }
    } catch (e) {
      console.error('Error fetching user profile:', e);
    }
  };

  useEffect(() => {
    fetchUserProfile();
  }, []);

  const handleAcceptInvitation = async (tutorId) => {
    try {
      const res = await fetch('/api/tutor/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutor_id: tutorId })
      });
      if (res.ok) {
        showToast('Invitation accepted!', 'success');
        fetchUserProfile();
      } else throw new Error('Failed to accept');
    } catch (err) {
      if (isFallback) {
        setCurrentUser(prev => ({
          ...prev,
          linked_classes: [...(prev?.linked_classes || []), tutorId],
          pending_invitations: (prev?.pending_invitations || []).filter(inv => inv.tutor_id !== tutorId)
        }));
        showToast('Accepted (offline)', 'warning');
      } else {
        showToast(err.message, 'danger');
      }
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
        showToast('Invitation rejected', 'info');
        fetchUserProfile();
      } else throw new Error('Failed to reject');
    } catch (err) {
      if (isFallback) {
        setCurrentUser(prev => ({
          ...prev,
          pending_invitations: (prev?.pending_invitations || []).filter(inv => inv.tutor_id !== tutorId)
        }));
        showToast('Rejected (offline)', 'warning');
      } else {
        showToast(err.message, 'danger');
      }
    }
  };

  const fetchData = useCallback(async () => {
    if (!selectedTutorId) return;
    if (selectedTutorId.startsWith('unassigned_')) {
      const clsName = selectedTutorId.replace('unassigned_', '');
      setStudents([]);
      setSettings({
        class_name: clsName,
        timetable_data: null,
        timetable_status: 'No Tutor'
      });
      setLivePresToday(0);
      setLivePresHour(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [studRes, settingsRes] = await Promise.all([
        fetch(`/api/tutor-students?tutor_id=${selectedTutorId}`),
        fetch(`/api/tutor/class-settings?tutor_id=${selectedTutorId}`)
      ]);
      if (studRes.ok && settingsRes.ok) {
        const studData = await studRes.json();
        const settData = await settingsRes.json();
        const normalized = (studData.students || []).map(s => ({
          ...s,
          name: s.name || s.full_name || '',
          roll_number: s.roll_number || s.roll_no || '',
          gender: s.gender || 'Male',
          entry_type: s.entry_type || 'Regular',
          attendance: s.attendance || parseInt(s.sem2_attendance) || parseInt(s.sem1_attendance) || 0,
          sem2_grade: s.sem2_grade || s.sem1_grade || '',
          sem2_result: s.sem2_result || s.sem1_result || 'Pass'
        }));
        setStudents(normalized);
        setSettings(settData.settings || FALLBACK_SETTINGS);
        setLivePresToday(settData.settings?.present_today || 0);
        setLivePresHour(settData.settings?.present_this_hour || 0);
        setIsFallback(false);
      } else throw new Error('API error');
    } catch (err) {
      setStudents(FALLBACK_STUDENTS);
      setSettings(FALLBACK_SETTINGS);
      setIsFallback(true);
    } finally {
      setLoading(false);
    }
  }, [selectedTutorId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Stats
  const totalStudents = students.length;
  const presentToday = settings.present_today || 0;
  const presentThisHour = settings.present_this_hour || 0;
  const avgAttendance = totalStudents > 0
    ? Math.round(students.reduce((a, s) => a + (s.attendance || 0), 0) / totalStudents) : 0;
  const lowAttStudents = students.filter(s => (s.attendance || 0) < 75);

  const numBoys = students.filter(s => s.gender === 'Male' || String(s.gender).toLowerCase() === 'boy' || String(s.gender).toLowerCase() === 'male').length;
  const numGirls = students.filter(s => s.gender === 'Female' || String(s.gender).toLowerCase() === 'girl' || String(s.gender).toLowerCase() === 'female').length;
  const numDayScholars = students.filter(s => String(s.accommodation || '').toLowerCase().includes('day')).length;
  const numHostellers = students.filter(s => String(s.accommodation || '').toLowerCase().includes('hostel')).length;
  const numRegular = students.filter(s => String(s.entry_type || '').toLowerCase().includes('regular')).length;
  const numLateral = students.filter(s => String(s.entry_type || '').toLowerCase().includes('lateral')).length;

  const filteredStudents = students
    .filter(s => {
      const matchesSearch = s.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.roll_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.phone?.includes(searchQuery);
      
      if (!matchesSearch) return false;
      
      if (attendanceFilter === 'low' && (s.attendance || 0) >= 75) return false;
      if (attendanceFilter === 'critical' && (s.attendance || 0) >= 70) return false;
      if (attendanceFilter === 'high' && (s.attendance || 0) < 85) return false;
      
      const studentResult = s.sem2_result || s.sem1_result || 'Pass';
      if (resultFilter === 'pass' && studentResult.toLowerCase() !== 'pass') return false;
      if (resultFilter === 'fail' && studentResult.toLowerCase() === 'pass') return false;
      
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'top_attendance') return (b.attendance || 0) - (a.attendance || 0);
      if (sortBy === 'low_attendance') return (a.attendance || 0) - (b.attendance || 0);
      if (sortBy === 'top_result') {
        const gradeA = a.sem2_grade || a.sem1_grade || '';
        const gradeB = b.sem2_grade || b.sem1_grade || '';
        return gradeGPA(gradeB) - gradeGPA(gradeA);
      }
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
      return (a.roll_number || '').localeCompare(b.roll_number || '');
    });

  const handleExportCSV = () => {
    if (filteredStudents.length === 0) {
      showToast('No students to export', 'warning');
      return;
    }
    
    const headers = [
      "Roll Number",
      "Full Name",
      "Entry Type",
      "Phone Number",
      "Parent Name",
      "Parent Phone",
      "Attendance %",
      "Driving License",
      "Bike Number"
    ];
    
    const rows = filteredStudents.map(s => {
      const roll = s.roll_number || s.roll_no || '';
      const name = s.name || s.full_name || '';
      const entry = s.entry_type || 'Regular';
      const phone = s.phone || '';
      const pName = s.parent_name || '';
      const pPhone = s.parent_phone || '';
      const att = s.attendance || parseInt(s.sem2_attendance) || parseInt(s.sem1_attendance) || 0;
      const dl = s.driving_license || s.license_number || '';
      const bike = s.vehicle_number || s.bike_number || '';
      
      return [
        `"${roll.replace(/"/g, '""')}"`,
        `"${name.replace(/"/g, '""')}"`,
        `"${entry.replace(/"/g, '""')}"`,
        `"${phone.replace(/"/g, '""')}"`,
        `"${pName.replace(/"/g, '""')}"`,
        `"${pPhone.replace(/"/g, '""')}"`,
        `"${att}%"`,
        `"${dl.replace(/"/g, '""')}"`,
        `"${bike.replace(/"/g, '""')}"`
      ];
    });

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + 
      [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    
    const safeClassName = (settings.class_name || 'Class').replace(/\s+/g, '_');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${safeClassName}_students_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSaveStudent = () => { setEditorOpen(false); fetchData(); };

  const handleDeleteStudent = async (student) => {
    if (!window.confirm(`Remove ${student.name} from the roster?`)) return;
    if (isFallback) {
      setStudents(prev => prev.filter(s => s._id !== student._id));
      showToast('Deleted (offline)', 'warning');
      return;
    }
    try {
      const res = await fetch(`/api/tutor-students/${student._id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      showToast('Student removed', 'success');
      fetchData();
    } catch (err) { showToast(err.message, 'danger'); }
  };

  const handleSaveLiveAttendance = async (overrideCount) => {
    const updatedHour = typeof overrideCount === 'number' ? overrideCount : livePresHour;
    if (isFallback) {
      setSettings(prev => ({ ...prev, present_today: livePresToday, present_this_hour: updatedHour }));
      showToast('Saved (offline)', 'warning');
      setEditingLiveAtt(false);
      return;
    }
    try {
      const res = await fetch('/api/tutor/live-attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tutor_id: selectedTutorId,
          present_today: livePresToday, 
          present_this_hour: updatedHour 
        })
      });
      if (!res.ok) throw new Error('Save failed');
      showToast('Attendance updated!', 'success');
      setEditingLiveAtt(false);
      fetchData();
    } catch (err) { showToast(err.message, 'danger'); }
  };

  const handleTimetableUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingTimetable(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/tutor/upload-timetable', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      setSettings(data.settings);
      showToast('Timetable uploaded!', 'success');
    } catch (err) { showToast(err.message, 'danger'); }
    finally { setUploadingTimetable(false); }
  };

  // Toggle absentee checkbox
  const handleToggleAbsentee = (rollNo) => {
    if (markedAbsentees.includes(rollNo)) {
      setMarkedAbsentees(prev => prev.filter(r => r !== rollNo));
    } else {
      setMarkedAbsentees(prev => [...prev, rollNo]);
    }
  };

  // Submit active period marking
  const handleSubmitPeriodAttendance = () => {
    const presentCount = totalStudents - markedAbsentees.length;
    setLivePresHour(presentCount);
    handleSaveLiveAttendance(presentCount);
    setAttendanceMarked(true);
    showToast(`Attendance marked. Absentees: ${markedAbsentees.length}, Present: ${presentCount}`, 'success');
  };

  // Assign Alternate Staff
  const handleAssignAlternateStaff = () => {
    setActiveMarker(user?.username || 'Substitute Staff');
    showToast(`Alternate staff (${user?.username}) assigned to mark attendance.`, 'info');
  };

  // Check timing window
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const periodInfo = getCurrentPeriod(settings.timetable_data);
  
  // Open if inside period AND within first 15 mins of start (or if demo override is checked)
  const isMarkingWindowOpen = forceMarkingOpen || (
    periodInfo && periodInfo.active && 
    (currentMinutes >= periodInfo.startMin && currentMinutes < periodInfo.startMin + 15)
  );

  const minsRemaining = periodInfo && periodInfo.active 
    ? Math.max(0, (periodInfo.startMin + 15) - currentMinutes) 
    : 0;

  const currentScheduledStaff = periodInfo?.staff || 'N/A';
  const markerName = activeMarker || currentScheduledStaff;

  const isScheduledStaff = () => {
    if (!user?.username || !currentScheduledStaff || currentScheduledStaff === 'N/A') return false;
    const normUser = user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normStaff = currentScheduledStaff.toLowerCase().replace(/[^a-z0-9]/g, '');
    return normUser === normStaff || normStaff.includes(normUser) || normUser.includes(normStaff);
  };

  const isUserAllowedToMark = forceMarkingOpen || isScheduledStaff() || (
    activeMarker && user?.username && 
    activeMarker.toLowerCase().replace(/[^a-z0-9]/g, '') === user.username.toLowerCase().replace(/[^a-z0-9]/g, '')
  );

  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: 'transparent' }}>
        <Header />
        <div className="flex items-center justify-center h-72">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
            <span className="text-slate-500 text-sm font-semibold">Loading class dashboard...</span>
          </div>
        </div>
      </div>
    );
  }

  const menuItems = [
    { id: 'class', label: 'My Class', icon: Users }
  ];

  return (
    <SidebarLayout
      activeTab="class"
      onTabChange={() => {}}
      menuItems={menuItems}
      roleLabel={`Tutor · ${user?.department || 'Dept'}`}
    >
      {isFallback && (
        <div className="text-center text-xs font-bold py-1.5 mb-4 rounded-xl"
          style={{ background: 'rgba(91,95,239,0.1)', border: '1px solid rgba(91,95,239,0.2)', color: '#4F46E5' }}>
          ⚡ Demo Mode — Local JSON Database Active
        </div>
      )}

      <div className="space-y-6">

        {/* Pending invitations notifications */}
        {currentUser?.pending_invitations && currentUser.pending_invitations.length > 0 && (
          <div className="space-y-3 animate-slide-up mb-6">
            {currentUser.pending_invitations.map((inv, idx) => (
              <div key={idx} className="flex items-center justify-between p-4 bg-amber-50 border border-amber-250 rounded-2xl shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-amber-700 flex-shrink-0">
                    <CalendarDays className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-sm text-slate-800">Class Timetable Linking Invitation</h4>
                    <p className="text-xs text-slate-500 font-medium">
                      Tutor <strong className="text-amber-800">{inv.tutor_id}</strong> invited you to link with class <strong className="text-amber-800">{inv.class_name}</strong> to mark live attendance.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleAcceptInvitation(inv.tutor_id)}
                    className="px-3 py-1.5 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-all"
                  >
                    Accept
                  </button>
                  <button 
                    onClick={() => handleRejectInvitation(inv.tutor_id)}
                    className="px-3 py-1.5 text-xs font-bold bg-slate-250 hover:bg-slate-300 text-slate-700 rounded-lg transition-all"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Page Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-slide-up">
          <div>
            <p className="section-title mb-1">
              <Link to="/profile" className="hover:text-amber-500 transition-colors font-bold">{user?.username}</Link> · {user?.role === 'hod' ? 'My Schedule' : 'Class Dashboard'}
            </p>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-black text-slate-800 tracking-tight">
                {settings.class_name || '2nd Year 4th Sem'}
              </h1>
              {settings.timetable_status && (
                <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-lg border ${
                  settings.timetable_status === 'Approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50' :
                  settings.timetable_status === 'Rejected' ? 'bg-rose-50 text-rose-700 border-rose-250/50' :
                  'bg-amber-50 text-amber-700 border-amber-250/50'
                }`}>
                  Timetable: {settings.timetable_status}
                </span>
              )}
              {(user?.role === 'hod' || (currentUser?.linked_classes && currentUser.linked_classes.length > 0)) && (
                <div className="relative">
                  <select 
                    value={selectedTutorId} 
                    onChange={e => setSelectedTutorId(e.target.value)}
                    className="text-xs font-bold border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-750 cursor-pointer hover:border-amber-500 focus:outline-none transition-all"
                  >
                    {user?.role === 'hod' ? (
                      <option value={user?.username}>My Teaching Schedule</option>
                    ) : (
                      <option value={user?.username}>My Class</option>
                    )}
                    
                    {user?.role === 'hod' && deptClasses.length > 0 && (
                      <optgroup label="Department Classes">
                        {deptClasses.map((c, idx) => (
                          <option key={idx} value={c.tutor_user_id || `unassigned_${c.class_name}`}>
                            {c.class_name} {c.tutor_user_id ? `(@${c.tutor_user_id})` : '(No Tutor Linked)'}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    
                    {currentUser?.linked_classes && currentUser.linked_classes.length > 0 && (
                      <optgroup label="Linked Classes">
                        {currentUser.linked_classes.map((tId, idx) => (
                          <option key={idx} value={tId}>Linked Class ({tId})</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {/* Demo Override Button */}
            <button 
              onClick={() => setForceMarkingOpen(!forceMarkingOpen)} 
              className={`text-xs py-1.5 px-3 rounded-lg border font-bold flex items-center gap-1.5 transition-all ${
                forceMarkingOpen ? 'bg-amber-100 border-amber-200 text-amber-700' : 'bg-white border-slate-200 text-slate-500'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              {forceMarkingOpen ? 'Disable Marking Override' : 'Force Open Marking slot'}
            </button>
            {user?.role !== 'hod' && (
              <button onClick={() => setCsvOpen(true)} className="btn-outline text-xs py-1.5 px-3 flex items-center gap-1.5" id="export-csv-btn">
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            )}
            {user?.role !== 'hod' && selectedTutorId === user?.username && (
              <button onClick={() => { setSelectedStudent(null); setEditorOpen(true); }} className="btn-primary" id="add-student-btn">
                <Plus className="w-4 h-4" /> Add Student
              </button>
            )}
            <button onClick={fetchData} className="btn-ghost" title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Bento Stats Grid ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {user?.role !== 'hod' && (
            <div className="animate-slide-up animate-delay-100">
              <StatCard 
                icon={Users} 
                label="Total Students" 
                value={totalStudents} 
                accent="violet" 
                sub={
                  <div className="flex flex-col gap-0.5 mt-1 text-[10px] text-slate-500 font-bold leading-snug">
                    <div className="flex gap-2">
                      <span>Boys: {numBoys}</span>
                      <span>·</span>
                      <span>Girls: {numGirls}</span>
                    </div>
                    <div className="flex gap-2">
                      <span>Day: {numDayScholars}</span>
                      <span>·</span>
                      <span>Hostel: {numHostellers}</span>
                    </div>
                    <div className="flex gap-2">
                      <span>Reg: {numRegular}</span>
                      <span>·</span>
                      <span>Lat: {numLateral}</span>
                    </div>
                  </div>
                } 
                animated 
              />
            </div>
          )}
          <div className={`animate-slide-up animate-delay-150 ${user?.role === 'hod' ? 'sm:col-span-2' : ''}`}>
            {(() => {
              const currentPeriodInfo = getCurrentPeriod(settings.timetable_data);
              return (
                <StatCard
                  icon={Activity}
                  label={currentPeriodInfo?.subject ? `${currentPeriodInfo.hour} (${currentPeriodInfo.time})` : 'Current Hour'}
                  value={currentPeriodInfo?.subject || 'Free / Break'}
                  accent="cyan"
                  sub={currentPeriodInfo?.staff ? `Staff: ${currentPeriodInfo.staff}` : (currentPeriodInfo?.details || 'No ongoing class')}
                />
              );
            })()}
          </div>
          <div className={`animate-slide-up animate-delay-200 ${user?.role === 'hod' ? 'sm:col-span-2' : ''}`}>
            <StatCard
              icon={UserCheck}
              label="Live Attendance"
              value={`${presentThisHour} / ${totalStudents}`}
              accent="amber"
              sub="Present this hour"
            />
          </div>
          {user?.role !== 'hod' && (
            <div className="animate-slide-up animate-delay-250">
              <StatCard
                icon={avgAttendance < 75 ? AlertTriangle : TrendingDown}
                label="Avg Attendance" value={`${avgAttendance}%`}
                accent={avgAttendance < 75 ? 'rose' : 'emerald'}
                sub={lowAttStudents.length > 0 ? `${lowAttStudents.length} below 75% — click to view` : 'All above 75%'}
                onClick={lowAttStudents.length > 0 ? () => setLowAttOpen(true) : undefined}
              />
            </div>
          )}
        </div>

        {/* ── Timetable Schedule & Active Marking Panel ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Timetable grid */}
          <div className="card p-5 lg:col-span-2 overflow-hidden flex flex-col animate-slide-up animate-delay-100">
            <div className="flex items-center justify-between mb-4 border-b pb-3 border-slate-100">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-amber-500" />
                <span className="font-bold text-slate-800 text-sm">Class Timetable</span>
                {settings.timetable_status && settings.timetable_status !== 'Approved' && (
                  <span className={`badge ${
                    settings.timetable_status === 'Pending HOD' ? 'badge-violet' :
                    settings.timetable_status === 'Pending Principal' ? 'badge-amber' :
                    settings.timetable_status === 'Rejected' ? 'badge-rose' : 'badge-slate'
                  }`} style={{ fontSize: '0.65rem', padding: '0.1rem 0.5rem' }}>
                    {settings.timetable_status}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <a 
                  href="/uploads/timetable_template.csv" 
                  download="timetable_template.csv"
                  className="p-1.5 rounded-lg text-slate-500 hover:text-amber-500 hover:bg-slate-100 transition-all flex items-center justify-center" 
                  title="Download Timetable CSV Template"
                >
                  <Download className="w-4 h-4" />
                </a>
                {selectedTutorId === user?.username && (
                  <label className="p-1.5 rounded-lg text-slate-500 hover:text-amber-500 hover:bg-slate-100 transition-all cursor-pointer flex items-center justify-center" title="Upload Timetable CSV">
                    <Edit3 className="w-4 h-4" />
                    <input type="file" accept=".csv" onChange={handleTimetableUpload} className="hidden" disabled={uploadingTimetable} />
                  </label>
                )}
              </div>
            </div>
            {settings.timetable_status === 'Rejected' && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-800 text-xs font-bold rounded-xl flex flex-col gap-1">
                <span>⚠️ Timetable was Rejected:</span>
                <span className="text-[10px] text-red-650 font-semibold">{settings.timetable_remarks || 'No remarks provided.'}</span>
              </div>
            )}
            {settings.timetable_status && ['Pending HOD', 'Pending Principal'].includes(settings.timetable_status) && (
              <div className="mb-3 p-3 bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-semibold rounded-xl">
                ℹ️ A new timetable has been uploaded and is pending approval. The schedule below is the currently active timetable.
              </div>
            )}
            {settings.timetable_data ? (
              <div className="overflow-x-auto flex-1 timetable-container">
                <table className="w-full text-left border-collapse text-[11px] font-semibold text-slate-600">
                  <thead>
                    <tr className="border-b border-slate-100">
                      {settings.timetable_data.headers.map((header, idx) => (
                        <th key={idx} className="pb-2 font-bold text-slate-500 p-2 whitespace-nowrap">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {settings.timetable_data.rows.map((row, rIdx) => {
                      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                      const currentDayName = days[new Date().getDay()];
                      const isTodayRow = currentDayName.toLowerCase() === row[0].toLowerCase();
                      const currentPeriodInfo = getCurrentPeriod(settings.timetable_data);

                      return (
                        <tr key={rIdx} className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${isTodayRow ? 'bg-amber-50/40' : ''}`}>
                          {row.map((cell, cIdx) => {
                            let isActiveCell = false;
                            if (isTodayRow && cIdx > 0 && currentPeriodInfo && currentPeriodInfo.active) {
                              const colHeader = settings.timetable_data.headers[cIdx];
                              if (colHeader === currentPeriodInfo.time) {
                                isActiveCell = true;
                              }
                            }
                            return (
                              <td key={cIdx} className={`p-2.5 transition-all ${cIdx === 0 ? 'font-bold text-amber-800' : 'text-slate-500'} ${isActiveCell ? 'bg-amber-100/60 text-amber-700 font-extrabold border border-amber-300 rounded shadow-[0_2px_8px_rgba(245,158,11,0.15)]' : ''}`}>
                                {cell}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              selectedTutorId === user?.username ? (
                <div className="flex flex-col items-center justify-center gap-4 py-8 border border-dashed border-slate-200 rounded-xl flex-1 bg-white/50">
                  <ImageIcon className="w-8 h-8 text-slate-400" />
                  <div className="text-center">
                    <span className="text-sm font-semibold text-slate-655 block">
                      {uploadingTimetable ? 'Uploading...' : 'No Timetable Uploaded'}
                    </span>
                    <span className="text-xs text-slate-400 mt-1 block">Format matches standard CSV layout</span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <a 
                      href="/uploads/timetable_template.csv" 
                      download="timetable_template.csv" 
                      className="btn-outline text-[11px] py-1 px-2.5 flex items-center gap-1.5 font-bold"
                    >
                      <Download className="w-3.5 h-3.5" /> Download CSV Template
                    </a>
                    <label className="btn-primary text-[11px] py-1 px-2.5 flex items-center gap-1.5 font-bold cursor-pointer">
                      <Edit3 className="w-3.5 h-3.5" /> Select File
                      <input type="file" accept=".csv" onChange={handleTimetableUpload} className="hidden" disabled={uploadingTimetable} />
                    </label>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400 flex-1">
                  <Clock className="w-8 h-8 text-slate-300" />
                  <p className="text-xs font-semibold mt-2">No timetable uploaded for this class.</p>
                </div>
              )
            )}
          </div>

          {/* Right Column containing both Schedule and Attendance Marker */}
          <div className="lg:col-span-1 flex flex-col gap-6">

            {/* My Schedule Today */}
            <div className="card p-5 flex flex-col animate-slide-up animate-delay-150">
              <div className="flex items-center gap-2 mb-4 border-b pb-3 border-slate-100">
                <Clock className="w-4.5 h-4.5 text-amber-500" />
                <span className="font-bold text-slate-800 text-sm">My Schedule Today</span>
              </div>
              {(() => {
                const myTodayHours = getStaffScheduleForToday(settings.timetable_data, user?.username);
                if (myTodayHours.length === 0) {
                  return (
                    <div className="text-center py-4">
                      <p className="text-xs text-slate-400 font-medium">No hours scheduled for you today.</p>
                    </div>
                  );
                }
                return (
                  <div className="space-y-2">
                    {myTodayHours.map((slot, idx) => {
                      const isCurrentHour = periodInfo && periodInfo.active && periodInfo.time === slot.time;
                      return (
                        <div 
                          key={idx} 
                          className={`p-3 rounded-xl border transition-all ${
                            isCurrentHour 
                              ? 'bg-amber-100/60 border-amber-300 shadow-[0_2px_8px_rgba(245,158,11,0.15)]' 
                              : 'bg-slate-50/50 border-slate-100 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`text-xs font-black ${isCurrentHour ? 'text-amber-800' : 'text-slate-700'}`}>
                              {slot.hour}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">{slot.time}</span>
                          </div>
                          <p className="text-xs font-bold text-slate-600 mt-1">{slot.subject}</p>
                          {isCurrentHour && (
                            <span className="inline-block text-[9px] font-extrabold text-amber-700 bg-amber-200/50 px-2 py-0.5 rounded-full mt-1.5 animate-pulse">
                              Ongoing Class
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Attendance marking panel */}
            <div className="card p-5 flex flex-col justify-between animate-slide-up animate-delay-200">
              <div className="flex items-center gap-2 mb-4 border-b pb-3 border-slate-100">
                <Zap className="w-4 h-4 text-amber-500 animate-pulse" />
                <span className="font-bold text-slate-800 text-sm">Live Attendance Marker</span>
              </div>

              {/* Attendance Marking Interface */}
              {settings.timetable_status !== 'Approved' ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-6 gap-3">
                  <div className="w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center text-rose-600">
                    <Shield className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-slate-700">Attendance Marking Locked</h4>
                    <p className="text-xs text-rose-600 font-bold px-4 mt-1">
                      Timetable status: {settings.timetable_status || 'Pending'}
                    </p>
                    <p className="text-[10px] text-slate-450 px-4 mt-1 leading-normal font-medium">
                      The timetable must be approved by the HOD before any attendance can be marked.
                    </p>
                  </div>
                </div>
              ) : isMarkingWindowOpen && periodInfo ? (
                isUserAllowedToMark ? (
                  <div className="flex-1 flex flex-col justify-between gap-4">
                    <div>
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl mb-3">
                        <p className="text-xs font-bold text-amber-700">Active marking window open</p>
                        <p className="text-[10px] text-amber-600 mt-0.5">
                          Hour: {periodInfo.hour} ({periodInfo.time})<br />
                          Subject: {periodInfo.subject}<br />
                          Scheduled: {markerName}
                        </p>
                        {minsRemaining > 0 && !forceMarkingOpen && (
                          <p className="text-[10px] font-black text-rose-500 mt-1">Closes in {minsRemaining} minutes</p>
                        )}
                      </div>

                      {/* Scheduled User check */}
                      {user?.username !== markerName.toLowerCase() && (
                        <div className="flex items-center justify-between gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg mb-3">
                          <span className="text-[10px] font-semibold text-slate-500">Scheduled: {markerName}</span>
                          <button onClick={handleAssignAlternateStaff} className="text-[10px] font-bold text-amber-700 hover:underline">
                            Assign Alternate Staff
                          </button>
                        </div>
                      )}

                      <p className="text-xs font-bold text-slate-500 mb-2">Check off ONLY absent students:</p>
                      
                      {/* Student list checking absent */}
                      <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1 border border-slate-100 p-2 rounded-lg bg-slate-50/50">
                        {students.map((student) => {
                          const isAbsent = markedAbsentees.includes(student.roll_number);
                          return (
                            <label key={student._id} className="flex items-center justify-between p-1.5 rounded hover:bg-slate-100 cursor-pointer text-xs transition-colors">
                              <div className="flex flex-col">
                                <span className="font-bold text-slate-700">{student.name}</span>
                                <span className="text-[10px] text-slate-400 font-mono">{student.roll_number}</span>
                              </div>
                              <input 
                                type="checkbox" 
                                checked={isAbsent} 
                                onChange={() => handleToggleAbsentee(student.roll_number)}
                                className="w-4 h-4 rounded text-amber-500 accent-amber-500 cursor-pointer"
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <button 
                      onClick={handleSubmitPeriodAttendance} 
                      className="btn-primary w-full text-xs py-2 px-4 shadow-[0_4px_12px_rgba(245,158,11,0.2)]"
                    >
                      Submit Hour Roster
                    </button>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col justify-between gap-4">
                    <div className="text-center py-6">
                      <div className="w-12 h-12 bg-amber-100/50 rounded-full flex items-center justify-center text-amber-700 mx-auto mb-3">
                        <Clock className="w-6 h-6" />
                      </div>
                      <h4 className="font-bold text-sm text-slate-700">Scheduled for Another Staff</h4>
                      <p className="text-xs text-slate-400 font-medium px-4 mt-1">
                        This hour ({periodInfo.subject}) is scheduled for <strong className="text-amber-800">{currentScheduledStaff}</strong>.
                      </p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        Logged in as: {user?.username}
                      </p>
                    </div>
                    <div className="p-4 bg-amber-50/50 border border-amber-200/50 rounded-xl space-y-3">
                      <p className="text-[11px] text-amber-800 font-semibold text-center leading-normal">
                        If the scheduled staff is absent, you can take over to mark attendance.
                      </p>
                      <button 
                        onClick={handleAssignAlternateStaff}
                        className="btn-primary w-full text-xs py-2 px-4 shadow-[0_4px_12px_rgba(245,158,11,0.2)]"
                      >
                        Assign Alternate Staff
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-6 gap-3">
                  <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center text-amber-600">
                    <Clock className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-slate-700">No active marking slot</h4>
                    <p className="text-xs text-slate-400 font-medium px-4 mt-1">
                      Attendance marking opens automatically for 15 minutes at the start of each timetable hour.
                    </p>
                  </div>
                  {periodInfo && periodInfo.active && !isMarkingWindowOpen && (
                    <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-left w-full mt-2">
                      <p className="text-[10px] font-bold text-rose-700">Marking Slot Closed</p>
                      <p className="text-[10px] text-rose-600 leading-snug mt-0.5">
                        Hour: {periodInfo.hour} ({periodInfo.time}) start was more than 15 minutes ago.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>

        </div>

        {/* ── Students Live Monitor ── */}
        {user?.role !== 'hod' && (
          <div className="card animate-slide-up animate-delay-200">
          {/* Table Header */}
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 p-5 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <BookOpen className="w-4 h-4 text-amber-500" />
              <span className="font-bold text-slate-800">Students Live Monitor</span>
              <span className="badge badge-amber">{filteredStudents.length}</span>
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input type="search" placeholder="Search name, roll..."
                  value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  className="pl-8 text-sm w-44" />
              </div>
              {/* Sort */}
              <div className="relative">
                <SlidersHorizontal className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="pl-8 text-sm pr-8">
                  <option value="roll_number">Roll No.</option>
                  <option value="name">Name A–Z</option>
                  <option value="top_attendance">Top Attendance</option>
                  <option value="low_attendance">Low Attendance</option>
                  <option value="top_result">Top Result</option>
                </select>
              </div>
              {/* Attendance Filter */}
              <div className="relative">
                <select value={attendanceFilter} onChange={e => setAttendanceFilter(e.target.value)} className="text-sm">
                  <option value="all">All Attendance</option>
                  <option value="low">Low Attendance (&lt;75%)</option>
                  <option value="critical">Critical Attendance (&lt;70%)</option>
                  <option value="high">High Attendance (&ge;85%)</option>
                </select>
              </div>
              {/* Result Filter */}
              <div className="relative">
                <select value={resultFilter} onChange={e => setResultFilter(e.target.value)} className="text-sm">
                  <option value="all">All Results</option>
                  <option value="pass">Passed Students</option>
                  <option value="fail">Failed Students</option>
                </select>
              </div>
              {/* Export CSV for Student Roster */}
              <button onClick={handleExportCSV} className="btn-outline text-xs py-1.5 px-3 flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            </div>
          </div>

          {/* Table Body */}
          {filteredStudents.length === 0 ? (
            <div className="text-center py-16 text-slate-500 font-semibold">
              {searchQuery || attendanceFilter !== 'all' || resultFilter !== 'all' ? 'No students match your search/filter.' : 'No students yet — add your first student!'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Student</th>
                    <th>Entry Type</th>
                    <th>Contact</th>
                    <th>Parent</th>
                    <th className="text-center">Attendance</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((student, i) => (
                    <tr key={student._id} className="group">
                      <td className="text-slate-400 font-bold text-xs w-8">{i + 1}</td>
                      <td>
                        <div className="font-bold text-slate-800">{student.name}</div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="font-mono text-xs text-slate-400">{student.roll_number}</span>
                          {(student.sem2_grade || student.sem1_grade) && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              (student.sem2_grade || student.sem1_grade) === 'F' ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' : 'bg-amber-500/10 text-amber-700 border border-amber-500/20'
                            }`}>
                              Grade: {student.sem2_grade || student.sem1_grade} ({(student.sem2_result || student.sem1_result) || 'Pass'})
                            </span>
                          )}
                          {student.license_number && (
                            <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1 border border-slate-200" title="Driving License">
                              🪪 {student.license_number}
                            </span>
                          )}
                          {student.bike_number && (
                            <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1 border border-slate-200" title="Bike Registration">
                              🏍️ {student.bike_number}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${student.entry_type === 'Lateral Entry' ? 'badge-amber' : 'badge-slate'}`}>
                          {student.entry_type}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5 text-sm text-slate-500">
                          <Phone className="w-3 h-3 text-slate-400" />
                          {student.phone || '—'}
                        </div>
                      </td>
                      <td>
                        <div className="text-sm font-semibold text-slate-600">{student.parent_name || '—'}</div>
                        <div className="text-xs text-slate-400">{student.parent_phone || ''}</div>
                      </td>
                      <td className="text-center">
                        <AttPill value={student.attendance} />
                      </td>
                      <td className="text-right">
                        {selectedTutorId === user?.username ? (
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => { setSelectedStudent(student); setEditorOpen(true); }}
                              className="p-2 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-500/10 transition-all"
                              title="Edit">
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteStudent(student)}
                              className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all"
                              title="Delete">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs font-bold text-slate-400">View Only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </div>
        )}

      {/* Modals */}
      {editorOpen && (
        <StudentEditorModal student={selectedStudent} onSave={handleSaveStudent} onClose={() => setEditorOpen(false)} />
      )}
      {csvOpen && (
        <CsvExportModal students={filteredStudents} className={settings.class_name || '2nd Year 4th Sem'} onClose={() => setCsvOpen(false)} />
      )}
      {lowAttOpen && (
        <LowAttendanceModal students={lowAttStudents} onClose={() => setLowAttOpen(false)} />
      )}
      </div>
    </SidebarLayout>
  );
}
