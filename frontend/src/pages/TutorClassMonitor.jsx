import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import SidebarLayout from '../components/SidebarLayout';
import { useToast, useAuth } from '../App';
import CsvExportModal from '../components/CsvExportModal';
import LowAttendanceModal from '../components/LowAttendanceModal';
import {
  Users, ChevronDown, ChevronRight, BookOpen, Phone, UserCheck,
  Activity, TrendingDown, AlertTriangle, Link2, ExternalLink,
  CalendarDays, ImageIcon, Shield, Car, Download, Eye, RefreshCw,
  GraduationCap, BarChart3
} from 'lucide-react';

// Static fallback data for offline mode
const FALLBACK_TUTORS = [
  {
    tutor_id: 'staff_cse',
    department: 'CSE',
    class_name: '2nd Year 4th Sem',
    student_group_link: 'https://chat.whatsapp.com/demo_group_1',
    parent_group_link: 'https://chat.whatsapp.com/demo_parent_1',
    timetable_path: '',
    present_today: 38,
    present_this_hour: 35,
    students: [
      { _id: 'fb1', name: 'Aarav Sharma', roll_number: 'CS21001', phone: '9876543210', attendance: 82, parent_name: 'Devendra Sharma', vehicle_number: 'TN 09 AB 1234' },
      { _id: 'fb2', name: 'Priya Menon', roll_number: 'CS21002', phone: '9876500011', attendance: 63, parent_name: 'Ravi Menon', vehicle_number: '' },
      { _id: 'fb3', name: 'Karthik Raj', roll_number: 'CS21003', phone: '9123456789', attendance: 91, parent_name: 'Mohan Raj', vehicle_number: 'TN 22 CD 5678' },
      { _id: 'fb4', name: 'Divya Lakshmi', roll_number: 'CS21004', phone: '9988776655', attendance: 57, parent_name: 'Srinivasan K', vehicle_number: '' },
    ]
  },
  {
    tutor_id: 'staff_it',
    department: 'IT',
    class_name: '3rd Year 6th Sem',
    student_group_link: '',
    parent_group_link: '',
    timetable_path: '',
    present_today: 42,
    present_this_hour: 40,
    students: [
      { _id: 'fb5', name: 'Raj Kumar', roll_number: 'IT20001', phone: '9012345678', attendance: 78, parent_name: 'Ganesh R', vehicle_number: 'TN 45 EF 9012' },
      { _id: 'fb6', name: 'Nisha Patel', roll_number: 'IT20002', phone: '9123009876', attendance: 66, parent_name: 'Yogesh Patel', vehicle_number: '' },
    ]
  }
];

// Mini stat card
function MiniStat({ label, value, color }) {
  return (
    <div className={`bg-white/50 rounded-xl px-4 py-3 border-l-4 ${color}`}>
      <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">{label}</p>
      <p className="text-xl font-black text-indigo-950">{value}</p>
    </div>
  );
}

// Individual Tutor Class Card (expandable)
function TutorClassCard({ tutorData, userRole }) {
  const [expanded, setExpanded] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [lowAttOpen, setLowAttOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [attFilter, setAttFilter] = useState('all');
  
  const { showToast } = useToast();

  const { students = [] } = tutorData;
  
  const filteredStudents = students.filter(s => {
    const matchesSearch = !searchQuery ||
      (s.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.roll_number || '').toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (attFilter === 'low' && (s.attendance || 0) >= 75) return false;
    if (attFilter === 'critical' && (s.attendance || 0) >= 70) return false;
    if (attFilter === 'high' && (s.attendance || 0) < 85) return false;
    return true;
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
      const att = s.attendance || 0;
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
    
    const safeClassName = (tutorData.class_name || 'Class').replace(/\s+/g, '_');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${safeClassName}_students_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalStudents = students.length;
  const avgAtt = totalStudents > 0
    ? Math.round(students.reduce((a, s) => a + (s.attendance || 0), 0) / totalStudents)
    : 0;
  const lowAttStudents = students.filter(s => (s.attendance || 0) < 75);

  return (
    <div className="glass-panel overflow-hidden hover:shadow-lg transition-shadow">
      {/* Card Header - always visible */}
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 cursor-pointer"
        onClick={() => setExpanded(p => !p)}
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <GraduationCap className="w-6 h-6 text-primary" />
          </div>
          <div>
            <div className="font-extrabold text-indigo-950 text-lg">{tutorData.class_name || 'Unknown Class'}</div>
            <div className="text-xs text-indigo-400 font-medium">
              Tutor: <Link to={`/profile/${tutorData.tutor_id}`} onClick={e => e.stopPropagation()} className="font-bold text-indigo-600 hover:text-amber-500 transition-colors">{tutorData.tutor_id}</Link>
              &nbsp;·&nbsp;Dept: <span className="font-bold">{tutorData.department}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex gap-3">
            <div className="text-center">
              <div className="text-lg font-black text-indigo-950">{totalStudents}</div>
              <div className="text-[10px] text-indigo-400 font-bold uppercase">Students</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-black ${avgAtt < 75 ? 'text-red-500' : 'text-emerald-600'}`}>{avgAtt}%</div>
              <div className="text-[10px] text-indigo-400 font-bold uppercase">Avg Att.</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-black text-violet-600">{tutorData.present_today}</div>
              <div className="text-[10px] text-indigo-400 font-bold uppercase">Today</div>
            </div>
          </div>

          {lowAttStudents.length > 0 && (
            <span
              onClick={e => { e.stopPropagation(); setLowAttOpen(true); }}
              className="bg-red-100 text-red-600 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 cursor-pointer hover:bg-red-200 transition-colors"
            >
              <AlertTriangle className="w-3 h-3" />
              {lowAttStudents.length} Low Att.
            </span>
          )}

          {expanded ? (
            <ChevronDown className="w-5 h-5 text-indigo-400" />
          ) : (
            <ChevronRight className="w-5 h-5 text-indigo-400" />
          )}
        </div>
      </div>

      {/* Expanded Detail Section */}
      {expanded && (
        <div className="border-t border-indigo-100 p-5 space-y-5 bg-white/20">

          {/* Stats Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MiniStat label="Total Students" value={totalStudents} color="border-l-indigo-500" />
            <MiniStat label="Present Today" value={tutorData.present_today} color="border-l-emerald-500" />
            <MiniStat label="This Hour" value={tutorData.present_this_hour} color="border-l-violet-500" />
            <MiniStat label={`Avg Attendance`} value={`${avgAtt}%`} color={avgAtt < 75 ? 'border-l-red-500' : 'border-l-teal-500'} />
          </div>

          {/* Timetable Grid Schedule */}
          <div>
            <p className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <CalendarDays className="w-3.5 h-3.5" /> Class Timetable
            </p>
            {tutorData.timetable_data ? (
              <div className="overflow-x-auto rounded-xl border border-indigo-100/50 bg-white/40 p-4">
                <table className="w-full text-left border-collapse text-[10px] font-medium text-slate-600">
                  <thead>
                    <tr className="border-b border-indigo-100">
                      {tutorData.timetable_data.headers.map((header, idx) => (
                        <th key={idx} className="pb-2 font-bold text-indigo-500 p-1.5 whitespace-nowrap">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tutorData.timetable_data.rows.map((row, rIdx) => {
                      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                      const currentDayName = days[new Date().getDay()];
                      const isTodayRow = currentDayName.toLowerCase() === row[0].toLowerCase();
                      
                      // Check for active period
                      const now = new Date();
                      const currentMinutes = now.getHours() * 60 + now.getMinutes();
                      
                      return (
                        <tr key={rIdx} className={`border-b border-indigo-50/50 hover:bg-white/20 transition-colors ${isTodayRow ? 'bg-indigo-500/5 font-semibold text-indigo-950' : ''}`}>
                          {row.map((cell, cIdx) => {
                            let isActiveCell = false;
                            if (isTodayRow && cIdx > 0) {
                              const header = tutorData.timetable_data.headers[cIdx];
                              const timeMatch = header.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
                              if (timeMatch) {
                                const startMin = parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
                                const endMin = parseInt(timeMatch[3]) * 60 + parseInt(timeMatch[4]);
                                if (currentMinutes >= startMin && currentMinutes < endMin) {
                                  isActiveCell = true;
                                }
                              }
                            }
                            return (
                              <td key={cIdx} className={`p-1.5 ${cIdx === 0 ? 'font-bold text-indigo-800' : 'text-slate-600'} ${isActiveCell ? 'bg-indigo-500/20 text-indigo-700 font-extrabold rounded' : ''}`}>
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
              <div className="flex items-center gap-2 text-indigo-300 text-sm font-medium p-3 bg-white/30 rounded-xl border border-dashed border-indigo-100">
                <ImageIcon className="w-4 h-4" />
                No timetable uploaded
              </div>
            )}
          </div>

          {/* Student Table */}
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-3 border-b border-indigo-50/50 pb-3">
              <p className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1">
                <BookOpen className="w-3.5 h-3.5" /> Students Live Monitor ({filteredStudents.length})
              </p>
              <div className="flex gap-2 flex-wrap items-center">
                {/* Search */}
                <input 
                  type="text" 
                  placeholder="Search name, roll..." 
                  value={searchQuery} 
                  onChange={e => setSearchQuery(e.target.value)} 
                  className="px-2.5 py-1 text-xs w-36 rounded-lg border border-indigo-200/60 bg-white"
                  onClick={e => e.stopPropagation()}
                />
                {/* Attendance Filter */}
                <select 
                  value={attFilter} 
                  onChange={e => setAttFilter(e.target.value)}
                  className="px-2.5 py-1 text-xs rounded-lg border border-indigo-200/60 bg-white"
                  onClick={e => e.stopPropagation()}
                >
                  <option value="all">All Attendance</option>
                  <option value="low">Low (&lt;75%)</option>
                  <option value="critical">Critical (&lt;70%)</option>
                  <option value="high">High (&ge;85%)</option>
                </select>
                {/* Export CSV button */}
                <button
                  onClick={e => { e.stopPropagation(); handleExportCSV(); }}
                  className="btn-outline text-xs px-2.5 py-1 flex items-center gap-1.5"
                >
                  <Download className="w-3 h-3" /> Export CSV
                </button>
              </div>
            </div>

            {filteredStudents.length === 0 ? (
              <div className="text-center text-indigo-300 text-sm py-6">No students match the search/filter criteria.</div>
            ) : (
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-xs min-w-[500px]">
                  <thead>
                    <tr className="border-b border-indigo-100">
                      <th className="text-left py-2 px-3 font-extrabold text-indigo-400 uppercase tracking-wider">#</th>
                      <th className="text-left py-2 px-3 font-extrabold text-indigo-400 uppercase tracking-wider">Name / Roll</th>
                      <th className="text-left py-2 px-3 font-extrabold text-indigo-400 uppercase tracking-wider">Entry Type</th>
                      <th className="text-left py-2 px-3 font-extrabold text-indigo-400 uppercase tracking-wider">Contact</th>
                      <th className="text-left py-2 px-3 font-extrabold text-indigo-400 uppercase tracking-wider">Parent</th>
                      <th className="text-center py-2 px-3 font-extrabold text-indigo-400 uppercase tracking-wider">Att.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((s, i) => {
                      const att = s.attendance || 0;
                      const attColor = att < 65 ? 'text-red-600 bg-red-50' : att < 75 ? 'text-amber-600 bg-amber-50' : 'text-emerald-600 bg-emerald-50';
                      const entry = s.entry_type || 'Regular';
                      const entryColor = entry === 'Lateral Entry' ? 'text-amber-700 bg-amber-50 border border-amber-100' : 'text-slate-600 bg-slate-50 border border-slate-100';
                      return (
                        <tr key={s._id} className="border-b border-indigo-50 hover:bg-white/40 transition-colors">
                          <td className="py-2.5 px-3 text-indigo-300 font-bold">{i + 1}</td>
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-indigo-950">{s.name}</div>
                            <div className="font-mono text-indigo-400">{s.roll_number}</div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${entryColor}`}>{entry}</span>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-1 text-indigo-600">
                              <Phone className="w-3 h-3" />
                              {s.phone || '—'}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="text-indigo-700 font-semibold">{s.parent_name || '—'}</div>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`font-extrabold px-2 py-0.5 rounded-full ${attColor}`}>{att}%</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {lowAttOpen && (
        <LowAttendanceModal
          students={lowAttStudents}
          onClose={() => setLowAttOpen(false)}
        />
      )}
    </div>
  );
}

export default function TutorClassMonitor() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [tutors, setTutors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);
  const [filterDept, setFilterDept] = useState('All');
  const [lowAttGlobal, setLowAttGlobal] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/monitor/tutor-classes');
      if (res.ok) {
        const data = await res.json();
        // Normalize student field names
        const normalized = (data.tutors_data || []).map(t => ({
          ...t,
          students: (t.students || []).map(s => ({
            ...s,
            name: s.name || s.full_name || '',
            roll_number: s.roll_number || s.roll_no || '',
            entry_type: s.entry_type || 'Regular',
            attendance: s.attendance || parseInt(s.sem2_attendance) || parseInt(s.sem1_attendance) || 0,
          }))
        }));
        setTutors(normalized);
        setIsFallback(false);
      } else {
        throw new Error('API error');
      }
    } catch (err) {
      console.warn('API unavailable, using fallback data', err);
      setTutors(FALLBACK_TUTORS);
      setIsFallback(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Aggregate stats
  const totalStudents = tutors.reduce((a, t) => a + (t.students?.length || 0), 0);
  const totalPresent = tutors.reduce((a, t) => a + (t.present_today || 0), 0);
  const allStudents = tutors.flatMap(t => t.students || []);
  const globalAvgAtt = allStudents.length > 0
    ? Math.round(allStudents.reduce((a, s) => a + (s.attendance || 0), 0) / allStudents.length)
    : 0;
  const globalLowAtt = allStudents.filter(s => (s.attendance || 0) < 75);

  // Departments for filter (HOD sees only their dept, principal sees all)
  const departments = ['All', ...new Set(tutors.map(t => t.department).filter(Boolean))];
  const filteredTutors = filterDept === 'All'
    ? tutors
    : tutors.filter(t => t.department === filterDept);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F7F9FC]">
        <Header />
        <div className="flex items-center justify-center h-64">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
            <span className="text-indigo-650 font-bold text-sm">Loading tutor class data...</span>
          </div>
        </div>
      </div>
    );
  }

  const menuItems = user?.role === 'principal' ? [
    { id: 'dashboard', label: 'Dashboard Hub', icon: BarChart3, path: '/dashboard/principal' }
  ] : [
    { id: 'dashboard', label: 'Dashboard Hub', icon: BarChart3, path: '/dashboard/hod' },
    { id: 'monitor', label: 'Class Monitor', icon: Users }
  ];

  return (
    <SidebarLayout
      activeTab="monitor"
      onTabChange={() => {}}
      menuItems={menuItems}
      roleLabel={`${user?.role?.toUpperCase()} · Monitor`}
    >
      <div className="space-y-6">
        {isFallback && (
          <div className="bg-indigo-600 text-white text-xs font-bold text-center py-1.5 shadow-sm rounded-xl mb-4">
            ⚡ Offline Mode — Showing demo data. Connect to network and refresh.
          </div>
        )}

        {/* Page Title */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-indigo-950 tracking-tight">
              Tutor Class Monitor
            </h1>
            <p className="text-sm text-indigo-400 font-medium mt-0.5">
              {user?.role === 'hod' ? `HOD Overview · ${user?.department}` : 'Principal Overview · All Departments'}
            </p>
          </div>
          <button
            onClick={fetchData}
            className="btn-outline flex items-center gap-2"
            title="Refresh data"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        {/* Global Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="glass-panel p-5 flex items-center gap-4 border-l-4 border-l-indigo-500">
            <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <Users className="w-6 h-6 text-indigo-500" />
            </div>
            <div>
              <p className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Total Students</p>
              <p className="text-2xl font-black text-indigo-950">{totalStudents}</p>
            </div>
          </div>

          <div className="glass-panel p-5 flex items-center gap-4 border-l-4 border-l-emerald-500">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <UserCheck className="w-6 h-6 text-emerald-500" />
            </div>
            <div>
              <p className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Present Today</p>
              <p className="text-2xl font-black text-indigo-950">{totalPresent}</p>
            </div>
          </div>

          <div className="glass-panel p-5 flex items-center gap-4 border-l-4 border-l-violet-500">
            <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-6 h-6 text-violet-500" />
            </div>
            <div>
              <p className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Classes Active</p>
              <p className="text-2xl font-black text-indigo-950">{tutors.length}</p>
            </div>
          </div>

          <div
            className={`glass-panel p-5 flex items-center gap-4 border-l-4 ${globalAvgAtt < 75 ? 'border-l-red-500' : 'border-l-teal-500'} cursor-pointer hover:shadow-lg transition-shadow`}
            onClick={() => globalLowAtt.length > 0 && setLowAttGlobal(true)}
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${globalAvgAtt < 75 ? 'bg-red-100' : 'bg-teal-100'}`}>
              <BarChart3 className={`w-6 h-6 ${globalAvgAtt < 75 ? 'text-red-500' : 'text-teal-500'}`} />
            </div>
            <div>
              <p className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Global Avg Att.</p>
              <p className="text-2xl font-black text-indigo-950">{globalAvgAtt}%</p>
              {globalLowAtt.length > 0 && (
                <p className="text-xs text-red-500 font-bold">{globalLowAtt.length} students below 75%</p>
              )}
            </div>
          </div>
        </div>

        {/* Department Filter (Principal only) */}
        {user?.role === 'principal' && departments.length > 2 && (
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Filter by Dept:</span>
            <div className="flex gap-2 flex-wrap">
              {departments.map(dept => (
                <button
                  key={dept}
                  onClick={() => setFilterDept(dept)}
                  className={`text-xs font-bold px-3 py-1.5 rounded-full border transition-all ${
                    filterDept === dept
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white/50 text-indigo-600 border-indigo-200 hover:border-primary'
                  }`}
                >
                  {dept}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tutor Class Cards */}
        <div className="space-y-5">
          {filteredTutors.length === 0 ? (
            <div className="glass-panel p-10 text-center text-indigo-300 font-semibold">
              No tutor class data found.
            </div>
          ) : (
            filteredTutors.map(tutorData => (
              <TutorClassCard
                key={tutorData.tutor_id}
                tutorData={tutorData}
                userRole={user?.role}
              />
            ))
          )}
        </div>
      </div>

      {/* Global Low Attendance Modal */}
      {lowAttGlobal && (
        <LowAttendanceModal
          students={globalLowAtt}
          onClose={() => setLowAttGlobal(false)}
        />
      )}
    </SidebarLayout>
  );
}
