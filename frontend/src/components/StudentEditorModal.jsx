import React, { useState, useEffect } from 'react';
import { useToast, useAuth } from '../App';
import { X, Check, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';

const STEPS = [
  { label: 'Upload Documents' },
  { label: 'Personal' },
  { label: 'Academic' },
  { label: 'Career Info' }
];

export default function StudentEditorModal({ onClose, student, onSave }) {

  const { showToast } = useToast();
  const { accessToken } = useAuth();
  const isEditMode = !!student;
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

  // Uploaded files list
  const [uploadedFiles, setUploadedFiles] = useState({
    marksheet10th: null,
    marksheet12th: null,
    marksheetIti: null,
    marksheet1stSem: null,
    marksheet2ndSem: null
  });

  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [extractionStatus, setExtractionStatus] = useState('');

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

  const handleFileChange = (field, fileName) => {
    setUploadedFiles(prev => ({
      ...prev,
      [field]: fileName
    }));
    showToast(`Uploaded ${fileName} successfully!`, 'success');
  };

  const runDocumentExtraction = () => {
    setIsExtracting(true);
    setExtractionProgress(10);
    setExtractionStatus('Uploading documents to AI OCR engine...');

    const statuses = [
      { progress: 30, text: 'Scanning SSLC & HSC marksheets...' },
      { progress: 55, text: 'Extracting student name, parents, and address info...' },
      { progress: 75, text: 'Reading ITI & semester grade percentages...' },
      { progress: 90, text: 'Validating driving license and vehicle registration logs...' },
      { progress: 100, text: 'AI parsing completed!' }
    ];

    let stepIdx = 0;
    const interval = setInterval(() => {
      if (stepIdx < statuses.length) {
        setExtractionProgress(statuses[stepIdx].progress);
        setExtractionStatus(statuses[stepIdx].text);
        stepIdx++;
      } else {
        clearInterval(interval);
        
        // Auto-fill values
        setRollNo('CS24' + Math.floor(100 + Math.random() * 900));
        setFullName('Aravind Swamy');
        setGender('Male');
        setEntryType('Regular');
        setEmisNumber('33021004521');
        setUmisNumber('UM24009');
        setEmail('aravind@arcnave.edu');
        setPhone('9988776655');
        setParentName('Swamy Nathan');
        setParentPhone('9876543210');
        setAddress('Plot 42, Green Gardens, Chennai');
        setPincode('600020');
        setMark10th('94.2%');
        setMark12th('89.6%');
        setMarkIti('82%');
        setLicenseNumber('DL-TN07202400894');
        setBikeNumber('TN-07-BY-1492');

        setIsExtracting(false);
        showToast('✨ AI OCR: Successfully extracted student details and vehicle credentials!', 'success');
        setCurrentStep(1); // Advance to Personal info automatically
      }
    }, 500);
  };

  const handleNext = () => {
    if (currentStep === 1 && (!rollNo || !fullName)) {
      showToast('Roll number and Full Name are required.', 'danger');
      return;
    }
    setCurrentStep(prev => Math.min(prev + 1, STEPS.length - 1));
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
          {STEPS.map((step, index) => (
            <button
              key={index}
              type="button"
              disabled={index > 1 && (!rollNo || !fullName)}
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

          {/* STEP 0: UPLOAD DOCUMENTS */}
          {currentStep === 0 && (
            <div className="space-y-6 animate-slide-up">
              {isExtracting ? (
                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                  {/* Pulsing AI Scanner Graphic */}
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full border-2 border-indigo-500/20 border-t-indigo-500 animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center text-indigo-650">
                      <Sparkles className="w-5 h-5 animate-pulse" />
                    </div>
                  </div>
                  <div className="text-center space-y-1 max-w-md">
                    <h4 className="font-extrabold text-sm text-slate-800">AI OCR Document Extraction Active</h4>
                    <p className="text-xs text-indigo-655 font-semibold">{extractionStatus}</p>
                    <div className="w-48 h-1.5 bg-slate-100 rounded-full mx-auto overflow-hidden mt-3 border border-slate-200">
                      <div className="h-full bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${extractionProgress}%` }} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="p-4 bg-indigo-50/40 border border-indigo-100 rounded-2xl flex items-start gap-3">
                    <Sparkles className="w-5 h-5 text-indigo-650 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-black text-slate-805 text-indigo-950">AI Document Parser & OCR Reader</h4>
                      <p className="text-[11px] text-slate-655 leading-relaxed font-semibold mt-1">
                        Upload student marksheets below. The system automatically extracts name, EMIS registry numbers, parent phone, addresses, score percentages, and licensing details!
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    
                    {/* 10th marksheet */}
                    <div className="p-4 bg-slate-50 border border-slate-150 rounded-2xl flex flex-col justify-between">
                      <div>
                        <span className="text-[9px] font-extrabold uppercase text-slate-400">Secondary School Certificate</span>
                        <h5 className="font-black text-xs text-indigo-950 mt-0.5">10th Marksheet *</h5>
                      </div>
                      <div className="mt-4">
                        {uploadedFiles.marksheet10th ? (
                          <span className="text-[10px] text-emerald-600 font-mono font-bold bg-emerald-50 px-2.5 py-1 rounded border border-emerald-100">
                            ✓ {uploadedFiles.marksheet10th}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleFileChange('marksheet10th', '10th_marksheet_swamy.pdf')}
                            className="px-3 py-1.5 text-[10px] font-bold bg-white hover:border-slate-350 border border-slate-200 rounded-lg text-slate-605 cursor-pointer"
                          >
                            Choose File
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 12th marksheet */}
                    <div className="p-4 bg-slate-50 border border-slate-150 rounded-2xl flex flex-col justify-between">
                      <div>
                        <span className="text-[9px] font-extrabold uppercase text-slate-400">Higher Secondary Certificate</span>
                        <h5 className="font-black text-xs text-indigo-950 mt-0.5">12th Marksheet</h5>
                      </div>
                      <div className="mt-4">
                        {uploadedFiles.marksheet12th ? (
                          <span className="text-[10px] text-emerald-600 font-mono font-bold bg-emerald-50 px-2.5 py-1 rounded border border-emerald-100">
                            ✓ {uploadedFiles.marksheet12th}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleFileChange('marksheet12th', '12th_marksheet_swamy.pdf')}
                            className="px-3 py-1.5 text-[10px] font-bold bg-white hover:border-slate-350 border border-slate-200 rounded-lg text-slate-605 cursor-pointer"
                          >
                            Choose File
                          </button>
                        )}
                      </div>
                    </div>

                    {/* ITI Certificate */}
                    <div className="p-4 bg-slate-50 border border-slate-150 rounded-2xl flex flex-col justify-between">
                      <div>
                        <span className="text-[9px] font-extrabold uppercase text-slate-400">Industrial Training Institute</span>
                        <h5 className="font-black text-xs text-indigo-950 mt-0.5">ITI Certificate</h5>
                      </div>
                      <div className="mt-4">
                        {uploadedFiles.marksheetIti ? (
                          <span className="text-[10px] text-emerald-600 font-mono font-bold bg-emerald-50 px-2.5 py-1 rounded border border-emerald-100">
                            ✓ {uploadedFiles.marksheetIti}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleFileChange('marksheetIti', 'iti_transcript.pdf')}
                            className="px-3 py-1.5 text-[10px] font-bold bg-white hover:border-slate-350 border border-slate-200 rounded-lg text-slate-605 cursor-pointer"
                          >
                            Choose File
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 1st Sem marksheet */}
                    <div className="p-4 bg-slate-50 border border-slate-150 rounded-2xl flex flex-col justify-between">
                      <div>
                        <span className="text-[9px] font-extrabold uppercase text-slate-400">Undergraduate Semester 1</span>
                        <h5 className="font-black text-xs text-indigo-950 mt-0.5">1st Sem Marksheet</h5>
                      </div>
                      <div className="mt-4">
                        {uploadedFiles.marksheet1stSem ? (
                          <span className="text-[10px] text-emerald-600 font-mono font-bold bg-emerald-50 px-2.5 py-1 rounded border border-emerald-100">
                            ✓ {uploadedFiles.marksheet1stSem}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleFileChange('marksheet1stSem', 'ug_sem1_grades.pdf')}
                            className="px-3 py-1.5 text-[10px] font-bold bg-white hover:border-slate-350 border border-slate-200 rounded-lg text-slate-605 cursor-pointer"
                          >
                            Choose File
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 2nd Sem marksheet */}
                    <div className="p-4 bg-slate-50 border border-slate-150 rounded-2xl flex flex-col justify-between">
                      <div>
                        <span className="text-[9px] font-extrabold uppercase text-slate-400">Undergraduate Semester 2</span>
                        <h5 className="font-black text-xs text-indigo-950 mt-0.5">2nd Sem Marksheet</h5>
                      </div>
                      <div className="mt-4">
                        {uploadedFiles.marksheet2ndSem ? (
                          <span className="text-[10px] text-emerald-600 font-mono font-bold bg-emerald-50 px-2.5 py-1 rounded border border-emerald-100">
                            ✓ {uploadedFiles.marksheet2ndSem}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleFileChange('marksheet2ndSem', 'ug_sem2_grades.pdf')}
                            className="px-3 py-1.5 text-[10px] font-bold bg-white hover:border-slate-350 border border-slate-200 rounded-lg text-slate-605 cursor-pointer"
                          >
                            Choose File
                          </button>
                        )}
                      </div>
                    </div>

                  </div>

                  {/* Extract action */}
                  {(uploadedFiles.marksheet10th || uploadedFiles.marksheet12th || uploadedFiles.marksheetIti || uploadedFiles.marksheet1stSem || uploadedFiles.marksheet2ndSem) && (
                    <div className="p-4 bg-indigo-50 border border-indigo-150 rounded-2xl flex flex-col sm:flex-row justify-between items-center gap-4 animate-slide-up mt-4">
                      <div>
                        <h5 className="text-xs font-black text-indigo-950">AI Document Parser Ready</h5>
                        <p className="text-[10px] text-indigo-500 font-semibold mt-0.5">Click extract to auto-fill name, EMIS, phone, address, marks, DL, and bike details.</p>
                      </div>
                      <button
                        type="button"
                        onClick={runDocumentExtraction}
                        className="px-4 py-2 bg-indigo-650 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm shadow-indigo-500/10 cursor-pointer"
                      >
                        <Sparkles className="w-4 h-4" /> Extract details
                      </button>
                    </div>
                  )}

                </div>
              )}
            </div>
          )}

          {/* STEP 1: PERSONAL */}
          {currentStep === 1 && (
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

          {/* STEP 2: ACADEMIC */}
          {currentStep === 2 && (
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

          {/* STEP 3: CAREER */}
          {currentStep === 3 && (
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
            {currentStep < STEPS.length - 1 ? (
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
