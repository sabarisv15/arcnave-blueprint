import React from 'react';
import { AlertTriangle, Phone, X } from 'lucide-react';

/**
 * LowAttendanceModal
 * Props:
 *   students - array of student objects (with .name, .roll_number, .attendance, .phone, .parent_phone)
 *   onClose - function to close the modal
 */
export default function LowAttendanceModal({ students = [], onClose }) {
  const sorted = [...students].sort((a, b) => (a.attendance || 0) - (b.attendance || 0));

  return (
    <div className="modal-backdrop">
      <div className="modal-panel w-full max-w-lg">

        {/* Header */}
        <div className="px-6 py-4 border-b flex justify-between items-center"
          style={{ background: 'rgba(244,63,94,0.08)', borderColor: 'rgba(244,63,94,0.2)' }}>
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-rose-400 animate-pulse" />
            <div>
              <h2 className="text-base font-extrabold text-slate-100">Low Attendance Alert</h2>
              <p className="text-xs text-slate-500 font-medium mt-0.5">Students below 75% threshold</p>
            </div>
            <span className="badge badge-rose">{sorted.length} student{sorted.length !== 1 ? 's' : ''}</span>
          </div>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-200 text-xl leading-none transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Table */}
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          {sorted.length === 0 ? (
            <p className="text-center text-slate-600 font-semibold py-8">
              All students are above 75% 🎉
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Student</th>
                  <th>Contact</th>
                  <th className="text-center">Attendance</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s, i) => {
                  const att = s.attendance || 0;
                  const badgeClass = att < 60 ? 'badge badge-rose' : 'badge badge-amber';
                  return (
                    <tr key={s._id || i}>
                      <td className="text-slate-700 font-bold text-xs w-8">{i + 1}</td>
                      <td>
                        <div className="font-bold text-slate-100">{s.name || s.full_name}</div>
                        <div className="font-mono text-xs text-slate-600">{s.roll_number || s.roll_no}</div>
                        {s.parent_name && (
                          <div className="text-xs text-slate-600 mt-0.5">Parent: {s.parent_name}</div>
                        )}
                      </td>
                      <td>
                        {(s.phone || s.parent_phone) && (
                          <div className="flex items-center gap-1 text-xs text-slate-500">
                            <Phone className="w-3 h-3 text-slate-700" />
                            <div>
                              <div>{s.phone}</div>
                              {s.parent_phone && <div className="text-slate-600">{s.parent_phone}</div>}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="text-center">
                        <span className={badgeClass}>{att}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-end"
          style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
          <button type="button" onClick={onClose} className="btn-ghost text-xs">Close</button>
        </div>

      </div>
    </div>
  );
}
