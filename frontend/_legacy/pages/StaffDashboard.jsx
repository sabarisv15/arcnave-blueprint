import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Header from '../components/Header';
import SidebarLayout from '../components/SidebarLayout';
import { useToast, useAuth } from '../App';
import { FileUp, Plus, Trash2, ArrowRight, ShieldAlert, Sparkles, Clock, CheckCircle, XCircle, CalendarDays, BookOpen, Users, UserCheck, AlertTriangle } from 'lucide-react';

export default function StaffDashboard() {
  const { showToast } = useToast();
  const { user, accessToken } = useAuth();
  const navigate = useNavigate();

  const [submissions, setSubmissions] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Form State
  const [studentName, setStudentName] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [semester, setSemester] = useState('3rd Semester');
  const [department, setDepartment] = useState('');
  const [marks, setMarks] = useState([{ subject: '', marks: '', max_marks: 100, grade: '' }]);
  const [totalMarks, setTotalMarks] = useState('');
  const [gpa, setGpa] = useState('');
  const [marksheetFilename, setMarksheetFilename] = useState('');

  // Teaching Schedule State
  const [schedule, setSchedule] = useState([]);
  const [loadingSchedule, setLoadingSchedule] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [absentRolls, setAbsentRolls] = useState([]);
  const [submittingAttendance, setSubmittingAttendance] = useState(false);

  // Workload and Notification state
  const [workloadData, setWorkloadData] = useState({
    total_approved_hours: 0,
    total_tentative_hours: 0,
    approved_workload: [],
    tentative_workload: [],
    notifications: []
  });
  const [loadingWorkload, setLoadingWorkload] = useState(true);

  // Fetch submissions history
  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/submissions');
      if (res.ok) {
        const data = await res.json();
        setSubmissions(data.submissions || []);
      }
    } catch (err) {
      console.error('Failed to load submissions history', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Fetch teaching schedule
  const fetchSchedule = async () => {
    try {
      const res = await fetch('/api/staff/my-schedule');
      if (res.ok) {
        const data = await res.json();
        setSchedule(data.schedule || []);
      }
    } catch (err) {
      console.error('Failed to load teaching schedule', err);
    } finally {
      setLoadingSchedule(false);
    }
  };

  // Fetch teaching workload
  const fetchWorkload = async () => {
    try {
      const res = await fetch('/api/staff/workload');
      if (res.ok) {
        const data = await res.json();
        setWorkloadData(data);
      }
    } catch (err) {
      console.error('Failed to load teaching workload', err);
    } finally {
      setLoadingWorkload(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    fetchSchedule();
    fetchWorkload();
    if (user) {
      setDepartment(user.department || 'CSE');
    }
  }, [user]);

  const isPeriodLive = (p) => {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    return currentMinutes >= p.startMin && currentMinutes < p.endMin;
  };

  const startMarkingAttendance = (period) => {
    setSelectedPeriod(period);
    if (period.already_marked && period.period_record) {
      setAbsentRolls(period.period_record.absent_rolls || []);
    } else {
      setAbsentRolls([]);
    }
  };

  // Repointed to the real API (routes/attendance.js,
  // POST /api/v1/attendance) -- the actual grounding source for
  // attendance_sessions (see attendanceService.js's own .ai/TASK.md
  // history: this exact flow, not TutorClass.jsx's aggregate
  // present_today/present_this_hour counter, is what the real
  // per-period, per-student attendance_sessions shape was modeled on
  // -- TutorClass.jsx's own counter is left untouched here, on
  // purpose, it was never the grounding source and isn't becoming one
  // now).
  //
  // Two real field-shape changes, following the exact tutor_id ->
  // class_id / free-text -> real-id renames Module 3's own UI slice
  // (dbe8380) already made elsewhere: class_id replaces the
  // prototype's tutor_id (a username string) -- the real backend
  // identifies a class by its own id, never by its tutor's username.
  // absent_student_ids replaces absent_rolls, since the real
  // attendance_sessions.absent_student_ids column expects real
  // students.id UUIDs, not roll-number strings.
  //
  // Both source values are still blocked, not fixed here:
  // GET /api/staff/my-schedule (selectedPeriod's own source, fetched
  // by fetchSchedule above) is a separate, still-unrepointed prototype
  // endpoint that doesn't exist in the Node backend either -- it
  // 404s today exactly like /api/hod/classes did before Module 3's
  // own UI slice, so `schedule` never populates and this whole panel's
  // "Mark Attendance" button is already unreachable dead code in the
  // real app right now, the same starting state classesList was in
  // before dbe8380. selectedPeriod.class_id and each absent entry's
  // real student id don't exist in that endpoint's still-prototype
  // response shape (it only ever returned tutor_id and
  // roll_number-keyed students) -- repointing this POST call carries
  // no behavior risk today (nothing currently renders this panel with
  // real data either way), and leaves the least remaining work for
  // whichever future slice repoints GET /api/staff/my-schedule (or
  // builds a real "my schedule" equivalent, e.g. over
  // academicService.listFacultyAllocationsForStaff) to actually supply
  // them. selectedPeriod.total_students needed no rename or new
  // source -- it already exists on the current (still-prototype)
  // schedule shape, and the real API needs exactly that field too.
  const handleMarkPeriodAttendance = async () => {
    if (!selectedPeriod) return;
    setSubmittingAttendance(true);
    try {
      const res = await fetch('/api/v1/attendance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          class_id: selectedPeriod.class_id,
          session_date: selectedPeriod.periodKey.split('_')[0],
          hour_index: selectedPeriod.hour_index,
          absent_student_ids: absentRolls,
          total_students: selectedPeriod.total_students,
        })
      });
      if (res.ok) {
        showToast(`Attendance marked successfully for ${selectedPeriod.class_name}!`, 'success');
        setSelectedPeriod(null);
        fetchSchedule();
      } else {
        const errData = await res.json();
        showToast(errData.detail || 'Failed to mark attendance', 'danger');
      }
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setSubmittingAttendance(false);
    }
  };

  // Handle Marksheet AI Extraction Upload
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    showToast('AI is extracting grades from marksheet...', 'warning');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        throw new Error('AI extraction failed');
      }

      const data = await res.json();
      
      // Auto fill form fields
      setStudentName(data.student_name || '');
      setRollNumber(data.roll_number || '');
      if (data.semester) setSemester(data.semester);
      setMarks(data.subjects && data.subjects.length > 0 ? data.subjects : [{ subject: '', marks: '', max_marks: 100, grade: '' }]);
      setTotalMarks(data.total_marks || '');
      setGpa(data.gpa || '');
      setMarksheetFilename(data.filename || '');

      showToast('✨ Marksheet parsed successfully by Gemini AI!', 'success');
    } catch (err) {
      console.error(err);
      showToast('Gemini extraction failed. Swapped to manual entry.', 'danger');
    } finally {
      setUploading(false);
    }
  };

  // Add Subject Row
  const addSubjectRow = () => {
    setMarks([...marks, { subject: '', marks: '', max_marks: 100, grade: '' }]);
  };

  // Remove Subject Row
  const removeSubjectRow = (index) => {
    if (marks.length === 1) return;
    const list = [...marks];
    list.splice(index, 1);
    setMarks(list);
  };

  // Handle Marks Array Field Changes
  const handleMarkChange = (index, field, value) => {
    const list = [...marks];
    list[index][field] = value;
    setMarks(list);

    // Auto calculate total marks
    if (field === 'marks') {
      const total = list.reduce((acc, item) => acc + (parseFloat(item.marks) || 0), 0);
      setTotalMarks(total);
    }
  };

  // Form Submit Action
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!studentName || !rollNumber) {
      showToast('Student name and roll number are required', 'danger');
      return;
    }

    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_name: studentName,
          roll_number: rollNumber,
          semester,
          department,
          marks,
          total_marks: totalMarks || 0,
          gpa: gpa || 0,
          marksheet_filename: marksheetFilename
        })
      });

      if (!res.ok) {
        throw new Error('Failed to submit');
      }

      showToast('Submission uploaded successfully!', 'success');
      
      // Clear form
      setStudentName('');
      setRollNumber('');
      setMarks([{ subject: '', marks: '', max_marks: 100, grade: '' }]);
      setTotalMarks('');
      setGpa('');
      setMarksheetFilename('');

      // Refresh list
      fetchHistory();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  const getStatusBadge = (status, sub) => {
    switch (status) {
      case 'Approved':
        return (
          <span className="bg-emerald-100 border border-emerald-200 text-emerald-700 text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 w-fit">
            <CheckCircle className="w-3.5 h-3.5" /> Approved
          </span>
        );
      case 'Rejected':
        return (
          <span 
            className="bg-red-100 border border-red-200 text-red-700 text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 w-fit cursor-help"
            title={`HOD Remarks: ${sub.hod_remarks || 'None'}\nPrincipal Remarks: ${sub.principal_remarks || 'None'}`}
          >
            <XCircle className="w-3.5 h-3.5" /> Rejected
          </span>
        );
      case 'Pending Principal':
        return (
          <span className="bg-amber-100 border border-amber-200 text-amber-700 text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 w-fit">
            <Clock className="w-3.5 h-3.5" /> Pending Principal
          </span>
        );
      default:
        return (
          <span className="bg-blue-100 border border-blue-200 text-blue-700 text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 w-fit">
            <Clock className="w-3.5 h-3.5" /> Pending HOD
          </span>
        );
    }
  };

  const menuItems = [
    { id: 'class', label: 'My Class', icon: Users, path: '/dashboard/staff/tutor-class' },
    { id: 'marksheet', label: 'Marksheet Submission', icon: FileUp }
  ];

  return (
    <SidebarLayout
      activeTab="marksheet"
      onTabChange={() => {}}
      menuItems={menuItems}
      roleLabel={`Staff · ${user?.department || 'Dept'}`}
    >
      <div className="space-y-6">
        
        {/* Tutor Class Switch Card Banner */}
        <div className="glass-panel p-6 mb-8 border-l-4 border-l-primary flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-xl font-extrabold text-indigo-950">Unified Class Tutor Workspace</h2>
            <p className="text-sm text-indigo-500 font-medium">Click the link to manage the student roster, vehicle numbers, driving licenses, and WhatsApp groups.</p>
          </div>
          <Link to="/dashboard/staff/tutor-class" className="btn-primary">
            <span>Go to Tutor Class Dashboard</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* NEW TIMETABLE NOTIFICATIONS */}
        {!loadingWorkload && workloadData.notifications && workloadData.notifications.length > 0 && (
          <div className="space-y-3 mb-8">
            {workloadData.notifications.map((notif, idx) => (
              <div key={idx} className="p-4 bg-amber-50 border border-amber-250 rounded-2xl flex items-start gap-3 shadow-sm animate-slide-up">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="flex-grow">
                  <h4 className="text-xs font-black text-amber-950">New Timetable Assignment Alert</h4>
                  <p className="text-[11px] text-amber-750 font-semibold mt-1 leading-relaxed">{notif.message}</p>
                </div>
                <Link
                  to="/profile"
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl self-center whitespace-nowrap shadow-sm shadow-amber-500/10 cursor-pointer"
                >
                  View Details
                </Link>
              </div>
            ))}
          </div>
        )}

        {/* SECTION: TODAY'S TEACHING SCHEDULE & ATTENDANCE */}
        <section className="glass-panel p-6 mb-8 border-l-4 border-l-primary">
          <h2 className="text-xl font-extrabold text-indigo-950 mb-4 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary animate-pulse" />
            <span>Today's Teaching Schedule & Attendance</span>
          </h2>
          
          {loadingSchedule ? (
            <div className="text-center py-6 text-indigo-400">
              <Clock className="w-6 h-6 animate-spin mx-auto mb-2" />
              <span>Loading schedule...</span>
            </div>
          ) : schedule.length === 0 ? (
            <div className="text-center py-8 bg-white/20 rounded-xl border border-dashed border-indigo-150">
              <CalendarDays className="w-8 h-8 mx-auto mb-2 text-indigo-300" />
              <p className="text-sm font-semibold text-indigo-950">No teaching sessions scheduled for you today.</p>
              <p className="text-xs text-indigo-400 mt-1">If your schedule is missing, ensure the Class Tutor has uploaded the timetable and it is approved by HOD.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {schedule.map((p, idx) => {
                const isLive = isPeriodLive(p);
                return (
                  <div key={idx} className={`p-5 rounded-2xl border transition-all ${
                    p.already_marked 
                      ? 'bg-emerald-50/40 border-emerald-150/40' 
                      : isLive 
                        ? 'bg-amber-50/40 border-amber-250/50 shadow-md ring-1 ring-amber-250/20' 
                        : 'bg-white/40 border-indigo-100/50'
                  }`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-500">{p.hour} ({p.time})</span>
                        <h3 className="font-extrabold text-indigo-950 text-base mt-0.5">{p.class_name}</h3>
                      </div>
                      {p.already_marked ? (
                        <span className="badge badge-emerald flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5" /> Marked</span>
                      ) : isLive ? (
                        <span className="badge badge-amber flex items-center gap-1.5 animate-pulse"><Clock className="w-3.5 h-3.5" /> Live Now</span>
                      ) : (
                        <span className="badge badge-slate">Scheduled</span>
                      )}
                    </div>
                    
                    <div className="mt-3 p-3 bg-white/50 border border-indigo-50/50 rounded-xl space-y-1">
                      <p className="text-xs text-indigo-500 font-semibold">Subject: <strong className="text-indigo-950 font-extrabold">{p.subject}</strong></p>
                      <p className="text-xs text-indigo-500 font-semibold">Display: <strong className="text-indigo-950">{p.staffDisplay}</strong></p>
                      {p.already_marked && p.period_record && (
                        <p className="text-xs text-emerald-700 font-semibold mt-1">
                          Present: <strong className="text-emerald-950">{p.period_record.present}/{p.period_record.total}</strong>
                        </p>
                      )}
                    </div>

                    <div className="mt-4">
                      <button
                        onClick={() => startMarkingAttendance(p)}
                        className={`w-full text-xs py-2 px-3 rounded-lg font-bold transition-all text-center ${
                          p.already_marked
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : isLive
                              ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm'
                              : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                        }`}
                      >
                        {p.already_marked ? 'Update Attendance' : 'Mark Attendance'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* SECTION: PERSONAL WORKLOAD TIMETABLE */}
        <section className="glass-panel p-6 mb-8 border-l-4 border-l-primary">
          <h2 className="text-xl font-extrabold text-indigo-950 mb-2 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            <span>Weekly Teaching Workload & Schedule</span>
            <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded ml-auto">
              Total Approved Hours: {workloadData.total_approved_hours} hrs/week
            </span>
          </h2>
          <p className="text-xs text-slate-500 font-semibold mb-6">
            Detailed matrix view of your teaching commitments across all departments. Tentative hours from newly uploaded timetables are highlighted in orange.
          </p>

          {loadingWorkload ? (
            <div className="text-center py-6 text-indigo-400">
              <Clock className="w-6 h-6 animate-spin mx-auto mb-2" />
              <span>Loading workload data...</span>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200/40 bg-white/10">
              <table className="min-w-full divide-y divide-slate-150">
                <thead>
                  <tr className="bg-white/20">
                    <th className="px-4 py-3 text-left text-xs font-extrabold text-slate-400 uppercase tracking-wider w-24">Day</th>
                    {['Hour 1', 'Hour 2', 'Hour 3', 'Hour 4', 'Hour 5', 'Hour 6', 'Hour 7'].map((hr, idx) => (
                      <th key={idx} className="px-4 py-3 text-center text-xs font-extrabold text-slate-400 uppercase tracking-wider">{hr}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-150">
                  {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((day) => (
                    <tr key={day} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-4 text-xs font-black text-slate-800 bg-slate-50/50 w-24 border-r border-slate-150">{day}</td>
                      {[1, 2, 3, 4, 5, 6, 7].map((hourNum) => {
                        const hrKey = `Hour ${hourNum}`;
                        // Find approved slot
                        const approvedSlot = workloadData.approved_workload.find(
                          item => item.day.toLowerCase() === day.toLowerCase() && item.hour.toLowerCase() === hrKey.toLowerCase()
                        );
                        // Find tentative slot (if no approved slot)
                        const tentativeSlot = workloadData.tentative_workload.find(
                          item => item.day.toLowerCase() === day.toLowerCase() && item.hour.toLowerCase() === hrKey.toLowerCase()
                        );

                        return (
                          <td key={hourNum} className="px-2 py-3 text-center border-r border-slate-150 last:border-r-0 min-w-28">
                            {approvedSlot ? (
                              <div className="p-2 rounded-xl bg-indigo-50 border border-indigo-150 text-left space-y-0.5">
                                <span className="text-[10px] font-black text-indigo-950 block truncate" title={approvedSlot.subject}>{approvedSlot.subject}</span>
                                <span className="text-[9px] font-bold text-indigo-500 block truncate">{approvedSlot.class_name}</span>
                                <span className="inline-block text-[8px] font-extrabold text-emerald-600 bg-emerald-50 px-1 py-0.2 rounded border border-emerald-100 uppercase tracking-wider">Approved</span>
                              </div>
                            ) : tentativeSlot ? (
                              <div className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-left space-y-0.5 relative overflow-hidden">
                                <span className="text-[10px] font-black text-amber-950 block truncate" title={tentativeSlot.subject}>{tentativeSlot.subject}</span>
                                <span className="text-[9px] font-bold text-amber-600 block truncate">{tentativeSlot.class_name}</span>
                                <span className="inline-block text-[8px] font-extrabold text-amber-700 bg-amber-100/50 px-1 py-0.2 rounded border border-amber-200/50 uppercase tracking-wider">Tentative</span>
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-350 italic font-medium">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>


        {/* ATTENDANCE MARKING PANEL */}
        {selectedPeriod && (
          <div className="glass-panel p-6 mb-8 border-l-4 border-l-amber-500 animate-slide-up">
            <div className="flex justify-between items-start border-b pb-4 border-indigo-50/50 mb-4">
              <div>
                <h3 className="text-lg font-extrabold text-indigo-950">Mark Attendance: {selectedPeriod.class_name}</h3>
                <p className="text-xs text-indigo-500 font-medium mt-0.5">
                  {selectedPeriod.hour} ({selectedPeriod.time}) · Subject: <strong className="text-indigo-950">{selectedPeriod.subject}</strong>
                </p>
              </div>
              <button 
                onClick={() => setSelectedPeriod(null)}
                className="text-xs font-bold text-indigo-400 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-all"
              >
                Cancel
              </button>
            </div>

            <p className="text-xs font-bold text-indigo-500 mb-3 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>Please check off ONLY the absent students (unselected students will be marked Present):</span>
            </p>

            {selectedPeriod.students.length === 0 ? (
              <p className="text-sm text-indigo-400 italic text-center py-6">No students registered in this class.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-96 overflow-y-auto pr-1 mb-6">
                  {selectedPeriod.students.map((student) => {
                    const isAbsent = absentRolls.includes(student.roll_number);
                    return (
                      <div 
                        key={student.roll_number}
                        onClick={() => {
                          if (isAbsent) {
                            setAbsentRolls(prev => prev.filter(r => r !== student.roll_number));
                          } else {
                            setAbsentRolls(prev => [...prev, student.roll_number]);
                          }
                        }}
                        className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                          isAbsent 
                            ? 'bg-rose-50 border-rose-250/40 text-rose-800' 
                            : 'bg-white border-indigo-50/55 hover:border-indigo-200 text-indigo-950'
                        }`}
                      >
                        <div>
                          <p className="text-xs font-bold">{student.name}</p>
                          <p className="text-[10px] font-mono opacity-60 mt-0.5">{student.roll_number}</p>
                        </div>
                        <div className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all ${
                          isAbsent 
                            ? 'bg-rose-500 border-rose-600 text-white' 
                            : 'border-indigo-200 bg-white'
                        }`}>
                          {isAbsent && <span className="font-extrabold text-[10px]">✕</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-indigo-50/50">
                  <div className="text-xs text-indigo-500 font-semibold">
                    Total Students: <strong className="text-indigo-950">{selectedPeriod.total_students}</strong> · 
                    Absent: <strong className="text-rose-600">{absentRolls.length}</strong> · 
                    Present: <strong className="text-emerald-600">{selectedPeriod.total_students - absentRolls.length}</strong>
                  </div>
                  <button
                    onClick={handleMarkPeriodAttendance}
                    disabled={submittingAttendance}
                    className="btn-secondary w-full sm:w-auto px-6 py-2.5 font-bold"
                  >
                    {submittingAttendance ? 'Saving...' : 'Submit Attendance'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Submission and AI Upload Form */}
          <div className="lg:col-span-2 space-y-8">
            <section className="glass-panel p-6">
              <h2 className="text-xl font-extrabold text-indigo-950 mb-4 flex items-center gap-2">
                <FileUp className="w-5 h-5 text-primary animate-bounce" />
                <span>Submit Student Academic Marksheet</span>
              </h2>

              {/* Drag and Drop Zone */}
              <div className="border-2 border-dashed border-indigo-200 rounded-xl p-8 text-center bg-white/30 hover:bg-white/60 transition-all relative group mb-6">
                <input 
                  type="file" 
                  accept="image/*,application/pdf"
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  disabled={uploading}
                />
                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/15 flex items-center justify-center text-primary group-hover:scale-110 transition-transform mb-3">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <span className="font-bold text-sm text-indigo-950 block">
                    {uploading ? 'Processing Sheet with Gemini AI...' : 'Drag & Drop Marksheet or Click to Upload'}
                  </span>
                  <span className="text-xs text-indigo-400 font-semibold mt-1">Supports PDF, PNG, JPG (Gemini OCR Auto-Fill)</span>
                </div>
              </div>

              {/* Main Form */}
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-indigo-950 uppercase tracking-wider mb-1.5">Student Name</label>
                    <input 
                      type="text" 
                      value={studentName} 
                      onChange={e => setStudentName(e.target.value)} 
                      placeholder="e.g. Aarav Sharma"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-indigo-950 uppercase tracking-wider mb-1.5">Roll Number</label>
                    <input 
                      type="text" 
                      value={rollNumber} 
                      onChange={e => setRollNumber(e.target.value)} 
                      placeholder="e.g. CS21001"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-indigo-950 uppercase tracking-wider mb-1.5">Semester</label>
                    <select value={semester} onChange={e => setSemester(e.target.value)}>
                      <option>1st Semester</option>
                      <option>2nd Semester</option>
                      <option>3rd Semester</option>
                      <option>4th Semester</option>
                      <option>5th Semester</option>
                      <option>6th Semester</option>
                      <option>7th Semester</option>
                      <option>8th Semester</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-indigo-950 uppercase tracking-wider mb-1.5">Total Marks</label>
                    <input 
                      type="number" 
                      value={totalMarks} 
                      onChange={e => setTotalMarks(e.target.value)} 
                      placeholder="e.g. 450"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-indigo-950 uppercase tracking-wider mb-1.5">GPA</label>
                    <input 
                      type="number" 
                      step="0.01" 
                      value={gpa} 
                      onChange={e => setGpa(e.target.value)} 
                      placeholder="e.g. 9.2"
                    />
                  </div>
                </div>

                {/* Subjects Roster Input */}
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <label className="block text-xs font-bold text-indigo-950 uppercase tracking-wider">Subject-wise Marks & Grades</label>
                    <button 
                      type="button" 
                      onClick={addSubjectRow}
                      className="btn-outline text-xs px-2.5 py-1 flex items-center gap-1.5 font-bold"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Subject
                    </button>
                  </div>

                  <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                    {marks.map((row, index) => (
                      <div key={index} className="flex gap-2 items-center">
                        <div className="flex-grow grid grid-cols-12 gap-2">
                          <div className="col-span-6">
                            <input 
                              type="text" 
                              value={row.subject} 
                              onChange={e => handleMarkChange(index, 'subject', e.target.value)}
                              placeholder="Subject Name"
                              className="text-sm"
                            />
                          </div>
                          <div className="col-span-2">
                            <input 
                              type="number" 
                              value={row.marks} 
                              onChange={e => handleMarkChange(index, 'marks', e.target.value)}
                              placeholder="Marks"
                              className="text-sm text-center"
                            />
                          </div>
                          <div className="col-span-2">
                            <input 
                              type="number" 
                              value={row.max_marks} 
                              onChange={e => handleMarkChange(index, 'max_marks', e.target.value)}
                              placeholder="Max"
                              className="text-sm text-center"
                            />
                          </div>
                          <div className="col-span-2">
                            <input 
                              type="text" 
                              value={row.grade} 
                              onChange={e => handleMarkChange(index, 'grade', e.target.value)}
                              placeholder="Grade"
                              className="text-sm text-center"
                            />
                          </div>
                        </div>
                        <button 
                          type="button" 
                          onClick={() => removeSubjectRow(index)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded-lg flex-shrink-0"
                          disabled={marks.length === 1}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {marksheetFilename && (
                  <div className="text-xs text-indigo-500 font-bold bg-indigo-50 p-3 rounded-lg border border-indigo-100 flex items-center justify-between">
                    <span>File attached: <strong>{marksheetFilename.split('/').pop()}</strong></span>
                    <button type="button" onClick={() => setMarksheetFilename('')} className="text-red-500 font-bold hover:underline">Remove</button>
                  </div>
                )}

                <button type="submit" className="w-full btn-secondary font-bold text-base py-3">
                  Upload & Submit for Review
                </button>
              </form>
            </section>
          </div>

          {/* Submissions History Sidebar */}
          <div className="lg:col-span-1">
            <section className="glass-panel p-6 h-full flex flex-col">
              <h2 className="text-xl font-extrabold text-indigo-950 mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-indigo-500" />
                <span>Submissions History</span>
              </h2>

              <div className="flex-grow overflow-y-auto space-y-4 max-h-[600px] pr-1">
                {loadingHistory ? (
                  <div className="text-center text-sm text-indigo-400 py-8">Loading history...</div>
                ) : submissions.length === 0 ? (
                  <div className="text-center text-sm text-indigo-400 py-8 bg-white/20 rounded-xl border border-dashed border-indigo-100">No submissions uploaded yet.</div>
                ) : (
                  submissions.map((sub, i) => (
                    <div key={i} className="p-4 bg-white/40 border border-indigo-100/50 rounded-xl hover:border-indigo-300 hover:bg-white/60 transition-all flex flex-col gap-2 relative">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-bold text-indigo-950 text-sm">{sub.student_name}</h3>
                          <span className="font-mono text-xs text-indigo-400">{sub.roll_number}</span>
                        </div>
                        <span className="text-xs font-bold text-indigo-950 bg-indigo-50 px-2 py-0.5 rounded-md">{sub.semester}</span>
                      </div>
                      
                      <div className="flex justify-between items-center text-xs mt-1">
                        <span className="text-indigo-500 font-medium">Total: <strong>{sub.total_marks || '—'}</strong> | GPA: <strong>{sub.gpa || '—'}</strong></span>
                        {getStatusBadge(sub.status, sub)}
                      </div>

                      {sub.status === 'Rejected' && (sub.hod_remarks || sub.principal_remarks) && (
                        <div className="mt-2 text-[11px] bg-red-50 text-red-700 p-2 rounded-lg border border-red-100">
                          {sub.hod_remarks && <p><strong>HOD:</strong> {sub.hod_remarks}</p>}
                          {sub.principal_remarks && <p><strong>Principal:</strong> {sub.principal_remarks}</p>}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
      </div>
      </div>
    </SidebarLayout>
  );
}
