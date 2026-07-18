import React, { useState, useEffect } from 'react';
import { useToast, useAuth } from '../App';
import { X, Check, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import DocumentPanel from './DocumentPanel';

const BASE_STEPS = [
  { label: 'Personal' },
  { label: 'Academic' },
  { label: 'Career Info' }
];

// Documents and Finance only make sense once a student row actually
// exists to attach to (documents.student_id / fee_payments.student_id
// are both real FKs to students.id) — same "no id yet, nothing to
// fetch" reasoning that keeps every other step's data local form state
// instead of a server fetch. Both appended, not inserted, so index math
// for every existing step (including the `index > 0` early-steps-locked
// check below) stays simple.

export default function StudentEditorModal({ onClose, student, onSave }) {

  const { showToast } = useToast();
  const { accessToken, user } = useAuth();
  const isEditMode = !!student;
  // Real backend rows always carry `id` (every repository's PK column,
  // per every migration in this schema) — unlike the prototype-era
  // `_id` field FALLBACK_STUDENTS/`/api/tutor-students` still use
  // (TutorClass.jsx, this modal's only real caller, hasn't been
  // repointed to `/api/v1/students` yet). Checking `student.id`
  // specifically, not `student._id || student.id`, is what actually
  // distinguishes "a real fee_payments.student_id FK target exists"
  // from "this is still prototype data" — see the Finance step's own
  // render branch below for what happens when it's null.
  const realStudentId = student && student.id ? student.id : null;
  const steps = isEditMode ? [...BASE_STEPS, { label: 'Documents' }, { label: 'Finance' }] : BASE_STEPS;
  const [currentStep, setCurrentStep] = useState(0);

  // Form State
  const [rollNo, setRollNo] = useState('');
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState('Male');
  const [entryType, setEntryType] = useState('Regular');
  const [umisNumber, setUmisNumber] = useState('');
  const [emisNumber, setEmisNumber] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneVerified, setPhoneVerified] = useState(0);
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [parentPhoneVerified, setParentPhoneVerified] = useState(0);
  const [address, setAddress] = useState('');
  const [pincode, setPincode] = useState('');
  const [mark10th, setMark10th] = useState('');
  const [mark12th, setMark12th] = useState('');
  const [markIti, setMarkIti] = useState('');
  const [accommodation, setAccommodation] = useState('Day Scholar');
  const [club, setClub] = useState('None');
  const [internship, setInternship] = useState('Not Started');
  const [careerPlan, setCareerPlan] = useState('Job');
  const [notes, setNotes] = useState('');

  // Driving license & bike details
  const [licenseNumber, setLicenseNumber] = useState('');
  const [bikeNumber, setBikeNumber] = useState('');

  // Finance step state — fee_structures (the tenant's known fee
  // categories) and this student's own fee_payments marks, merged for
  // display. Two real reads, not one, even though the task's own
  // framing names only "the fee_payments list-by-student endpoint":
  // fee_payments has no fee_category/amount columns of its own (only
  // a fee_structure_id FK — see c1b7aac's ERD), and there is no
  // GET-by-id for a single fee_structure (77dfcd0's own scope
  // decision), so a human-readable category name can only come from
  // also reading the fee_structures list. A fee category with no
  // fee_payments row yet defaults to 'not_paid' in the merge below —
  // fee_payments rows only exist once a mark has actually been made
  // (financeService.js's own file comment), so "no row" and "marked
  // not paid" are indistinguishable, and treating an unmarked fee the
  // same as an explicitly-unpaid one is the correct default here.
  const [feeRows, setFeeRows] = useState([]);
  const [feeLoading, setFeeLoading] = useState(false);
  const [markingFeeStructureId, setMarkingFeeStructureId] = useState(null);

  // Documents step state — every document row for this student
  // (GET /api/v1/documents?student_id=...), newest first. DocumentPanel
  // itself reduces this to "latest per doc_type" — see its own comment.
  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);

  // Template-fill (Module 6/College Admin) — templates are college-
  // wide (GET /api/v1/documents/templates lists every one, not scoped
  // to this student), fetched alongside this student's own documents.
  // No fixed tag list on this side either: whatever {{fields}} a
  // template defines are whatever get filled from this real student
  // record below, via mergeTemplate's own nullGetter for anything this
  // record doesn't have.
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [generatingTemplate, setGeneratingTemplate] = useState(false);

  // Populate fields if edit mode
  useEffect(() => {
    if (student) {
      setRollNo(student.roll_number || student.roll_no || '');
      setFullName(student.name || student.full_name || '');
      setGender(student.gender || 'Male');
      setEntryType(student.entry_type || 'Regular');
      setUmisNumber(student.umis_number || '');
      setEmisNumber(student.emis_number || '');
      setEmail(student.email || '');
      setPhone(student.phone || '');
      setPhoneVerified(student.phone_verified || 0);
      setParentName(student.parent_name || '');
      setParentPhone(student.parent_phone || '');
      setParentPhoneVerified(student.parent_phone_verified || 0);
      setAddress(student.address || '');
      setPincode(student.pincode || '');
      setMark10th(student.mark_10th || '');
      setMark12th(student.mark_12th || '');
      setMarkIti(student.mark_iti || '');
      setAccommodation(student.accommodation || 'Day Scholar');
      setClub(student.club || 'None');
      setInternship(student.internship || 'Not Started');
      setCareerPlan(student.career_plan || 'Job');
      setNotes(student.notes || '');
      setLicenseNumber(student.license_number || '');
      setBikeNumber(student.bike_number || '');
    } else {
      setRollNo('');
      setFullName('');
      setGender('Male');
      setEntryType('Regular');
      setUmisNumber('');
      setEmisNumber('');
      setEmail('');
      setPhone('');
      setPhoneVerified(0);
      setParentName('');
      setParentPhone('');
      setParentPhoneVerified(0);
      setAddress('');
      setPincode('');
      setMark10th('');
      setMark12th('');
      setMarkIti('');
      setAccommodation('Day Scholar');
      setClub('None');
      setInternship('Not Started');
      setCareerPlan('Job');
      setNotes('');
      setLicenseNumber('');
      setBikeNumber('');
    }
    setCurrentStep(0);
  }, [student]);

  // Fetches lazily, only once the Finance step is actually viewed —
  // same "don't fetch what isn't on screen" restraint every other step
  // here already follows by keeping its data as local form state
  // populated once above, not refetched per render.
  const fetchFeeData = async () => {
    setFeeLoading(true);
    try {
      const headers = { Authorization: `Bearer ${accessToken}` };
      const [structuresRes, paymentsRes] = await Promise.all([
        fetch('/api/v1/finance/fee-structures?limit=200', { headers }),
        fetch(`/api/v1/finance/fee-payments?student_id=${realStudentId}`, { headers }),
      ]);
      if (!structuresRes.ok || !paymentsRes.ok) {
        throw new Error('Failed to load fee details');
      }
      const structures = await structuresRes.json();
      const payments = await paymentsRes.json();
      const merged = structures.map(fs => {
        const payment = payments.find(p => p.fee_structure_id === fs.id);
        return {
          feeStructureId: fs.id,
          category: fs.fee_category,
          academicYear: fs.academic_year,
          amount: fs.amount,
          status: payment ? payment.status : 'not_paid',
        };
      });
      setFeeRows(merged);
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setFeeLoading(false);
    }
  };

  // Same lazy-fetch restraint as fetchFeeData above: only queried once
  // the Documents step is actually viewed.
  const fetchDocuments = async () => {
    setDocumentsLoading(true);
    try {
      const headers = { Authorization: `Bearer ${accessToken}` };
      const res = await fetch(`/api/v1/documents?student_id=${realStudentId}`, { headers });
      if (!res.ok) throw new Error('Failed to load documents');
      setDocuments(await res.json());
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setDocumentsLoading(false);
    }
  };

  const fetchTemplates = async () => {
    try {
      const headers = { Authorization: `Bearer ${accessToken}` };
      const res = await fetch('/api/v1/documents/templates', { headers });
      if (!res.ok) throw new Error('Failed to load templates');
      setTemplates(await res.json());
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  useEffect(() => {
    if (isEditMode && realStudentId && steps[currentStep] && steps[currentStep].label === 'Finance') {
      fetchFeeData();
    }
    if (isEditMode && realStudentId && steps[currentStep] && steps[currentStep].label === 'Documents') {
      fetchDocuments();
      fetchTemplates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, realStudentId]);

  // The real caller this slice names: merge whatever fields this
  // student record actually has into the chosen template and download
  // the result — same Blob/object-URL pattern DocumentPanel.jsx's own
  // handleDownload already uses for a stored document, just against
  // the merge route's bytes instead. `fields` is the flat, real
  // student data already loaded into this form's own state (not a
  // hardcoded subset) — CLAUDE.md rule 9: every one of these values is
  // untrusted, human-entered data, inserted into the template as
  // literal text by mergeTemplate, never interpreted as instructions.
  const handleGenerateFromTemplate = async () => {
    if (!selectedTemplateId) return;
    setGeneratingTemplate(true);
    try {
      const fields = {
        roll_number: rollNo,
        name: fullName,
        gender,
        entry_type: entryType,
        umis_number: umisNumber,
        emis_number: emisNumber,
        email,
        phone,
        parent_name: parentName,
        parent_phone: parentPhone,
        address,
        pincode,
        mark_10th: mark10th,
        mark_12th: mark12th,
        mark_iti: markIti,
        accommodation,
        club,
        internship,
        career_plan: careerPlan,
      };
      const res = await fetch(`/api/v1/documents/${selectedTemplateId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to generate document');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fullName || 'student'}-${templates.find((t) => t.id === selectedTemplateId)?.file_name || 'generated.docx'}`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Document generated!', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setGeneratingTemplate(false);
    }
  };

  // Toggles a fee line paid <-> not_paid via the real mark-or-re-mark
  // upsert (POST /api/v1/finance/fee-payments) — works identically
  // whether this fee category has ever been marked for this student
  // before or not, same reasoning financeService.markFeePayment's own
  // find-then-create/update shape already handles both cases without
  // this component needing to know which one it is.
  const handleToggleFeePayment = async (feeStructureId, currentStatus) => {
    const nextStatus = currentStatus === 'paid' ? 'not_paid' : 'paid';
    setMarkingFeeStructureId(feeStructureId);
    try {
      const res = await fetch('/api/v1/finance/fee-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          student_id: realStudentId,
          fee_structure_id: feeStructureId,
          status: nextStatus,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to update fee status');
      }
      showToast(`Marked as ${nextStatus === 'paid' ? 'Paid' : 'Not Paid'}`, 'success');
      await fetchFeeData();
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setMarkingFeeStructureId(null);
    }
  };

  const handleNext = () => {
    if (currentStep === 1 && (!rollNo || !fullName)) {
      showToast('Roll number and Full Name are required.', 'danger');
      return;
    }
    setCurrentStep(prev => Math.min(prev + 1, steps.length - 1));
  };

  const handleBack = () => {
    setCurrentStep(prev => Math.max(prev - 1, 0));
  };

  const handleSave = async () => {
    if (!rollNo || !fullName) {
      showToast('Roll number and Full name are required fields', 'danger');
      return;
    }

    const payload = {
      roll_no: rollNo,
      full_name: fullName,
      gender,
      entry_type: entryType,
      umis_number: umisNumber,
      emis_number: emisNumber,
      email,
      phone,
      phone_verified: phoneVerified,
      parent_name: parentName,
      parent_phone: parentPhone,
      parent_phone_verified: parentPhoneVerified,
      address,
      pincode,
      mark_10th: mark10th,
      mark_12th: mark12th,
      mark_iti: markIti,
      accommodation,
      club,
      internship,
      career_plan: careerPlan,
      notes,
      license_number: licenseNumber,
      bike_number: bikeNumber
    };

    try {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      };

      let res;
      if (isEditMode) {
        res = await fetch(`/api/v1/students/${student._id || student.id || student.roll_no}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch('/api/v1/students', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      }

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to save student profile');
      }

      showToast(`Student profile ${isEditMode ? 'updated' : 'created'} successfully!`, 'success');
      if (onSave) onSave();
      onClose();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-panel w-full max-w-3xl" style={{ height: '78vh', display: 'flex', flexDirection: 'column' }}>
        
        <div className="px-6 py-4 border-b flex justify-between items-center" style={{ background: 'rgba(0,0,0,0.02)', borderColor: 'rgba(0,0,0,0.08)' }}>
          <h2 className="text-lg font-extrabold text-slate-800">
            {isEditMode ? 'Edit Student Profile' : 'Add New Student'}
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800 text-2xl leading-none transition-colors">&times;</button>
        </div>

        {/* Step Indicators */}
        <div className="px-6 py-3 border-b flex gap-2 overflow-x-auto" style={{ borderColor: 'rgba(0,0,0,0.06)', background: 'rgba(0,0,0,0.01)' }}>
          {steps.map((step, index) => (
            <button
              key={index}
              type="button"
              disabled={index > 0 && (!rollNo || !fullName)}
              onClick={() => setCurrentStep(index)}
              className={`flex items-center gap-1.5 text-xs font-bold transition-all whitespace-nowrap px-3 py-1.5 rounded-lg ${
                currentStep === index
                  ? 'text-indigo-700 bg-indigo-50 border border-indigo-200'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] leading-none font-black ${
                currentStep === index ? 'bg-indigo-650 text-white' : 'bg-slate-200 text-slate-600'
              }`}>
                {index + 1}
              </span>
              <span>{step.label}</span>
            </button>
          ))}
        </div>

        {/* Wizard Form Body */}
        <div className="p-6 overflow-y-auto flex-grow space-y-6">

          {/* STEP 0: PERSONAL */}
          {currentStep === 0 && (
            <div className="space-y-5 animate-slide-up">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label className="section-title block mb-1.5 font-bold text-slate-700">Roll Number *</label>
                  <input 
                    type="text" 
                    value={rollNo} 
                    onChange={e => setRollNo(e.target.value)} 
                    placeholder="e.g. CS21001" 
                    required
                  />
                </div>
                <div>
                  <label className="section-title block mb-1.5 font-bold text-slate-700">Full Name *</label>
                  <input 
                    type="text" 
                    value={fullName} 
                    onChange={e => setFullName(e.target.value)} 
                    placeholder="e.g. Aarav Sharma" 
                    required
                  />
                </div>
                <div>
                  <label className="section-title block mb-1.5 font-bold text-slate-700">Gender *</label>
                  <select value={gender} onChange={e => setGender(e.target.value)}>
                    <option value="Male">Boy</option>
                    <option value="Female">Girl</option>
                  </select>
                </div>
                <div>
                  <label className="section-title block mb-1.5 font-bold text-slate-700">Entry Type *</label>
                  <select value={entryType} onChange={e => setEntryType(e.target.value)}>
                    <option value="Regular">Regular</option>
                    <option value="Lateral Entry">Lateral Entry</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">EMIS Number</label>
                  <input type="text" value={emisNumber} onChange={e => setEmisNumber(e.target.value)} placeholder="11-digit EMIS ID" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">UMIS Number</label>
                  <input type="text" value={umisNumber} onChange={e => setUmisNumber(e.target.value)} placeholder="UMIS ID" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Email Address</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="student@arcnave.edu" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Student Phone</label>
                  <div className="flex gap-2">
                    <input type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" />
                    <button 
                      type="button" 
                      onClick={() => setPhoneVerified(prev => prev ? 0 : 1)}
                      className={`px-2 rounded-lg border text-xs font-bold ${phoneVerified ? 'bg-emerald-100 border-emerald-200 text-emerald-600' : 'bg-slate-50 border-slate-200 text-slate-400'}`}
                    >
                      {phoneVerified ? '✓' : 'Verify'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-100 pt-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Parent / Guardian Name</label>
                  <input type="text" value={parentName} onChange={e => setParentName(e.target.value)} placeholder="Parent Name" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Parent Phone</label>
                  <div className="flex gap-2">
                    <input type="text" value={parentPhone} onChange={e => setParentPhone(e.target.value)} placeholder="Parent Phone" />
                    <button 
                      type="button" 
                      onClick={() => setParentPhoneVerified(prev => prev ? 0 : 1)}
                      className={`px-2 rounded-lg border text-xs font-bold ${parentPhoneVerified ? 'bg-emerald-100 border-emerald-200 text-emerald-600' : 'bg-slate-50 border-slate-200 text-slate-400'}`}
                    >
                      {parentPhoneVerified ? '✓' : 'Verify'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 border-t border-slate-100 pt-4">
                <div className="sm:col-span-3">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Home Address</label>
                  <input type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder="Flat, Street name, City" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Pincode</label>
                  <input type="text" value={pincode} onChange={e => setPincode(e.target.value)} placeholder="6-digit PIN" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-100 pt-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Driving License Details</label>
                  <input type="text" value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} placeholder="e.g. TN-07-2024-0089452" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Bike Number Details</label>
                  <input type="text" value={bikeNumber} onChange={e => setBikeNumber(e.target.value)} placeholder="e.g. TN-07-BY-1492" />
                </div>
              </div>
            </div>
          )}

          {/* STEP 1: ACADEMIC */}
          {currentStep === 1 && (
            <div className="space-y-6 animate-slide-up">
              <div>
                <h3 className="font-extrabold text-indigo-950 text-sm mb-1">Prior Academic Records</h3>
                <p className="text-xs text-slate-500 font-bold">SSLC, HSC/ITI, and semesters percentage scores.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">10th SSLC Mark (%)</label>
                  <input type="text" value={mark10th} onChange={e => setMark10th(e.target.value)} placeholder="e.g. 92% or 460/500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">12th HSC Mark (%)</label>
                  <input type="text" value={mark12th} onChange={e => setMark12th(e.target.value)} placeholder="e.g. 88% or 528/600" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">ITI Score (%)</label>
                  <input type="text" value={markIti} onChange={e => setMarkIti(e.target.value)} placeholder="e.g. 85%" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-100 pt-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Stay Accommodation</label>
                  <select value={accommodation} onChange={e => setAccommodation(e.target.value)}>
                    <option>Day Scholar</option>
                    <option>Hosteller</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: CAREER */}
          {currentStep === 2 && (
            <div className="space-y-6 animate-slide-up">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Extra-Curricular Club</label>
                  <select value={club} onChange={e => setClub(e.target.value)}>
                    <option>None</option>
                    <option>NCC</option>
                    <option>NSS</option>
                    <option>YRC</option>
                    <option>Sports</option>
                    <option>Rotaract</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Internship Detail</label>
                  <input type="text" value={internship} onChange={e => setInternship(e.target.value)} placeholder="e.g. 1 Month at TCS" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Career Plan</label>
                  <select value={careerPlan} onChange={e => setCareerPlan(e.target.value)}>
                    <option>Job</option>
                    <option>Higher Studies</option>
                    <option>Entrepreneurship</option>
                    <option>Undecided</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Tutor Observations & Remarks</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows="4"
                  placeholder="Record observations, behavior notes, or counseling remarks..."
                />
              </div>
            </div>
          )}

          {/* STEP 3: DOCUMENTS (edit mode only — see the `steps` computation above) */}
          {isEditMode && steps[currentStep] && steps[currentStep].label === 'Documents' && (
            <div className="space-y-6 animate-slide-up">
              <div>
                <h3 className="font-extrabold text-indigo-950 text-sm mb-1">Documents</h3>
                <p className="text-xs text-slate-500 font-bold">Certificates, ID proofs, and photo for this student.</p>
              </div>

              {!realStudentId ? (
                <p className="text-xs text-slate-450 text-center py-6 font-medium">
                  This student record isn't linked to a real backend profile yet, so documents aren't available here.
                </p>
              ) : documentsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  <DocumentPanel
                    studentId={realStudentId}
                    documents={documents}
                    accessToken={accessToken}
                    onDocumentUpdate={fetchDocuments}
                    canUpload={user?.role === 'principal'}
                    canVerify={user?.role === 'principal'}
                  />

                  {/* Generate from Template — the one real caller this
                      slice names. Fields come from this student's own
                      real data (above), never a fixed tag list. */}
                  <div className="pt-4 mt-4 border-t border-slate-100">
                    <h4 className="font-extrabold text-indigo-950 text-xs mb-1 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" /> Generate from Template
                    </h4>
                    <p className="text-[11px] text-slate-500 font-bold mb-2">
                      Fill a college template with this student's real data.
                    </p>
                    {templates.length === 0 ? (
                      <p className="text-xs text-slate-400 italic py-2">No templates uploaded yet (College Admin uploads these).</p>
                    ) : (
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedTemplateId}
                          onChange={(e) => setSelectedTemplateId(e.target.value)}
                          className="flex-1 bg-slate-50 border border-slate-200 rounded-xl p-2 text-xs font-semibold focus:outline-none focus:border-indigo-400"
                        >
                          <option value="">Select a template…</option>
                          {templates.map((t) => (
                            <option key={t.id} value={t.id}>{t.file_name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={handleGenerateFromTemplate}
                          disabled={!selectedTemplateId || generatingTemplate}
                          className="btn-primary text-xs py-2 px-3 disabled:opacity-50"
                        >
                          {generatingTemplate ? 'Generating…' : 'Generate'}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 4: FINANCE (edit mode only — see the `steps` computation above) */}
          {isEditMode && steps[currentStep] && steps[currentStep].label === 'Finance' && (
            <div className="space-y-6 animate-slide-up">
              <div>
                <h3 className="font-extrabold text-indigo-950 text-sm mb-1">Fee Status</h3>
                <p className="text-xs text-slate-500 font-bold">Semester, exam, and other fee categories for this student — mark paid or not-paid.</p>
              </div>

              {!realStudentId ? (
                <p className="text-xs text-slate-450 text-center py-6 font-medium">
                  This student record isn't linked to a real backend profile yet, so fee data isn't available here.
                </p>
              ) : feeLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
                </div>
              ) : feeRows.length === 0 ? (
                <p className="text-xs text-slate-450 text-center py-6 font-medium">No fee categories configured yet.</p>
              ) : (
                <div className="space-y-2">
                  {feeRows.map(row => (
                    <div key={row.feeStructureId} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-150 rounded-2xl">
                      <div>
                        <span className="text-xs font-black text-indigo-950 block">{row.category}</span>
                        <span className="text-[10px] text-slate-455 font-semibold">{row.academicYear} · ₹{row.amount}</span>
                      </div>
                      <button
                        type="button"
                        disabled={markingFeeStructureId === row.feeStructureId}
                        onClick={() => handleToggleFeePayment(row.feeStructureId, row.status)}
                        className={`px-3 py-1.5 text-[10px] font-bold rounded-lg border flex items-center gap-1 transition-all ${
                          row.status === 'paid'
                            ? 'bg-emerald-100 border-emerald-200 text-emerald-600'
                            : 'bg-slate-100 border-slate-200 text-slate-500'
                        } ${markingFeeStructureId === row.feeStructureId ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        {markingFeeStructureId === row.feeStructureId
                          ? 'Updating…'
                          : row.status === 'paid'
                            ? (<><Check className="w-3 h-3" /> Paid</>)
                            : 'Not Paid'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Wizard Footer */}
        <div className="px-6 py-4 flex justify-between items-center flex-shrink-0 border-t" style={{ background: 'rgba(0,0,0,0.01)', borderColor: 'rgba(0,0,0,0.06)' }}>
          <button 
            type="button" 
            onClick={handleBack} 
            disabled={currentStep === 0}
            className={`btn-outline text-xs flex items-center gap-1 ${currentStep === 0 ? 'opacity-30 cursor-not-allowed' : ''}`}
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-ghost text-xs">Cancel</button>
            {currentStep < steps.length - 1 ? (
              <button type="button" onClick={handleNext} className="btn-primary text-xs flex items-center gap-1">
                Next <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button type="button" onClick={handleSave} className="btn-emerald text-xs flex items-center gap-1.5">
                <Check className="w-4 h-4" /> Save Profile
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
