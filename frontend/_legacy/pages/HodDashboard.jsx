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

const getHodScheduleForToday = (monitorData, staffId) => {
  if (!monitorData || !staffId) return [];
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const currentDayName = days[new Date().getDay()];
  
  const normStaff = staffId.toLowerCase().replace(/[^a-z0-9]/g, '');
  const schedule = [];
  
  monitorData.forEach(cls => {
    const timetable = cls.timetable_data;
    if (!timetable || !timetable.headers || !timetable.rows) return;
    
    const dayRow = timetable.rows.find(r => r[0].toLowerCase() === currentDayName.toLowerCase());
    if (!dayRow) return;
    
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
      
      const normCellStaff = staff.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normStaff === normCellStaff || normCellStaff.includes(normStaff) || normStaff.includes(normCellStaff)) {
        const timeMatch = timetable.headers[i].match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
        let startMin = 0, endMin = 0;
        if (timeMatch) {
          startMin = parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
          endMin = parseInt(timeMatch[3]) * 60 + parseInt(timeMatch[4]);
        }
        schedule.push({
          class_name: cls.class_name,
          tutor_id: cls.tutor_id,
          hour: `Hour ${i}`,
          time: timetable.headers[i],
          subject,
          staff,
          periodIndex: i,
          startMin,
          endMin
        });
      }
    }
  });
  return schedule.sort((a, b) => a.hour.localeCompare(b.hour));
};

function StatusBadge({ status }) {
  if (status === 'Approved') return <span className="badge badge-emerald"><CheckCircle className="w-3 h-3" /> Approved</span>;
  if (status === 'Rejected') return <span className="badge badge-rose"><XCircle className="w-3 h-3" /> Rejected</span>;
  if (status === 'Pending Principal') return <span className="badge badge-amber"><Clock className="w-3 h-3" /> Pending Principal</span>;
  return <span className="badge badge-violet"><Clock className="w-3 h-3" /> {status}</span>;
}

// Sample pending timetables for demo – shown when API returns none
const generateSamplePendingTimetables = () => [
  {
    tutor_id: 'staff_priya',
    class_name: '3rd Sem · CS-A',
    status: 'pending_hod',
    submitted_at: new Date(Date.now() - 2 * 3600000).toISOString(),
    _demo: true,
    pending_timetable_data: {
      headers: ['Day', '9:00 - 9:50', '9:50 - 10:40', '10:50 - 11:40', '11:40 - 12:30', 'Lunch', '1:10 - 2:00', '2:00 - 2:50'],
      rows: [
        ['Monday', 'Data Structures (Priya)', 'OS (Karthik)', 'DBMS (Meena)', 'Maths-III (Ravi)', 'Lunch', 'Lab - DS', 'Lab - DS'],
        ['Tuesday', 'OS (Karthik)', 'Data Structures (Priya)', 'Maths-III (Ravi)', 'English (Lakshmi)', 'Lunch', 'DBMS (Meena)', 'Sports'],
        ['Wednesday', 'DBMS (Meena)', 'Maths-III (Ravi)', 'Data Structures (Priya)', 'OS (Karthik)', 'Lunch', 'Lab - DBMS', 'Lab - DBMS'],
        ['Thursday', 'Maths-III (Ravi)', 'English (Lakshmi)', 'OS (Karthik)', 'Data Structures (Priya)', 'Lunch', 'Library', 'Placement'],
        ['Friday', 'Data Structures (Priya)', 'DBMS (Meena)', 'English (Lakshmi)', 'Maths-III (Ravi)', 'Lunch', 'Lab - OS', 'Lab - OS'],
      ]
    }
  },
  {
    tutor_id: 'staff_kumar',
    class_name: '5th Sem · CS-A',
    status: 'pending_hod',
    submitted_at: new Date(Date.now() - 5 * 3600000).toISOString(),
    _demo: true,
    pending_timetable_data: {
      headers: ['Day', '9:00 - 9:50', '9:50 - 10:40', '10:50 - 11:40', '11:40 - 12:30', 'Lunch', '1:10 - 2:00', '2:00 - 2:50'],
      rows: [
        ['Monday', 'ML (Kumar)', 'CN (Arjun)', 'Compiler (Deepa)', 'Elective-I (Suresh)', 'Lunch', 'Lab - ML', 'Lab - ML'],
        ['Tuesday', 'CN (Arjun)', 'Compiler (Deepa)', 'ML (Kumar)', 'Mini Project', 'Lunch', 'Elective-I (Suresh)', 'Sports'],
        ['Wednesday', 'Compiler (Deepa)', 'ML (Kumar)', 'CN (Arjun)', 'Elective-I (Suresh)', 'Lunch', 'Lab - CN', 'Lab - CN'],
        ['Thursday', 'Elective-I (Suresh)', 'Mini Project', 'ML (Kumar)', 'CN (Arjun)', 'Lunch', 'Library', 'Compiler (Deepa)'],
        ['Friday', 'CN (Arjun)', 'Compiler (Deepa)', 'Elective-I (Suresh)', 'ML (Kumar)', 'Lunch', 'Lab - Compiler', 'Lab - Compiler'],
      ]
    }
  },
  {
    tutor_id: 'staff_anitha',
    class_name: '4th Sem · CS-A',
    status: 'pending_hod',
    submitted_at: new Date(Date.now() - 1 * 3600000).toISOString(),
    _demo: true,
    pending_timetable_data: {
      headers: ['Day', '9:00 - 9:50', '9:50 - 10:40', '10:50 - 11:40', '11:40 - 12:30', 'Lunch', '1:10 - 2:00', '2:00 - 2:50'],
      rows: [
        ['Monday', 'DAA (Anitha)', 'SE (Mohan)', 'COA (Venkat)', 'Prob & Stats (Geetha)', 'Lunch', 'Lab - DAA', 'Lab - DAA'],
        ['Tuesday', 'SE (Mohan)', 'COA (Venkat)', 'Prob & Stats (Geetha)', 'DAA (Anitha)', 'Lunch', 'Environmental Sci', 'Sports'],
        ['Wednesday', 'COA (Venkat)', 'DAA (Anitha)', 'SE (Mohan)', 'Prob & Stats (Geetha)', 'Lunch', 'Lab - SE', 'Lab - SE'],
        ['Thursday', 'Prob & Stats (Geetha)', 'Environmental Sci', 'DAA (Anitha)', 'COA (Venkat)', 'Lunch', 'Library', 'SE (Mohan)'],
        ['Friday', 'DAA (Anitha)', 'SE (Mohan)', 'COA (Venkat)', 'Prob & Stats (Geetha)', 'Lunch', 'Lab - COA', 'Lab - COA'],
      ]
    }
  }
];

// Extract staff workload from all class timetables
const getStaffWorkload = (monitorData) => {
  if (!monitorData) return {};
  const workload = {}; // keyed by normalized staff name

  const skipCells = ['lunch', 'library', 'sports', 'placement', 'free', 'mini project', ''];

  monitorData.forEach(cls => {
    const tt = cls.timetable_data;
    if (!tt || !tt.headers || !tt.rows) return;

    tt.rows.forEach(row => {
      const dayName = row[0];
      for (let i = 1; i < row.length; i++) {
        const cell = (row[i] || '').trim();
        if (!cell || skipCells.includes(cell.toLowerCase())) continue;

        // Check if it's a lab (spans 2 hours) — we count it as 1 entry per cell
        const isLab = cell.toLowerCase().startsWith('lab');

        let subject = cell;
        let staffName = null;
        const match = cell.match(/([^(]+)\(([^)]+)\)/);
        if (match) {
          subject = match[1].trim();
          staffName = match[2].trim();
        }

        if (!staffName && !isLab) continue; // can't attribute without staff name
        if (!staffName && isLab) {
          // Lab without staff name — attribute to subject name
          staffName = subject;
        }

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

  // Convert Sets to arrays for rendering
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

export default function HodDashboard() {
  const navigate = useNavigate();
  const { logout, user, accessToken } = useAuth();
  const { showToast } = useToast();
  
  // Loading & Data States
  const [loading, setLoading] = useState(true);
  const [viewSection, setViewSection] = useState('overview'); // 'overview', 'academic' or 'admin'
  const [pendingTimetables, setPendingTimetables] = useState([]);
  const [allApprovalsCleared, setAllApprovalsCleared] = useState(false);
  const [staffList, setStaffList] = useState([]);
  const [classesList, setClassesList] = useState([]);
  const [monitorData, setMonitorData] = useState([]);

  // Overview dashboard visual states
  const [activeChartTab, setActiveChartTab] = useState('attendance');
  const [overviewSearch, setOverviewSearch] = useState('');
  const [overviewClassFilter, setOverviewClassFilter] = useState('all');
  const [selectedMetricCard, setSelectedMetricCard] = useState(null);
  const [aiRecommendationDismissed, setAiRecommendationDismissed] = useState(false);
  const [hoveredChartIndex, setHoveredChartIndex] = useState(null);

  // Module 10 (Analytics) — attendance rate by class, same panel as
  // PrincipalDashboard.jsx's 'reports' tab. Backend already grants hod
  // this permission (analytics.attendance_rate.read); only the UI was
  // missing.
  const [attendanceRateByClass, setAttendanceRateByClass] = useState([]);

  // Overview pagination state
  const [overviewPage, setOverviewPage] = useState(1);
  const studentsPerPage = 5;

  // Timetable view state
  const [selectedTimetableTutor, setSelectedTimetableTutor] = useState('');

  // Dashboard view states
  const [selectedDashboardTutor, setSelectedDashboardTutor] = useState('');
  const [dashboardStudents, setDashboardStudents] = useState([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('roll_number');
  const [attendanceFilter, setAttendanceFilter] = useState('all');
  const [resultFilter, setResultFilter] = useState('all');

  // Attendance marking states for HOD teaching
  const [markingPeriod, setMarkingPeriod] = useState(null);
  const [markingStudents, setMarkingStudents] = useState([]);
  const [markingLoading, setMarkingLoading] = useState(false);
  const [markedAbsentees, setMarkedAbsentees] = useState([]);
  const [attendanceMarked, setAttendanceMarked] = useState(false);
  const [forceMarkingOpen, setForceMarkingOpen] = useState(false);

  // Selection states for modals
  const [selectedTimetable, setSelectedTimetable] = useState(null);
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null); // null means creating
  const [generatedCreds, setGeneratedCreds] = useState(null);

  // Module 8 final slice — the pending-approvals flow
  // (Architecture.md 2.4/2.5, CLAUDE.md rule 3, routes/workflowRequests.js).
  // A generic list only here: HOD's role in the real Faculty->HOD->
  // Principal / fee-structure chains is to approve/reject the current
  // step, never to submit — see PrincipalDashboard.jsx's own comment on
  // why the "Staff Registrations: Submit for Approval" trigger lives
  // there instead (staff/fee-structure creation is itself still gated
  // requireRole('principal') today).
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [workflowActionId, setWorkflowActionId] = useState(null);
  // Real GET /api/v1/staff — used only to show a full_name next to a
  // pending staff_registration entry below, distinct from the legacy,
  // dead-endpoint staffList this file's Staff Directory still uses.
  const [realStaffList, setRealStaffList] = useState([]);

  // Form & Review States
  const [remarks, setRemarks] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);
  
  // Staff Form State
  const [staffForm, setStaffForm] = useState({
    name: '',
    joined_year: '',
    aicte_id: '',
    phone_number: '',
    staff_id: '',
    linked_semester: '' // 'None', '3rd Sem', '4th Sem', '5th Sem', '6th Sem'
  });

  // Computed staff workload from timetable data
  const staffWorkload = useMemo(() => getStaffWorkload(monitorData), [monitorData]);

  // Compile students list for the Directory Table
  const allStudents = useMemo(() => {
    const list = [];
    monitorData.forEach(c => {
      (c.students || []).forEach(s => {
        list.push({
          ...s,
          className: c.class_name || 'CSE 3rd Sem',
          classTutor: c.tutor_id
        });
      });
    });
    return list;
  }, [monitorData]);

  // Filtered list
  const filteredOverviewStudents = useMemo(() => {
    return allStudents.filter(s => {
      const matchSearch = (s.name || '').toLowerCase().includes(overviewSearch.toLowerCase()) || 
                          (s.roll_number || '').toLowerCase().includes(overviewSearch.toLowerCase());
      const matchClass = overviewClassFilter === 'all' || s.className === overviewClassFilter;
      return matchSearch && matchClass;
    });
  }, [allStudents, overviewSearch, overviewClassFilter]);

  const totalOverviewPages = Math.ceil(filteredOverviewStudents.length / studentsPerPage) || 1;

  const avgAttendanceVal = useMemo(() => {
    if (!allStudents || allStudents.length === 0) return 92;
    const totalPct = allStudents.reduce((acc, s) => {
      const attVal = s.attendance_pct || s.attendance || parseInt(s.sem2_attendance) || parseInt(s.sem1_attendance) || 90;
      return acc + attVal;
    }, 0);
    return Math.round(totalPct / allStudents.length);
  }, [allStudents]);

  // Paginated list
  const paginatedOverviewStudents = useMemo(() => {
    const startIdx = (overviewPage - 1) * studentsPerPage;
    return filteredOverviewStudents.slice(startIdx, startIdx + studentsPerPage);
  }, [filteredOverviewStudents, overviewPage]);

  const handleAuthError = (res) => {
    if (res.status === 401) {
      showToast('Session expired. Please log in again.', 'danger');
      logout();
      navigate('/login');
      return true;
    }
    return false;
  };

  const loadData = async () => {
    setLoading(true);
    try {

      // Pending Timetables
      const ttRes = await fetch('/api/timetable/pending');
      if (handleAuthError(ttRes)) return;
      if (ttRes.ok) {
        const ttData = await ttRes.json();
        const apiTimetables = ttData.pending_timetables || [];
        if (apiTimetables.length > 0) {
          setPendingTimetables(apiTimetables);
          setAllApprovalsCleared(false);
        } else if (!allApprovalsCleared) {
          // Seed sample demo timetables when API has none
          setPendingTimetables(generateSamplePendingTimetables());
        }
      }

      // Staff Profiles
      const staffRes = await fetch('/api/hod/staff');
      if (handleAuthError(staffRes)) return;
      if (staffRes.ok) {
        const staffData = await staffRes.json();
        setStaffList(staffData.staff);
      }

      // Class mappings — repointed to the real API (routes/classes.js).
      // Unlike the old /api/hod/classes prototype endpoint (which never
      // existed in the Node backend and always 404'd), GET /api/v1/classes
      // is real, requireAuth-gated (needs the Authorization header below,
      // which none of this function's other fetches send), and returns a
      // bare array, not a { classes: [...] } envelope. Its rows carry
      // tutor_user_id (a real users.id UUID) instead of the prototype's
      // tutor_id (a username string) — every downstream read of this list
      // below is updated to match. See .ai/TASK.md for what that shape
      // change does and doesn't unlock in this slice.
      const classRes = await fetch('/api/v1/classes', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (handleAuthError(classRes)) return;
      if (classRes.ok) {
        const classData = await classRes.json();
        setClassesList(classData);
      }

      // Monitor Tutor Classes
      const monRes = await fetch('/api/monitor/tutor-classes');
      if (handleAuthError(monRes)) return;
      if (monRes.ok) {
        const monData = await monRes.json();
        setMonitorData(monData.tutors_data);
      }

      // Module 8 final slice — this HOD's pending approvals (real API,
      // requireAuth-gated — see routes/workflowRequests.js) and the
      // real staff list (used only to display a full_name alongside a
      // pending staff_registration entry, not the legacy Staff
      // Directory above).
      const pendingApprovalsRes = await fetch('/api/v1/workflow-requests/pending', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (handleAuthError(pendingApprovalsRes)) return;
      if (pendingApprovalsRes.ok) {
        setPendingApprovals((await pendingApprovalsRes.json()) || []);
      }

      const realStaffRes = await fetch('/api/v1/staff?limit=200', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (handleAuthError(realStaffRes)) return;
      if (realStaffRes.ok) {
        setRealStaffList((await realStaffRes.json()) || []);
      }

      const attendanceRateRes = await fetch('/api/v1/analytics/attendance-rate', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (handleAuthError(attendanceRateRes)) return;
      if (attendanceRateRes.ok) {
        setAttendanceRateByClass((await attendanceRateRes.json()) || []);
      }

    } catch (e) {
      console.error(e);
      showToast('Error loading dashboard data', 'danger');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Set default timetable and dashboard selections once classesList loads.
  // tutor_user_id (real API) replaces tutor_id (prototype username) — see
  // the loadData comment above. Both selectedTimetableTutor and
  // selectedDashboardTutor still only ever reach the old, still-unrepointed
  // /api/monitor/* and /api/timetable/* endpoints below, so this rename has
  // no functional effect on those calls (they 404 identically either way);
  // it's here so this value at least reflects what classesList really
  // contains.
  useEffect(() => {
    if (classesList.length > 0) {
      const activeTutors = classesList.filter(c => c.tutor_user_id);
      if (activeTutors.length > 0) {
        setSelectedTimetableTutor(activeTutors[0].tutor_user_id);
        setSelectedDashboardTutor(activeTutors[0].tutor_user_id);
      } else {
        setSelectedTimetableTutor(classesList[0].tutor_user_id || '');
        setSelectedDashboardTutor(classesList[0].tutor_user_id || '');
      }
    }
  }, [classesList]);

  // Load students for the selected class dashboard
  const loadDashboardStudents = async (tutorId) => {
    if (!tutorId || tutorId.startsWith('unassigned_')) {
      setDashboardStudents([]);
      return;
    }
    setDashboardLoading(true);
    try {
      const res = await fetch(`/api/monitor/tutor-students?tutor_id=${tutorId}`);
      if (res.ok) {
        const data = await res.json();
        const normalized = (data.students || []).map(s => ({
          ...s,
          name: s.name || s.full_name || '',
          roll_number: s.roll_number || s.roll_no || '',
          gender: s.gender || 'Male',
          entry_type: s.entry_type || 'Regular',
          attendance: s.attendance || parseInt(s.sem2_attendance) || parseInt(s.sem1_attendance) || 0,
          sem2_grade: s.sem2_grade || s.sem1_grade || '',
          sem2_result: s.sem2_result || s.sem1_result || 'Pass'
        }));
        setDashboardStudents(normalized);
      } else {
        setDashboardStudents([]);
      }
    } catch (e) {
      console.error(e);
      setDashboardStudents([]);
    } finally {
      setDashboardLoading(false);
    }
  };

  useEffect(() => {
    if (selectedDashboardTutor) {
      loadDashboardStudents(selectedDashboardTutor);
    }
  }, [selectedDashboardTutor]);

  // Attendance marking for HOD scheduled hours
  const startMarkingAttendance = async (period) => {
    setMarkingPeriod(period);
    setMarkingLoading(true);
    setAttendanceMarked(false);
    setMarkedAbsentees([]);
    try {
      const res = await fetch(`/api/monitor/tutor-students?tutor_id=${period.tutor_id}`);
      if (res.ok) {
        const data = await res.json();
        const normalized = (data.students || []).map(s => ({
          ...s,
          name: s.name || s.full_name || '',
          roll_number: s.roll_number || s.roll_no || '',
        }));
        setMarkingStudents(normalized);
      } else {
        setMarkingStudents([]);
      }
    } catch (e) {
      console.error(e);
      setMarkingStudents([]);
    } finally {
      setMarkingLoading(false);
    }
  };

  const handleToggleAbsentee = (rollNo) => {
    if (markedAbsentees.includes(rollNo)) {
      setMarkedAbsentees(prev => prev.filter(r => r !== rollNo));
    } else {
      setMarkedAbsentees(prev => [...prev, rollNo]);
    }
  };

  const handleSubmitPeriodAttendance = async () => {
    if (!markingPeriod) return;
    const totalStudents = markingStudents.length;
    const presentCount = totalStudents - markedAbsentees.length;
    try {
      const res = await fetch('/api/tutor/live-attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tutor_id: markingPeriod.tutor_id,
          present_today: presentCount,
          present_this_hour: presentCount
        })
      });
      if (!res.ok) throw new Error('Failed to save attendance');
      setAttendanceMarked(true);
      showToast(`Attendance marked! Absentees: ${markedAbsentees.length}, Present: ${presentCount}`, 'success');
      setMarkingPeriod(null);
      loadData();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  // Timing helper
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const getIsMarkingWindowOpen = (period) => {
    if (!period) return false;
    if (forceMarkingOpen) return true;
    return (currentMinutes >= period.startMin && currentMinutes < period.startMin + 15);
  };

  const getMinsRemaining = (period) => {
    if (!period) return 0;
    return Math.max(0, (period.startMin + 15) - currentMinutes);
  };

  // Timetable review and approvals flow

  // REVIEW TIMETABLES FLOW
  const openTimetableReview = (tt) => { setSelectedTimetable(tt); setRemarks(''); };
  const closeTimetableReview = () => setSelectedTimetable(null);
  const handleTimetableReview = async (action) => {
    if (!selectedTimetable) return;
    setReviewLoading(true);
    try {
      // For demo timetables, handle locally without API call
      if (selectedTimetable._demo) {
        await new Promise(r => setTimeout(r, 400)); // simulate network delay
        const remaining = pendingTimetables.filter(t => t.tutor_id !== selectedTimetable.tutor_id);
        setPendingTimetables(remaining);
        if (remaining.length === 0) {
          setAllApprovalsCleared(true);
        }
      } else {
        const res = await fetch(`/api/hod/timetable-review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tutor_id: selectedTimetable.tutor_id, action, remarks })
        });
        if (!res.ok) throw new Error('Failed to review timetable');
        loadData();
      }
      showToast(`Timetable successfully ${action === 'Approve' ? 'approved!' : action === 'Forward' ? 'forwarded to Principal!' : 'rejected.'}`, 'success');
      closeTimetableReview();
    } catch (err) { showToast(err.message, 'danger'); }
    finally { setReviewLoading(false); }
  };

  // Module 8 final slice — generic approve/reject. Dispatch by
  // entity_type lives entirely on the backend
  // (routes/workflowRequests.js: staffService.approveStaffRegistration/
  // financeService.approveFeeStructure/rejectFeeStructure, falling back
  // to workflowService directly), so this one call correctly triggers
  // the real entity-specific cascade regardless of which kind of
  // request this is — this screen never needs to branch on entity_type
  // itself, only display it.
  const handleWorkflowAction = async (requestId, action) => {
    setWorkflowActionId(requestId);
    try {
      const res = await fetch(`/api/v1/workflow-requests/${requestId}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      });
      if (handleAuthError(res)) return;
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to ${action} request`);
      }
      showToast(`Request ${action === 'approve' ? 'approved' : 'rejected'}!`, 'success');
      loadData();
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setWorkflowActionId(null);
    }
  };

  // STAFF PROFILES MANAGEMENT FLOW
  const openAddStaff = () => {
    setEditingStaff(null);
    setGeneratedCreds(null);
    setStaffForm({
      name: '',
      joined_year: '',
      aicte_id: '',
      phone_number: '',
      staff_id: '',
      linked_semester: 'None'
    });
    setStaffModalOpen(true);
  };

  const openEditStaff = (staff) => {
    setEditingStaff(staff);
    setGeneratedCreds(null);
    
    // Find if this staff is linked to any semester. This match never
    // succeeds today: classesList.tutor_user_id is a real users.id UUID,
    // staff.username lives on a different, still-unrepointed prototype
    // endpoint (/api/hod/staff) that 404s and leaves staffList empty — see
    // .ai/TASK.md. Left as the closest correct comparison for when
    // staffList itself is repointed to the real GET /api/v1/staff (out of
    // scope here), not silently dropped.
    const matchedClass = classesList.find(c => c.tutor_user_id === staff.username);
    const linked_semester = matchedClass ? matchedClass.semester : 'None';

    setStaffForm({
      name: staff.name || '',
      joined_year: staff.joined_year || '',
      aicte_id: staff.aicte_id || '',
      phone_number: staff.phone_number || '',
      staff_id: staff.staff_id || '',
      linked_semester
    });
    setStaffModalOpen(true);
  };

  const handleStaffFormSubmit = async (e) => {
    e.preventDefault();
    setReviewLoading(true);
    try {
      // Edit goes through the real staff API (routes/staff.js) — a
      // PUT against an already-provisioned profile's id. Create stays
      // on the old /api/hod/staff endpoint below: it doesn't exist in
      // the Node backend at all (no account-creation path exists yet
      // — see .ai/TASK.md), so it's left exactly as-is rather than
      // half-repointed to something that can't actually work.
      if (editingStaff) {
        const staffId = editingStaff._id || editingStaff.id || editingStaff.staff_id;
        const res = await fetch(`/api/v1/staff/${staffId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            full_name: staffForm.name,
            staff_code: staffForm.staff_id,
            joined_year: staffForm.joined_year,
            aicte_id: staffForm.aicte_id,
            phone: staffForm.phone_number,
          })
        });

        if (handleAuthError(res)) return;

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.detail || 'Failed to save staff profile');
        }

        // If a linked semester is selected, update that mapping as well.
        // Still keyed off editingStaff.username — the real API never
        // returns one (username lives on `users`, not `staff`).
        if (staffForm.linked_semester && staffForm.linked_semester !== 'None') {
          const linkRes = await fetch('/api/hod/link-tutor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              semester: staffForm.linked_semester,
              staff_username: editingStaff.username
            })
          });
          if (handleAuthError(linkRes)) return;
          if (!linkRes.ok) {
            const errData = await linkRes.json();
            throw new Error(errData.error || 'Staff profile saved, but tutor linking failed');
          }
        }

        showToast('Staff profile updated!', 'success');
        setStaffModalOpen(false);
        loadData();
        return;
      }

      const body = {
        ...staffForm,
        username: undefined
      };

      const res = await fetch('/api/hod/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (handleAuthError(res)) return;

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to save staff profile');
      }
      const data = await res.json();

      // If a linked semester is selected, update that mapping as well
      const staffUsername = data.staff.username;
      if (staffForm.linked_semester && staffForm.linked_semester !== 'None') {
        const linkRes = await fetch('/api/hod/link-tutor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            semester: staffForm.linked_semester,
            staff_username: staffUsername
          })
        });
        if (handleAuthError(linkRes)) return;
        if (!linkRes.ok) {
          const errData = await linkRes.json();
          throw new Error(errData.error || 'Staff profile saved, but tutor linking failed');
        }
      }

      showToast('Staff profile created successfully!', 'success');

      if (data.credentials) {
        setGeneratedCreds(data.credentials);
        loadData();
      } else {
        setStaffModalOpen(false);
        loadData();
      }

    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setReviewLoading(false);
    }
  };

  // Filter variables

  const menuItems = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'pending_approvals', label: 'Pending Approvals', icon: FileCheck },
    { id: 'academic', label: 'Academic Dashboard', icon: Bot },
    { id: 'admin', label: 'Admin Suite & Approvals', icon: Settings },
    { id: 'reports', label: 'Reports', icon: Gauge }
  ];

  return (
    <SidebarLayout
      activeTab={viewSection}
      onTabChange={setViewSection}
      menuItems={menuItems}
      roleLabel={`HOD · ${user?.department || 'Dept'}`}
    >
      <div className="space-y-6 animate-slide-up">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="section-title mb-1">HOD · Department Dashboard</p>
            <h1 className="text-3xl font-black text-slate-805 tracking-tight">HOD Management Suite</h1>
            <p className="text-slate-500 text-sm mt-1">Manage staff directory, class tutor mapping, and approvals workflow.</p>
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


        {!loading && (
          <div className="space-y-8 animate-slide-up">
            {viewSection === 'overview' && (
              <div className="space-y-8 animate-slide-up">
                {/* ── ROW 1: CAMPUS ACADEMIC CARDS (Batches, Students, Average Attendance) ── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Card 1: Total Batches */}
              <div className="card p-6 flex flex-col justify-between">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--label-2)' }}>Dept Batches</span>
                    <h3 className="text-3xl font-black mt-2" style={{ color: 'var(--label)' }}>
                      {classesList?.length || 0}<span className="text-sm font-semibold text-slate-500"> classes</span>
                    </h3>
                  </div>
                  <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2.5 py-0.8 rounded-full flex items-center gap-1">
                    Active <span className="text-[8px] font-semibold text-emerald-500">this term</span>
                  </span>
                </div>
                
                {/* Mini Sparkline Bar Chart */}
                <div className="mt-6 flex items-end gap-1.5 h-12">
                  {[10, 15, 12, 18, 20, 18, 22, 25, 24, 28].map((h, i) => (
                    <div 
                      key={i} 
                      className={`w-full rounded-t-md transition-all ${i === 8 ? 'bg-indigo-600' : 'bg-indigo-100 hover:bg-indigo-250'}`}
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-[8px] font-bold text-slate-400 mt-2 uppercase">
                  <span>3rd Sem</span>
                  <span>4th Sem</span>
                  <span>5th Sem</span>
                  <span>6th Sem</span>
                </div>
              </div>

              {/* Card 2: Total Students */}
              <div className="card p-6 flex flex-col justify-between">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--label-2)' }}>Dept Students</span>
                    <h3 className="text-3xl font-black mt-2" style={{ color: 'var(--label)' }}>
                      {allStudents?.length || 0} <span className="text-sm font-semibold text-slate-500">enrolled</span>
                    </h3>
                  </div>
                  <span className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-655 flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4" />
                  </span>
                </div>

                {/* Mini Sparkline Bar Chart */}
                <div className="mt-6 flex items-end gap-1.5 h-12">
                  {[25, 35, 40, 48, 50, 55, 62, 65, 70, 75].map((h, i) => (
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
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--label-2)' }}>Dept Attendance</span>
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
                        stroke="#5B5FEF" 
                        strokeWidth="3.5" 
                        strokeDasharray={`${avgAttendanceVal} 100`} 
                      />
                      <circle 
                        cx="18" 
                        cy="18" 
                        r="16" 
                        fill="none" 
                        stroke="#C7D2FE" 
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
                    <h4 className="text-2xl font-black text-slate-850 mt-1.5 flex items-center gap-1">
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
                        <span className="text-[9px] font-bold text-indigo-655 mt-0.5">Active now</span>
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
                    <text x="90" y="48" fill="#475569" fontSize="7" fontWeight="black" textAnchor="middle">{user?.department || 'CSE'} Block</text>

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
                    <span className="font-extrabold text-indigo-650 bg-indigo-50 px-1.5 py-0.5 rounded font-mono">
                      {user?.department || 'CSE'} Sync
                    </span>
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
                    Department Live Student Monitoring Roster
                  </h3>
                  <p className="text-slate-450 text-[10px] font-semibold mt-0.5">Monitored student database list with custom attendance filters</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input 
                      type="text" 
                      placeholder="Search name or roll..." 
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
                        {paginatedOverviewStudents?.map((s, idx) => {
                          const att = s.attendance || parseInt(s.sem2_attendance) || parseInt(s.sem1_attendance) || 100;
                          return (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td>
                                <div className="flex items-center gap-2.5">
                                  <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-150 text-indigo-650 flex items-center justify-center font-bold text-xs">
                                    {(s.name || '').charAt(0).toUpperCase() || 'S'}
                                  </div>
                                  <div>
                                    <p className="font-bold text-slate-855 text-xs">{s.name}</p>
                                    <p className="text-[9px] text-slate-400 font-semibold">{s.phone || 'No phone'}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="font-mono text-xs font-semibold text-slate-600">{s.roll_number}</td>
                              <td className="text-xs font-bold text-slate-700">{s.className}</td>
                              <td className="text-xs text-slate-500 font-bold">@{s.classTutor}</td>
                              <td className="text-right">
                                <span className={`font-black text-xs ${att < 75 ? 'text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full' : 'text-emerald-700'}`}>
                                  {att}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
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

            {/* PENDING APPROVALS (Module 8 final slice) — generic list,
                same card+list pattern PrincipalDashboard.jsx's Fee
                Structures tab uses. Approve/reject dispatch by
                entity_type on the backend; this screen only displays
                whichever entity_type/current_step/approver_chain
                workflowService.listPendingForApprover resolves for
                this HOD right now. */}
            {viewSection === 'pending_approvals' && (
              <div className="space-y-8 animate-slide-up">
                <div className="card p-6 space-y-4">
                  <div className="flex justify-between items-center border-b pb-3 border-slate-50">
                    <div>
                      <h3 className="font-extrabold text-slate-805 text-sm flex items-center gap-1.5">
                        <FileCheck className="w-4 h-4 text-amber-500" />
                        Pending Approvals
                        {pendingApprovals.length > 0 && <span className="badge badge-amber">{pendingApprovals.length}</span>}
                      </h3>
                      <p className="text-slate-450 text-[10px] font-semibold mt-0.5">
                        Requests waiting on your approval at the current step of their chain.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
                    {(pendingApprovals || []).length === 0 ? (
                      <p className="text-xs text-slate-400 italic py-6 text-center">Nothing pending your approval right now.</p>
                    ) : (
                      pendingApprovals.map((req) => {
                        const relatedStaff = req.entity_type === 'staff_registration'
                          ? realStaffList.find((s) => s.id === req.entity_id) : null;
                        const isActing = workflowActionId === req.id;
                        return (
                          <div key={req.id} className="p-3 bg-white border border-slate-150 rounded-xl flex items-center justify-between hover:border-slate-350 transition-colors">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center font-bold text-xs flex-shrink-0">
                                <Clock className="w-4 h-4" />
                              </div>
                              <div>
                                <p className="text-xs font-extrabold text-slate-805">
                                  {req.entity_type === 'staff_registration' ? 'Staff Registration' : req.entity_type === 'fee_structure' ? 'Fee Structure' : req.entity_type}
                                  {relatedStaff && <> · {relatedStaff.full_name}</>}
                                </p>
                                <p className="text-[9px] text-slate-400 font-semibold">
                                  Step {req.current_step} of {req.approver_chain?.length || '?'}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleWorkflowAction(req.id, 'approve')}
                                disabled={isActing}
                                className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                                title="Approve"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleWorkflowAction(req.id, 'reject')}
                                disabled={isActing}
                                className="w-7 h-7 rounded-lg bg-rose-50 border border-rose-100 text-rose-600 flex items-center justify-center hover:bg-rose-100 disabled:opacity-50 transition-colors"
                                title="Reject"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}

            {viewSection === 'academic' && (
              <>
                {/* SECTION 1: HOD'S OWN TEACHING SCHEDULE & ATTENDANCE MARKING */}
                <div className="card p-6 border-l-4 border-l-amber-500">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4 border-slate-100 mb-4">
                <div>
                  <h2 className="font-black text-slate-800 text-lg flex items-center gap-2">
                    <CalendarDays className="w-5 h-5 text-amber-500" />
                    My Teaching Schedule Today
                  </h2>
                  <p className="text-slate-500 text-xs mt-0.5">Mark live attendance for your assigned class periods.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setForceMarkingOpen(!forceMarkingOpen)} 
                    className={`text-xs py-1.5 px-3 rounded-lg border font-bold flex items-center gap-1.5 transition-all ${
                      forceMarkingOpen ? 'bg-amber-100 border-amber-250 text-amber-700' : 'bg-white border-slate-200 text-slate-500'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    {forceMarkingOpen ? 'Disable Marking Override' : 'Force Open Marking slot'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* HOD Scheduled Hours */}
                <div className="lg:col-span-1 space-y-3">
                  {(() => {
                    const myTodayHours = getHodScheduleForToday(monitorData, user?.staff_id || '');
                    if (myTodayHours.length === 0) {
                      return (
                        <div className="text-center py-6 bg-slate-50/50 border border-slate-100 rounded-xl">
                          <p className="text-xs text-slate-400 font-medium">No teaching hours scheduled for you today.</p>
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-2">
                        {myTodayHours?.map((slot, idx) => {
                          const isCurrentHour = getCurrentPeriod({ timetable_data: monitorData.find(c => c.tutor_id === slot.tutor_id)?.timetable_data })?.time === slot.time;
                          const isSelected = markingPeriod && markingPeriod.tutor_id === slot.tutor_id && markingPeriod.time === slot.time;
                          return (
                            <div 
                              key={idx} 
                              onClick={() => startMarkingAttendance(slot)}
                              className={`p-3 rounded-xl border transition-all cursor-pointer ${
                                isSelected 
                                  ? 'bg-amber-500 text-white border-amber-600 shadow-md' 
                                  : isCurrentHour
                                    ? 'bg-amber-100/60 border-amber-300 hover:bg-amber-100'
                                    : 'bg-slate-50 border-slate-150 hover:bg-slate-100'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-black">{slot.hour} · {slot.class_name}</span>
                                <span className={`text-[10px] font-mono ${isSelected ? 'text-amber-100' : 'text-slate-400'}`}>{slot.time}</span>
                              </div>
                              <p className={`text-xs font-bold mt-1 ${isSelected ? 'text-white' : 'text-slate-600'}`}>{slot.subject}</p>
                              {isCurrentHour && !isSelected && (
                                <span className="inline-block text-[8px] font-extrabold text-amber-700 bg-amber-200/50 px-2 py-0.5 rounded-full mt-1.5 animate-pulse">
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

                {/* Attendance Marker Panel */}
                <div className="lg:col-span-2 bg-slate-50/55 border border-slate-150 rounded-2xl p-4 flex flex-col justify-between">
                  {markingPeriod ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between border-b pb-2 border-slate-200">
                        <div>
                          <h4 className="font-extrabold text-sm text-slate-800">Mark Attendance: {markingPeriod.class_name}</h4>
                          <p className="text-[10px] text-slate-500 font-semibold">{markingPeriod.hour} ({markingPeriod.time}) · {markingPeriod.subject}</p>
                        </div>
                        {attendanceMarked && <span className="badge badge-emerald">Submitted</span>}
                      </div>

                      {markingLoading ? (
                        <p className="text-xs text-slate-500 italic">Loading student roster...</p>
                      ) : markingStudents.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No students registered in this class.</p>
                      ) : (
                        <>
                          <p className="text-xs font-bold text-slate-500">Check off ONLY absent students:</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-1 border border-slate-100 rounded-xl bg-white">
                            {markingStudents?.map((student) => {
                              const isAbsent = markedAbsentees.includes(student.roll_number);
                              return (
                                <label key={student.roll_number} className="flex items-center justify-between p-2 rounded hover:bg-slate-50 cursor-pointer text-xs transition-all border border-slate-100">
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
                          <button 
                            onClick={handleSubmitPeriodAttendance}
                            className="btn-primary text-xs py-2 px-4 shadow-[0_4px_12px_rgba(245,158,11,0.2)] w-full"
                          >
                            Submit Hour Roster
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center py-10 text-slate-400">
                      <Zap className="w-10 h-10 text-slate-300 mb-2" />
                      <h4 className="font-bold text-sm text-slate-700">Attendance Marking Board</h4>
                      <p className="text-xs text-slate-400 max-w-sm mt-1">
                        Select one of your scheduled classes on the left to start marking student attendance for today.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* SECTION 2: LIVE DEPARTMENT MONITOR */}
            <div className="space-y-5">
              <h2 className="font-black text-slate-800 text-lg flex items-center gap-2">
                <Activity className="w-5 h-5 text-amber-500 animate-pulse" />
                Live Department Class Status
              </h2>

              {monitorData.length === 0 ? (
                <p className="text-sm text-slate-450 italic bg-white p-6 rounded-2xl border border-slate-200/60 text-center">No active class monitor data available.</p>
              ) : (
                <>
                  {/* Department-wide Stats Banner */}
                  {(() => {
                    const totalStudents = monitorData.reduce((sum, cls) => sum + (cls.students?.length || 0), 0);
                    const totalPresentToday = monitorData.reduce((sum, cls) => sum + (cls.present_today || 0), 0);
                    const totalAbsentToday = totalStudents - totalPresentToday;
                    const overallPct = totalStudents > 0 ? Math.round((totalPresentToday / totalStudents) * 100) : 0;

                    // Classes with below 70% attendance today
                    const lowAttClasses = monitorData.filter(cls => {
                      const total = cls.students?.length || 0;
                      const present = cls.present_today || 0;
                      return total > 0 && (present / total) * 100 < 70;
                    });

                    // Long absentees: students with attendance < 65% (proxy for 4+ day absence streaks)
                    const longAbsentees = [];
                    monitorData.forEach(cls => {
                      (cls.students || []).forEach(s => {
                        const att = s.attendance || parseInt(s.sem2_attendance) || parseInt(s.sem1_attendance) || 100;
                        if (att < 65) {
                          const estimatedDaysAbsent = Math.max(4, Math.round((100 - att) / 5));
                          longAbsentees.push({
                            name: s.name || s.full_name || 'Unknown',
                            roll: s.roll_number || s.roll_no || '',
                            attendance: att,
                            class_name: cls.class_name || 'Unknown',
                            daysAbsent: estimatedDaysAbsent,
                            phone: s.phone || s.phone_number || ''
                          });
                        }
                      });
                    });
                    longAbsentees.sort((a, b) => a.attendance - b.attendance);

                    return (
                      <div className="space-y-4">
                        {/* Top-level stats row */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="card p-4 border-l-4 border-l-amber-500">
                            <p className="text-[10px] uppercase font-extrabold text-slate-450 tracking-wider">Total Dept Students</p>
                            <p className="text-2xl font-black text-slate-800 mt-1">{totalStudents}</p>
                            <p className="text-[10px] text-slate-500 font-semibold mt-0.5">Across {monitorData.length} classes</p>
                          </div>
                          <div className="card p-4 border-l-4 border-l-emerald-500">
                            <p className="text-[10px] uppercase font-extrabold text-slate-450 tracking-wider">Present Today</p>
                            <p className="text-2xl font-black text-emerald-600 mt-1">{totalPresentToday}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${overallPct}%` }} />
                              </div>
                              <span className="text-[10px] font-black text-emerald-700">{overallPct}%</span>
                            </div>
                          </div>
                          <div className="card p-4 border-l-4 border-l-rose-500">
                            <p className="text-[10px] uppercase font-extrabold text-slate-450 tracking-wider">Absent Today</p>
                            <p className="text-2xl font-black text-rose-600 mt-1">{totalAbsentToday}</p>
                            <p className="text-[10px] text-rose-500 font-semibold mt-0.5">{totalStudents > 0 ? (100 - overallPct) : 0}% of department</p>
                          </div>
                          <div className="card p-4 border-l-4 border-l-violet-500">
                            <p className="text-[10px] uppercase font-extrabold text-slate-450 tracking-wider">Long Absentees</p>
                            <p className="text-2xl font-black text-violet-600 mt-1">{longAbsentees.length}</p>
                            <p className="text-[10px] text-violet-500 font-semibold mt-0.5">4+ days absent streak</p>
                          </div>
                        </div>

                        {/* Classes with below 70% attendance alert */}
                        {lowAttClasses.length > 0 && (
                          <div className="card p-4 bg-rose-50/60 border-rose-200/50">
                            <div className="flex items-center gap-2 mb-3">
                              <AlertTriangle className="w-4 h-4 text-rose-500" />
                              <h3 className="text-xs font-black text-rose-800">Classes Below 70% Attendance Today</h3>
                              <span className="badge badge-rose ml-auto">{lowAttClasses.length}</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                              {lowAttClasses?.map((cls, idx) => {
                                const total = cls.students?.length || 0;
                                const present = cls.present_today || 0;
                                const absent = total - present;
                                const pct = total > 0 ? Math.round((present / total) * 100) : 0;
                                return (
                                  <div key={idx} className="p-3 bg-white/80 rounded-xl border border-rose-200/50 flex items-center justify-between">
                                    <div>
                                      <p className="text-xs font-black text-slate-800">{cls.class_name || 'Class'}</p>
                                      <p className="text-[10px] font-bold text-rose-600">{absent} absent of {total} · <strong>{pct}%</strong> present</p>
                                    </div>
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm border-2 ${
                                      pct < 50 ? 'border-rose-400 text-rose-600 bg-rose-100' : 'border-amber-400 text-amber-700 bg-amber-50'
                                    }`}>
                                      {pct}%
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Long Absentees (4+ days) */}
                        {longAbsentees.length > 0 && (
                          <div className="card p-4">
                            <div className="flex items-center gap-2 mb-3">
                              <AlertTriangle className="w-4 h-4 text-violet-500" />
                              <h3 className="text-xs font-black text-slate-800">Long Absentees — 4+ Days Absent</h3>
                              <span className="badge badge-violet ml-auto">{longAbsentees.length} students</span>
                            </div>
                            <div className="overflow-x-auto border border-slate-100 rounded-xl">
                              <table className="w-full text-left border-collapse text-[11px]">
                                <thead>
                                  <tr className="bg-slate-50/80 border-b border-slate-100 text-slate-500 font-extrabold">
                                    <th className="p-2.5">#</th>
                                    <th className="p-2.5">Student Name</th>
                                    <th className="p-2.5">Roll No.</th>
                                    <th className="p-2.5">Class</th>
                                    <th className="p-2.5 text-center">Attendance</th>
                                    <th className="p-2.5 text-center">Est. Days Absent</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {longAbsentees.slice(0, 15)?.map((s, idx) => (
                                    <tr key={idx} className="border-b border-slate-50 hover:bg-rose-50/30">
                                      <td className="p-2.5 text-slate-400">{idx + 1}</td>
                                      <td className="p-2.5 font-bold text-slate-800">{s.name}</td>
                                      <td className="p-2.5 font-mono text-slate-500">{s.roll}</td>
                                      <td className="p-2.5">
                                        <span className="text-[9px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{s.class_name}</span>
                                      </td>
                                      <td className="p-2.5 text-center">
                                        <span className={`font-extrabold px-2 py-0.5 rounded-full text-[10px] ${
                                          s.attendance < 50 ? 'bg-red-100 text-red-700 border border-red-200' :
                                          'bg-amber-50 text-amber-700 border border-amber-200'
                                        }`}>
                                          {s.attendance}%
                                        </span>
                                      </td>
                                      <td className="p-2.5 text-center">
                                        <span className="font-black text-rose-600">{s.daysAbsent}+ days</span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {longAbsentees.length > 15 && (
                                <p className="text-center text-[10px] text-slate-400 font-semibold py-2 bg-slate-50">
                                  +{longAbsentees.length - 15} more students with long absences
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Per-class live status cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {monitorData?.map((cls, idx) => {
                      const currentPeriod = getCurrentPeriod(cls.timetable_data);
                      const isClassOngoing = currentPeriod && currentPeriod.active;
                      const total = cls.students?.length || 0;
                      const presentToday = cls.present_today || 0;
                      const todayPct = total > 0 ? Math.round((presentToday / total) * 100) : 0;
                      return (
                        <div key={idx} className="card p-5 flex flex-col gap-3 hover-lift border-l-4 border-l-amber-500">
                          <div className="flex justify-between items-start">
                            <div>
                              <h3 className="font-black text-slate-800 text-base">{cls.class_name || 'Class'}</h3>
                              <p className="text-xs text-slate-400 font-bold mt-0.5">Tutor: @{cls.tutor_id}</p>
                            </div>
                            {isClassOngoing ? (
                              <span className="badge badge-emerald flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"/> Ongoing</span>
                            ) : (
                              <span className="badge badge-slate">Free Hour</span>
                            )}
                          </div>
                          
                          <div className="p-3 rounded-xl bg-slate-50/55 border border-slate-100 flex-1 flex flex-col justify-center">
                            {isClassOngoing ? (
                              <div className="space-y-1.5 text-xs">
                                <p className="font-bold text-slate-500">Period: <strong className="text-slate-800">{currentPeriod.hour} ({currentPeriod.time})</strong></p>
                                <p className="font-bold text-slate-500">Subject: <strong className="text-slate-800">{currentPeriod.subject}</strong></p>
                                <p className="font-bold text-slate-500">Staff: <strong className="text-slate-850">@{currentPeriod.staff}</strong></p>
                              </div>
                            ) : (
                              <div className="text-center py-2">
                                <p className="text-xs font-semibold text-slate-400">No scheduled class currently</p>
                              </div>
                            )}
                          </div>

                          {/* Today's attendance bar */}
                          <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                            <span>Today:</span>
                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${todayPct < 70 ? 'bg-rose-400' : todayPct < 85 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${todayPct}%` }} />
                            </div>
                            <span className={`font-black ${todayPct < 70 ? 'text-rose-600' : todayPct < 85 ? 'text-amber-700' : 'text-emerald-700'}`}>
                              {presentToday}/{total} ({todayPct}%)
                            </span>
                          </div>

                          {isClassOngoing && (
                            <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                              <span className="text-slate-400 font-bold">This Hour:</span>
                              <span className="font-black text-amber-700 bg-amber-50 border border-amber-200/50 px-2 py-0.5 rounded-md">
                                {cls.present_this_hour || 0} / {total} Present
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* SECTION 3: ALL SEMESTERS' TIMETABLES */}
            <div className="card p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4 border-slate-100 mb-4">
                <div>
                  <h2 className="font-black text-slate-800 text-lg flex items-center gap-2">
                    <CalendarDays className="w-5 h-5 text-amber-500" />
                    All Semesters' Timetables
                  </h2>
                  <p className="text-slate-500 text-xs mt-0.5">Select and view class schedules across the department.</p>
                </div>
                <div>
                  <select 
                    value={selectedTimetableTutor} 
                    onChange={e => setSelectedTimetableTutor(e.target.value)}
                    className="text-xs font-bold border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-750 cursor-pointer hover:border-amber-500 focus:outline-none transition-all"
                  >
                    <option value="">Select Semester Class</option>
                    {monitorData?.map((c, idx) => (
                      <option key={idx} value={c.tutor_id}>
                        {c.class_name} {c.tutor_id ? `(@${c.tutor_id})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {(() => {
                const targetClass = monitorData.find(c => c.tutor_id === selectedTimetableTutor);
                if (!targetClass || !targetClass.timetable_data) {
                  return (
                    <div className="text-center py-10 text-slate-400">
                      <Calendar className="w-10 h-10 mx-auto mb-2 text-slate-350" />
                      <p className="text-xs font-semibold">No timetable details available for this class.</p>
                    </div>
                  );
                }
                const timetable = targetClass.timetable_data;
                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs font-semibold text-slate-600">
                      <thead>
                        <tr className="border-b border-slate-200">
                          {timetable.headers?.map((header, idx) => (
                            <th key={idx} className="pb-2 font-bold text-slate-500 p-2 whitespace-nowrap">{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {timetable.rows?.map((row, rIdx) => {
                          const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                          const currentDayName = days[new Date().getDay()];
                          const isTodayRow = currentDayName.toLowerCase() === row[0].toLowerCase();
                          const currentPeriodInfo = getCurrentPeriod(timetable);
                          return (
                            <tr key={rIdx} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${isTodayRow ? 'bg-amber-50/40' : ''}`}>
                              {row?.map((cell, cIdx) => {
                                let isActiveCell = false;
                                if (isTodayRow && cIdx > 0 && currentPeriodInfo && currentPeriodInfo.active) {
                                  const colHeader = timetable.headers[cIdx];
                                  if (colHeader === currentPeriodInfo.time) {
                                    isActiveCell = true;
                                  }
                                }
                                return (
                                  <td key={cIdx} className={`p-3 ${cIdx === 0 ? 'font-bold text-amber-800' : 'text-slate-500'} ${isActiveCell ? 'bg-amber-100/60 text-amber-700 font-extrabold border border-amber-300 rounded shadow-sm' : ''}`}>
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
                );
              })()}
            </div>

            {/* SECTION 4: CLASS DASHBOARD PORTAL & STUDENT ROSTERS */}
            <div className="card p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4 border-slate-100 mb-6">
                <div>
                  <h2 className="font-black text-slate-800 text-lg flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-amber-500" />
                    Department Class Dashboards
                  </h2>
                  <p className="text-slate-500 text-xs mt-0.5">Monitor demographics and students live monitor details for any class.</p>
                </div>
                <div>
                  <select 
                    value={selectedDashboardTutor} 
                    onChange={e => setSelectedDashboardTutor(e.target.value)}
                    className="text-xs font-bold border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-750 cursor-pointer hover:border-amber-500 focus:outline-none transition-all"
                  >
                    <option value="">Select Semester Class</option>
                    {monitorData?.map((c, idx) => (
                      <option key={idx} value={c.tutor_id}>
                        {c.class_name} {c.tutor_id ? `(@${c.tutor_id})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedDashboardTutor ? (
                <div className="space-y-6">
                  {/* Class Stats Row */}
                  {(() => {
                    const clsSettings = monitorData.find(c => c.tutor_id === selectedDashboardTutor);
                    const totalSt = dashboardStudents.length;
                    const lowAtt = dashboardStudents.filter(s => s.attendance < 75).length;
                    const daySch = dashboardStudents.filter(s => String(s.accommodation || '').toLowerCase().includes('day')).length;
                    const hostellers = dashboardStudents.filter(s => String(s.accommodation || '').toLowerCase().includes('hostel')).length;
                    const boys = dashboardStudents.filter(s => ['male', 'boy'].includes(String(s.gender).toLowerCase())).length;
                    const girls = dashboardStudents.filter(s => ['female', 'girl'].includes(String(s.gender).toLowerCase())).length;

                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="p-4 bg-slate-50 border border-slate-150 rounded-2xl">
                          <p className="text-[10px] uppercase font-extrabold text-slate-450 tracking-wider">Total Students</p>
                          <p className="text-2xl font-black text-slate-800 mt-1">{totalSt}</p>
                          <p className="text-[10px] text-slate-500 font-semibold mt-1">Boys: {boys} · Girls: {girls}</p>
                        </div>
                        <div className="p-4 bg-slate-50 border border-slate-150 rounded-2xl">
                          <p className="text-[10px] uppercase font-extrabold text-slate-450 tracking-wider">Living Status</p>
                          <p className="text-2xl font-black text-slate-800 mt-1">{daySch + hostellers > 0 ? `${daySch} Day` : '0'}</p>
                          <p className="text-[10px] text-slate-500 font-semibold mt-1">Day Scholars: {daySch} · Hostel: {hostellers}</p>
                        </div>
                        <div className="p-4 bg-slate-50 border border-slate-150 rounded-2xl">
                          <p className="text-[10px] uppercase font-extrabold text-slate-450 tracking-wider">Active Period Status</p>
                          <p className="text-sm font-black text-amber-700 truncate mt-2">
                            {clsSettings ? (getCurrentPeriod(clsSettings.timetable_data)?.subject || 'Free / Break') : 'N/A'}
                          </p>
                          <p className="text-[10px] text-slate-500 font-semibold mt-1">
                            {clsSettings ? (getCurrentPeriod(clsSettings.timetable_data)?.hour || 'No Period') : ''}
                          </p>
                        </div>
                        <div className="p-4 bg-slate-50 border border-slate-150 rounded-2xl">
                          <p className="text-[10px] uppercase font-extrabold text-slate-450 tracking-wider">Low Attendance</p>
                          <p className="text-2xl font-black text-rose-600 mt-1">{lowAtt}</p>
                          <p className="text-[10px] text-rose-500 font-semibold mt-1">Students below 75% attendance</p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Student list monitor search & filters */}
                  <div className="flex flex-col md:flex-row gap-3 items-center justify-between bg-slate-50/50 p-4 border border-slate-150 rounded-2xl">
                    <div className="flex items-center gap-2">
                      <Users className="w-4.5 h-4.5 text-amber-500" />
                      <span className="font-bold text-sm text-slate-700">Roster Live Monitor</span>
                    </div>

                    <div className="flex gap-2 flex-wrap items-center w-full md:w-auto">
                      <div className="relative flex-1 md:flex-initial">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <input 
                          type="search" 
                          placeholder="Search student..."
                          value={searchQuery} 
                          onChange={e => setSearchQuery(e.target.value)}
                          className="pl-8 text-xs py-1.5 w-full md:w-36 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500" 
                        />
                      </div>
                      <select 
                        value={sortBy} 
                        onChange={e => setSortBy(e.target.value)} 
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-600"
                      >
                        <option value="roll_number">Roll No.</option>
                        <option value="name">Name A–Z</option>
                        <option value="top_attendance">Top Attendance</option>
                        <option value="low_attendance">Low Attendance</option>
                      </select>
                      <select 
                        value={attendanceFilter} 
                        onChange={e => setAttendanceFilter(e.target.value)} 
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-600"
                      >
                        <option value="all">All Attendance</option>
                        <option value="low">Low (&lt;75%)</option>
                        <option value="high">High (&ge;85%)</option>
                      </select>
                    </div>
                  </div>

                  {/* Student list roster table */}
                  {dashboardLoading ? (
                    <p className="text-xs text-slate-400 italic text-center py-6">Fetching class roster...</p>
                  ) : dashboardStudents.length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-6">No students in this class roster.</p>
                  ) : (
                    <div className="overflow-x-auto border border-slate-100 rounded-2xl bg-white shadow-sm">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50/80 border-b border-slate-100 text-slate-500 font-extrabold">
                            <th className="p-3">#</th>
                            <th className="p-3">Student Name</th>
                            <th className="p-3">Roll Number</th>
                            <th className="p-3">Entry Type</th>
                            <th className="p-3">Phone</th>
                            <th className="p-3 text-center">Attendance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dashboardStudents
                            .filter(s => {
                              const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.roll_number.toLowerCase().includes(searchQuery.toLowerCase());
                              if (!matchesSearch) return false;
                              if (attendanceFilter === 'low' && s.attendance >= 75) return false;
                              if (attendanceFilter === 'high' && s.attendance < 85) return false;
                              return true;
                            })
                            .sort((a, b) => {
                              if (sortBy === 'top_attendance') return b.attendance - a.attendance;
                              if (sortBy === 'low_attendance') return a.attendance - b.attendance;
                              if (sortBy === 'name') return a.name.localeCompare(b.name);
                              return a.roll_number.localeCompare(b.roll_number);
                            })
                            .map((student, idx) => (
                              <tr key={student.roll_number} className="border-b border-slate-50 hover:bg-slate-50/50">
                                <td className="p-3 text-slate-400">{idx + 1}</td>
                                <td className="p-3 font-bold text-slate-800">{student.name}</td>
                                <td className="p-3 font-mono font-bold text-slate-500">{student.roll_number}</td>
                                <td className="p-3">
                                  <span className={`badge ${student.entry_type === 'Lateral Entry' ? 'badge-amber' : 'badge-slate'}`}>
                                    {student.entry_type}
                                  </span>
                                </td>
                                <td className="p-3 text-slate-500">{student.phone || '—'}</td>
                                <td className="p-3 text-center">
                                  <span className={`font-extrabold text-xs px-2 py-0.5 rounded-full ${
                                    student.attendance < 65 ? 'bg-red-50 text-red-655 border border-red-200' :
                                    student.attendance < 75 ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                                    'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  }`}>
                                    {student.attendance}%
                                  </span>
                                </td>
                              </tr>
                            ))
                          }
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-10 text-slate-400">
                  <Users className="w-10 h-10 mx-auto mb-2 text-slate-350" />
                  <p className="text-xs font-semibold">Select a semester class above to explore its monitor dashboard.</p>
                </div>
              )}
            </div>
          </>
        )}

        {viewSection === 'admin' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Side: Pending Timetable Approvals Queue (7 Columns) */}
              <div className="lg:col-span-7 space-y-4">

                {pendingTimetables.length > 0 ? (
                  <>
                    <h2 className="font-black text-slate-800 text-lg flex items-center gap-2">
                      <Clock className="w-5 h-5 text-amber-500" />
                      Pending Timetable Approvals
                      <span className="badge badge-amber ml-1">{pendingTimetables.length}</span>
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {pendingTimetables?.map((tt, i) => {
                        // Calculate time since submitted
                        const submittedAgo = tt.submitted_at 
                          ? (() => {
                              const diff = Date.now() - new Date(tt.submitted_at).getTime();
                              const hrs = Math.floor(diff / 3600000);
                              if (hrs < 1) return `${Math.floor(diff / 60000)}m ago`;
                              if (hrs < 24) return `${hrs}h ago`;
                              return `${Math.floor(hrs / 24)}d ago`;
                            })()
                          : null;
                        // Count unique subjects from timetable data
                        const subjectCount = tt.pending_timetable_data?.rows
                          ? new Set(
                              tt.pending_timetable_data.rows.flatMap(row =>
                                row.slice(1).filter(cell => 
                                  cell && !['lunch', 'library', 'sports', 'placement', 'free', 'mini project'].includes(cell.toLowerCase())
                                ).map(cell => cell.replace(/\s*\([^)]*\)\s*/g, '').trim())
                              )
                            ).size
                          : 0;

                        return (
                          <div key={i} className="card p-5 flex flex-col gap-3 hover-lift border-l-4 border-l-amber-500 group">
                            <div className="flex justify-between items-start">
                              <div>
                                <h3 className="font-black text-slate-800 text-lg">{tt.class_name || 'Class'}</h3>
                                <p className="text-xs font-bold text-slate-450">Submitted by: <span className="text-amber-700">@{tt.tutor_id}</span></p>
                              </div>
                              <span className="badge badge-amber animate-pulse">Awaiting Review</span>
                            </div>

                            {/* Quick stats row */}
                            <div className="flex gap-3 text-[10px] font-bold text-slate-500">
                              {submittedAgo && (
                                <span className="flex items-center gap-1 bg-slate-50 px-2 py-1 rounded-lg">
                                  <Clock className="w-3 h-3 text-slate-400" /> {submittedAgo}
                                </span>
                              )}
                              {subjectCount > 0 && (
                                <span className="flex items-center gap-1 bg-slate-50 px-2 py-1 rounded-lg">
                                  <BookOpen className="w-3 h-3 text-slate-400" /> {subjectCount} subjects
                                </span>
                              )}
                              <span className="flex items-center gap-1 bg-slate-50 px-2 py-1 rounded-lg">
                                <CalendarDays className="w-3 h-3 text-slate-400" /> {tt.pending_timetable_data?.rows?.length || 5} days
                              </span>
                            </div>

                            <div className="text-xs text-slate-500 font-semibold">
                              Review the full weekly timetable layout and approve or forward to the Principal.
                            </div>

                            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 mt-auto">
                              <button 
                                onClick={() => openTimetableReview(tt)}
                                className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 group-hover:shadow-md transition-shadow"
                              >
                                <Eye className="w-4 h-4" /> Review Schedule
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  /* All approvals cleared – compact success banner */
                  <div className="card p-6 bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200/50 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                        <CheckCircle className="w-6 h-6 text-emerald-500" />
                      </div>
                      <div>
                        <h3 className="font-black text-emerald-800 text-base">All Timetables Reviewed</h3>
                        <p className="text-xs text-emerald-600 font-semibold mt-0.5">No pending approvals. This section will reappear when new timetable requests arrive.</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Side: Staff Workload, Directory & Tutor Assignments (5 Columns) */}
              <div className="lg:col-span-5 space-y-6">

                {/* Staff Workload Overview */}
                {Object.keys(staffWorkload).length > 0 && (
                  <div className="card p-5">
                    <h3 className="font-extrabold text-slate-800 text-sm mb-4 pb-2 border-b border-slate-150 flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-amber-500" />
                      Staff Workload Overview
                      <span className="text-[9px] font-bold text-slate-400 ml-auto">hrs/week</span>
                    </h3>

                    <div className="space-y-2.5">
                      {Object.values(staffWorkload)
                        .sort((a, b) => b.hoursPerWeek - a.hoursPerWeek)
                        .map((w, idx) => {
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
                                  <span className="text-[11px] font-black text-slate-800 tabular-nums w-5 text-right">{w.hoursPerWeek}</span>
                                </div>
                              </div>
                              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    isHeavy ? 'bg-gradient-to-r from-rose-400 to-rose-500' :
                                    isLight ? 'bg-gradient-to-r from-sky-300 to-sky-400' :
                                    'bg-gradient-to-r from-amber-400 to-amber-500'
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              {/* Hover tooltip with subjects */}
                              <div className="hidden group-hover:flex flex-wrap gap-1 mt-1.5 animate-slide-up">
                                {w.subjects?.map((sub, si) => (
                                  <span key={si} className="text-[8px] font-bold bg-slate-50 text-slate-600 border border-slate-150 px-1.5 py-0.5 rounded">
                                    {sub}
                                  </span>
                                ))}
                                {w.classes?.map((cl, ci) => (
                                  <span key={ci} className="text-[8px] font-bold bg-amber-50 text-amber-700 border border-amber-150 px-1.5 py-0.5 rounded">
                                    {cl}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
                
                {/* Tutor Semester Class Assignments mapping */}
                <div className="card p-5 flex flex-col">
                  <h3 className="font-extrabold text-slate-800 text-sm mb-4 pb-2 border-b border-slate-150 flex items-center gap-2">
                    <GraduationCap className="w-5 h-5 text-amber-500" />
                    Class Tutor Assignments
                  </h3>
                  
                  <div className="space-y-3">
                    {classesList?.map((cls, idx) => {
                      // staffList is still sourced from the unrepointed
                      // /api/hod/staff prototype endpoint (404s, stays
                      // empty), so this never matches — tutor stays
                      // undefined and only the raw tutor_user_id badge
                      // below renders. See .ai/TASK.md.
                      const tutor = staffList.find(s => s.username === cls.tutor_user_id);
                      return (
                        <div key={idx} className="p-3 bg-slate-50/50 border border-slate-100 rounded-xl flex justify-between items-center">
                          <div>
                            <p className="text-xs font-extrabold text-slate-450 uppercase tracking-wider">{cls.semester}</p>
                            <p className="text-sm font-bold text-slate-800">{cls.class_name}</p>
                            {tutor && (
                              <p className="text-[10px] font-semibold text-slate-500 mt-1">
                                Login: <span className="font-mono bg-amber-50 px-1 py-0.5 rounded text-amber-800 border border-amber-250/20">{tutor.username}</span> / <span className="font-mono bg-amber-50 px-1 py-0.5 rounded text-amber-800 border border-amber-250/20">{tutor.password || 'staff123'}</span>
                              </p>
                            )}
                          </div>
                          <div>
                            {cls.tutor_user_id ? (
                              <span className="text-xs font-black text-amber-600 bg-amber-50 border border-amber-200/50 px-2.5 py-1 rounded-lg">
                                @{cls.tutor_user_id}
                              </span>
                            ) : (
                              <span className="text-xs font-semibold text-slate-400 italic">No Tutor Assigned</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Staff List directory with subjects */}
                <div className="card p-5">
                  <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-150">
                    <h3 className="font-extrabold text-slate-800 text-sm flex items-center gap-2">
                      <User className="w-5 h-5 text-amber-500" />
                      Staff Directory
                    </h3>
                    <button onClick={openAddStaff} className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5">
                      <UserPlus className="w-4 h-4" /> Add Staff
                    </button>
                  </div>

                  <div className="space-y-3">
                    {staffList.length === 0 ? (
                      <p className="text-xs text-slate-400 py-6 text-center italic">No staff profiles created yet.</p>
                    ) : (
                      staffList?.map((staff, idx) => {
                        const matchedClass = classesList.find(c => c.tutor_user_id === staff.username);
                        // Find workload for this staff
                        const staffNameKey = (staff.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        const wl = staffWorkload[staffNameKey] || null;

                        return (
                          <div key={idx} className="p-3 bg-white border border-slate-200 rounded-xl hover:shadow-sm transition-all hover-lift">
                            <div className="flex justify-between items-start">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center font-black text-amber-700 text-xs flex-shrink-0">
                                  {staff.name ? staff.name.charAt(0).toUpperCase() : 'S'}
                                </div>
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-slate-800 text-xs">{staff.name}</span>
                                    <span className="text-[9px] text-slate-400">@{staff.username}</span>
                                  </div>
                                  <div className="text-[9px] text-slate-500 mt-0.5">
                                    ID: <strong className="text-slate-700">{staff.staff_id || 'N/A'}</strong>
                                    {wl && <> · <strong className="text-amber-700">{wl.hoursPerWeek} hrs/wk</strong></>}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5">
                                {matchedClass && (
                                  <span className="text-[8px] font-extrabold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">
                                    {matchedClass.semester}
                                  </span>
                                )}
                                <button onClick={() => openEditStaff(staff)} className="p-1 rounded text-slate-500 hover:text-amber-500 hover:bg-slate-100 transition-all" title="Edit Staff Profile">
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Subjects handled by this staff */}
                            {wl && wl.subjects.length > 0 && (
                              <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-1">
                                {wl.subjects?.map((sub, si) => (
                                  <span key={si} className="text-[8px] font-bold bg-amber-50 text-amber-700 border border-amber-200/40 px-1.5 py-0.5 rounded-md">
                                    <BookOpen className="w-2.5 h-2.5 inline mr-0.5 -mt-px" />{sub}
                                  </span>
                                ))}
                                {wl.classes.length > 0 && (
                                  <span className="text-[8px] font-semibold text-slate-400 ml-1 self-center">
                                    in {wl.classes.join(', ')}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

            </div>
          </div>
        )}

        {viewSection === 'reports' && (
          <div className="space-y-8 animate-slide-up">
            {/* Same panel as PrincipalDashboard.jsx's 'reports' tab —
                GET /api/v1/analytics/attendance-rate, read-only. */}
            <div className="card p-6 space-y-4">
              <div className="flex justify-between items-center border-b pb-3 border-slate-50">
                <div>
                  <h3 className="font-extrabold text-slate-805 text-sm flex items-center gap-1.5">
                    <Gauge className="w-4 h-4 text-indigo-500" />
                    Attendance Rate by Class
                  </h3>
                  <p className="text-slate-450 text-[10px] font-semibold mt-0.5">
                    All-time, based on marked attendance sessions only.
                  </p>
                </div>
              </div>

              {attendanceRateByClass.length === 0 ? (
                <p className="text-center text-slate-500 font-semibold py-8 text-sm">
                  No attendance has been marked for any class yet.
                </p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th className="text-center">Sessions Marked</th>
                      <th className="text-center">Attendance Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceRateByClass.map((row) => {
                      const rate = row.attendanceRatePercent;
                      const badgeClass = rate === null
                        ? 'badge'
                        : rate < 60 ? 'badge badge-rose' : rate < 75 ? 'badge badge-amber' : 'badge badge-emerald';
                      return (
                        <tr key={row.classId}>
                          <td className="font-bold text-slate-700">{row.className}</td>
                          <td className="text-center">{row.sessionsCount}</td>
                          <td className="text-center">
                            <span className={badgeClass}>{rate === null ? 'No data' : `${rate}%`}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

      </div>
    )}

      </div>



      {/* TIMETABLE REVIEW MODAL */}
      {selectedTimetable && (
        <div className="modal-backdrop">
          <div className="modal-panel w-full max-w-4xl animate-scale-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h2 className="text-lg font-extrabold text-slate-800">Review Uploaded Timetable</h2>
                <p className="text-xs text-slate-450 mt-0.5 font-bold">Class: {selectedTimetable.class_name} · By: @{selectedTimetable.tutor_id}</p>
              </div>
              <button onClick={closeTimetableReview} className="text-slate-500 hover:text-slate-800 text-xl font-bold leading-none">&times;</button>
            </div>

            <div className="p-6 space-y-5 max-h-[65vh] overflow-y-auto">
              
              {/* Compare Timetable data layout */}
              <div>
                <p className="section-title mb-2">Timetable Layout Grid</p>
                {selectedTimetable.pending_timetable_data ? (
                  <div className="card p-4 overflow-x-auto bg-slate-50/50">
                    <table className="w-full text-left border-collapse text-[10px] font-semibold text-slate-655">
                      <thead>
                        <tr className="border-b border-slate-200">
                          {selectedTimetable.pending_timetable_data.headers?.map((header, idx) => (
                            <th key={idx} className="pb-1.5 font-bold text-slate-500 p-2 whitespace-nowrap">{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedTimetable.pending_timetable_data.rows?.map((row, rIdx) => (
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

              {/* Workload Confirmation Section */}
              {selectedTimetable.pending_timetable_data && (
                <div>
                  <p className="section-title mb-2">Workload Assignments Confirmation</p>
                  {(() => {
                    const workload = getWorkloadFromPending(selectedTimetable);
                    // Group workload by staffDisplay
                    const groupedWorkload = {};
                    Object.entries(workload).forEach(([periodKey, details]) => {
                      const staff = details.staffDisplay;
                      if (!groupedWorkload[staff]) {
                        groupedWorkload[staff] = [];
                      }
                      groupedWorkload[staff].push({
                        periodKey,
                        day: periodKey.split('_')[0],
                        hour: periodKey.split('_')[1],
                        subject: details.subject,
                        time: details.time
                      });
                    });

                    if (Object.keys(groupedWorkload).length === 0) {
                      return <p className="text-xs text-slate-450 py-4 italic text-center">No staff workload parsed from timetable cells. Ensure cell format matches: Subject (StaffName).</p>;
                    }

                    return (
                      <div className="card p-4 bg-slate-50/50 space-y-3">
                        <p className="text-[10px] text-slate-500 font-semibold leading-normal">
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
                                    <span className="font-mono text-slate-400">{p.time}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Remarks */}
              <div className="space-y-1">
                <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider block">Timetable Review Remarks</label>
                <textarea rows="3" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Provide feedback or instructions..." className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 focus:outline-none focus:border-amber-500 focus:bg-white text-sm font-semibold transition-all" />
              </div>
            </div>

            <div className="px-6 py-4 flex gap-2 justify-end border-t border-slate-100 bg-slate-50/30">
              <button onClick={closeTimetableReview} className="btn-ghost text-xs" disabled={reviewLoading}>Cancel</button>
              <button onClick={() => handleTimetableReview('Reject')} className="btn-rose text-xs py-1.5 px-3" disabled={reviewLoading}>
                Reject Timetable
              </button>
              <button onClick={() => handleTimetableReview('Forward')} className="btn-outline text-xs py-1.5 px-3 font-bold" disabled={reviewLoading}>
                Forward to Principal
              </button>
              <button onClick={() => handleTimetableReview('Approve')} className="btn-primary text-xs py-1.5 px-3" disabled={reviewLoading}>
                Approve Directly
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE/EDIT STAFF MODAL */}
      {staffModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-panel w-full max-w-lg animate-scale-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h2 className="text-lg font-extrabold text-slate-800">
                  {editingStaff ? 'Edit Staff Profile' : 'Create Staff Profile'}
                </h2>
                <p className="text-xs text-slate-450 mt-0.5 font-bold">Provide academic profile and links</p>
              </div>
              <button onClick={() => setStaffModalOpen(false)} className="text-slate-500 hover:text-slate-800 text-xl font-bold leading-none">&times;</button>
            </div>

            <form onSubmit={handleStaffFormSubmit}>
              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                
                {generatedCreds && (
                  <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 space-y-1 mb-2 animate-pulse">
                    <p className="text-xs font-black uppercase tracking-wider">Account Generated Successfully!</p>
                    <p className="text-xs font-bold">UserID: <strong className="font-mono bg-white px-1.5 py-0.5 rounded text-emerald-700 border border-emerald-100">{generatedCreds.username}</strong></p>
                    <p className="text-xs font-bold">Password: <strong className="font-mono bg-white px-1.5 py-0.5 rounded text-emerald-700 border border-emerald-100">{generatedCreds.password}</strong></p>
                    <p className="text-[10px] text-emerald-600 font-semibold mt-1">Provide these credentials to the staff member so they can log in.</p>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">Full Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      value={staffForm.name} 
                      onChange={e => setStaffForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g. Amit Sharma"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-4 text-slate-800 text-sm font-semibold focus:outline-none focus:border-amber-500 focus:bg-white transition-all"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">Staff ID (Timetable identifier)</label>
                  <div className="relative">
                    <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      value={staffForm.staff_id} 
                      onChange={e => setStaffForm(prev => ({ ...prev, staff_id: e.target.value }))}
                      placeholder="e.g. Dr. Amit"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-4 text-slate-800 text-sm font-semibold focus:outline-none focus:border-amber-500 focus:bg-white transition-all"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">Joined Year</label>
                  <div className="relative">
                    <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      value={staffForm.joined_year} 
                      onChange={e => setStaffForm(prev => ({ ...prev, joined_year: e.target.value }))}
                      placeholder="e.g. 2021"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-4 text-slate-800 text-sm font-semibold focus:outline-none focus:border-amber-500 focus:bg-white transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">AICTE ID</label>
                  <div className="relative">
                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      value={staffForm.aicte_id} 
                      onChange={e => setStaffForm(prev => ({ ...prev, aicte_id: e.target.value }))}
                      placeholder="e.g. AICTE-CSE-01"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-4 text-slate-800 text-sm font-semibold focus:outline-none focus:border-amber-500 focus:bg-white transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">Phone Number</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      value={staffForm.phone_number} 
                      onChange={e => setStaffForm(prev => ({ ...prev, phone_number: e.target.value }))}
                      placeholder="e.g. 9876543210"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-4 text-slate-800 text-sm font-semibold focus:outline-none focus:border-amber-500 focus:bg-white transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">Assign Class Tutor Semester</label>
                  <select 
                    value={staffForm.linked_semester}
                    onChange={e => setStaffForm(prev => ({ ...prev, linked_semester: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-slate-800 text-sm font-semibold focus:outline-none focus:border-amber-500 focus:bg-white transition-all"
                  >
                    <option value="None">None / Secondary Tutor</option>
                    <option value="3rd Sem">3rd Sem</option>
                    <option value="4th Sem">4th Sem</option>
                    <option value="5th Sem">5th Sem</option>
                    <option value="6th Sem">6th Sem</option>
                  </select>
                </div>

              </div>

              <div className="px-6 py-4 flex gap-2 justify-end border-t border-slate-100 bg-slate-50/30">
                <button type="button" onClick={() => setStaffModalOpen(false)} className="btn-ghost text-xs" disabled={reviewLoading}>
                  {generatedCreds ? 'Close' : 'Cancel'}
                </button>
                {!generatedCreds && (
                  <button type="submit" className="btn-primary text-xs py-1.5 px-4" disabled={reviewLoading}>
                    {reviewLoading ? 'Saving...' : 'Save Staff Profile'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </SidebarLayout>
  );
}
