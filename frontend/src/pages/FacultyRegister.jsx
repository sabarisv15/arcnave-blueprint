import React, { useState } from 'react';
import {
  GraduationCap, User, Mail, Phone, Building2,
  BookOpen, Award, ChevronLeft, CheckCircle2, ShieldAlert
} from 'lucide-react';

const DEPTS = ['CSE', 'ECE', 'EEE', 'MECH', 'CIVIL', 'IT', 'MBA', 'MCA'];

export default function FacultyRegister() {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', dob: '', gender: 'Male',
    department: 'CSE', designation: '', qualification: '',
    has_phd: false, address: '', college_code: 'demo'
  });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [requestId, setRequestId] = useState(null);

  const update = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(p => ({ ...p, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/faculty/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Submission failed');
      }
      const data = await res.json();
      setRequestId(data.request_id);
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 relative"
      style={{ backgroundColor: '#F7F9FC' }}>
      <div className="aurora-bg"><div className="aurora-orb-3" /></div>

      <div className="relative z-10 w-full max-w-lg animate-slide-up">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            style={{ background: 'linear-gradient(135deg, #5B5FEF, #4F46E5)' }}>
            <GraduationCap className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-gradient">Faculty Registration</h1>
          <p className="text-slate-500 text-sm font-semibold mt-1">Submit your profile for approval</p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-6" style={{ fontSize: 10, fontWeight: 700, color: '#64748b' }}>
          <span className="badge badge-violet">Submit</span>
          <span>→</span>
          <span className="badge badge-cyan">HOD Review</span>
          <span>→</span>
          <span className="badge badge-rose">Principal</span>
          <span>→</span>
          <span className="badge badge-emerald">Credentials</span>
        </div>

        {submitted ? (
          <div className="card p-10 text-center">
            <CheckCircle2 style={{ width: 64, height: 64, color: '#10b981', margin: '0 auto 16px' }} />
            <h2 className="text-2xl font-black text-slate-800 mb-2">Request Submitted!</h2>
            <p className="text-slate-500 mb-4">Your profile has been sent to the HOD for review. You will receive login credentials by email after Principal approval.</p>
            {requestId && (
              <p style={{ fontFamily: 'monospace', fontSize: 11, background: '#f1f5f9', borderRadius: 8, padding: '8px 14px', display: 'inline-block', color: '#64748b' }}>
                Ref: {requestId}
              </p>
            )}
            <div className="mt-6">
              <a href="/login" className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', padding: '10px 28px', textDecoration: 'none' }}>
                Back to Login
              </a>
            </div>
          </div>
        ) : (
          <div className="card p-8">
            <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(91,95,239,0.3), transparent)' }} />
            <a href="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#64748b', fontSize: 12, fontWeight: 700, textDecoration: 'none', marginBottom: 20 }}>
              <ChevronLeft style={{ width: 14, height: 14 }} /> Back to Login
            </a>

            {error && (
              <div className="flex items-center gap-3 bg-rose-50 border border-rose-200 text-rose-600 px-4 py-3 rounded-xl mb-5 text-sm font-medium">
                <ShieldAlert className="w-4 h-4 flex-shrink-0" />{error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="section-title block mb-1.5">College Code *</label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input name="college_code" value={form.college_code} onChange={update} placeholder="demo" className="pl-10" required style={{ textTransform: 'uppercase', fontFamily: 'monospace', letterSpacing: '0.1em' }} />
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="section-title block mb-1.5">Full Name *</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input name="name" value={form.name} onChange={update} placeholder="Dr. Firstname Lastname" className="pl-10" required />
                  </div>
                </div>
                <div>
                  <label className="section-title block mb-1.5">Email *</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input name="email" type="email" value={form.email} onChange={update} placeholder="you@example.com" className="pl-10" required />
                  </div>
                </div>
                <div>
                  <label className="section-title block mb-1.5">Phone</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input name="phone" value={form.phone} onChange={update} placeholder="9876543210" className="pl-10" />
                  </div>
                </div>
                <div>
                  <label className="section-title block mb-1.5">Department *</label>
                  <select name="department" value={form.department} onChange={update} className="w-full" required>
                    {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="section-title block mb-1.5">Gender</label>
                  <select name="gender" value={form.gender} onChange={update} className="w-full">
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="section-title block mb-1.5">Designation</label>
                  <div className="relative">
                    <Award className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input name="designation" value={form.designation} onChange={update} placeholder="Asst. Professor" className="pl-10" />
                  </div>
                </div>
                <div>
                  <label className="section-title block mb-1.5">Qualification</label>
                  <div className="relative">
                    <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input name="qualification" value={form.qualification} onChange={update} placeholder="M.E., B.Tech" className="pl-10" />
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="section-title block mb-1.5">Address</label>
                  <textarea name="address" value={form.address} onChange={update} placeholder="Residential address" rows={2} style={{ width: '100%', resize: 'none' }} />
                </div>
                <div className="col-span-2 flex items-center gap-3">
                  <input type="checkbox" id="has_phd" name="has_phd" checked={form.has_phd} onChange={update} style={{ width: 16, height: 16, accentColor: '#5B5FEF' }} />
                  <label htmlFor="has_phd" className="text-sm font-semibold text-slate-700">I hold a PhD</label>
                </div>
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base mt-6">
                {loading
                  ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Submitting...</span>
                  : 'Submit Profile Request'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
