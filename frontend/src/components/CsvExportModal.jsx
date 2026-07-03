import React, { useState } from 'react';
import { Download } from 'lucide-react';

// Column definitions — matches new MongoDB schema field names
const SECTIONS = [
  {
    title: "Personal Details",
    id: "personal",
    columns: [
      { id: "roll_number", label: "Roll Number" },
      { id: "name", label: "Full Name" },
      { id: "umis_number", label: "UMIS Number" },
      { id: "emis_number", label: "EMIS Number" },
      { id: "email", label: "Email Address" },
      { id: "phone", label: "Phone Number" },
      { id: "address", label: "Home Address" },
      { id: "pincode", label: "Pincode" }
    ]
  },
  {
    title: "Parent Details",
    id: "parents",
    columns: [
      { id: "parent_name", label: "Parent Name" },
      { id: "parent_phone", label: "Parent Phone" },
    ]
  },
  {
    title: "Academic Marks",
    id: "academic",
    columns: [
      { id: "mark_10th", label: "10th SSLC %" },
      { id: "mark_12th", label: "12th HSC %" },
      { id: "mark_iti", label: "ITI %" },
      { id: "marks_sem1", label: "Sem 1 Marks" },
      { id: "marks_sem2", label: "Sem 2 Marks" },
      { id: "marks_sem3", label: "Sem 3 Marks" },
      { id: "marks_sem4", label: "Sem 4 Marks" },
    ]
  },
  {
    title: "Stay & Vehicle Info",
    id: "stay",
    columns: [
      { id: "accommodation", label: "Stay Type" },
      { id: "driving_license", label: "Driving License" },
      { id: "vehicle_number", label: "Vehicle Number" },
    ]
  },
  {
    title: "Club & Career",
    id: "career",
    columns: [
      { id: "club", label: "Extra-Curricular Club" },
      { id: "internship", label: "Internship" },
      { id: "career_plan", label: "Career Plan" },
      { id: "notes", label: "Tutor Remarks" },
    ]
  },
  {
    title: "Attendance",
    id: "attendance",
    columns: [
      { id: "attendance", label: "Attendance %" },
      { id: "blood_group", label: "Blood Group" },
      { id: "dob", label: "Date of Birth" },
    ]
  }
];

/**
 * CsvExportModal
 * Props:
 *   students - array of student objects
 *   className - class label to use in filename
 *   onClose - close handler
 */
export default function CsvExportModal({ students = [], className = 'class', onClose }) {
  // Initialize all columns as checked
  const initialChecked = {};
  SECTIONS.forEach(sec => sec.columns.forEach(col => { initialChecked[col.id] = true; }));
  const [checkedColumns, setCheckedColumns] = useState(initialChecked);

  const toggleColumn = (id) => {
    setCheckedColumns(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleSection = (sectionId, value) => {
    const section = SECTIONS.find(s => s.id === sectionId);
    if (!section) return;
    const updates = {};
    section.columns.forEach(col => { updates[col.id] = value; });
    setCheckedColumns(prev => ({ ...prev, ...updates }));
  };

  const isSectionFullyChecked = (sectionId) => {
    const section = SECTIONS.find(s => s.id === sectionId);
    return section && section.columns.every(col => checkedColumns[col.id]);
  };

  const checkAll = (value) => {
    const updates = {};
    SECTIONS.forEach(sec => sec.columns.forEach(col => { updates[col.id] = value; }));
    setCheckedColumns(updates);
  };

  const handleExport = () => {
    const activeHeaders = [];
    const activeIds = [];
    SECTIONS.forEach(sec => {
      sec.columns.forEach(col => {
        if (checkedColumns[col.id]) {
          activeHeaders.push(col.label);
          activeIds.push(col.id);
        }
      });
    });

    if (activeIds.length === 0) {
      alert('Please select at least one column to export.');
      return;
    }

    const csvRows = [];
    // Header row
    csvRows.push(activeHeaders.map(h => `"${h.replace(/"/g, '""')}"`).join(','));

    // Data rows
    students.forEach(student => {
      const values = activeIds.map(id => {
        // Support both old schema aliases and new schema field names
        let val = student[id];
        // Aliases for old schema
        if (val === undefined) {
          const aliases = {
            roll_number: student.roll_no,
            name: student.full_name,
            vehicle_number: student.bike_number,
            driving_license: student.license_number,
          };
          val = aliases[id];
        }
        if (val === undefined || val === null) val = '';
        return `"${String(val).replace(/"/g, '""')}"`;
      });
      csvRows.push(values.join(','));
    });

    const safeClassName = className.replace(/\s+/g, '_');
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + csvRows.join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${safeClassName}_students_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onClose();
  };

  const totalSelected = Object.values(checkedColumns).filter(Boolean).length;

  return (
    <div className="fixed inset-0 bg-[#1e1b4b]/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-indigo-100 max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="bg-indigo-50/50 px-6 py-4 border-b border-indigo-100 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-extrabold text-indigo-950">Export Student CSV</h2>
            <p className="text-xs text-indigo-400 font-medium mt-0.5">
              {students.length} students · <span className="text-primary font-bold">{totalSelected} columns selected</span>
            </p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-indigo-300 hover:text-indigo-700">&times;</button>
        </div>

        {/* Select All / Clear */}
        <div className="flex gap-4 px-6 py-3 border-b border-indigo-50 bg-indigo-50/20">
          <button onClick={() => checkAll(true)} className="text-xs font-bold text-indigo-600 hover:underline">
            Select All
          </button>
          <button onClick={() => checkAll(false)} className="text-xs font-bold text-indigo-400 hover:underline">
            Clear All
          </button>
        </div>

        {/* Column Sections */}
        <div className="p-6 overflow-y-auto flex-grow">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {SECTIONS.map((sec) => {
              const fullyChecked = isSectionFullyChecked(sec.id);
              return (
                <div key={sec.id} className="p-4 bg-indigo-50/20 border border-indigo-100 rounded-xl space-y-3">
                  <div className="flex justify-between items-center border-b border-indigo-100/50 pb-2">
                    <h3 className="font-extrabold text-xs text-indigo-950 uppercase tracking-wider">{sec.title}</h3>
                    <input
                      type="checkbox"
                      checked={fullyChecked}
                      onChange={e => toggleSection(sec.id, e.target.checked)}
                      className="w-4 h-4 accent-indigo-600 cursor-pointer"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {sec.columns.map(col => (
                      <label key={col.id} className="flex items-center gap-2 text-xs font-semibold text-indigo-700 cursor-pointer hover:text-primary">
                        <input
                          type="checkbox"
                          checked={!!checkedColumns[col.id]}
                          onChange={() => toggleColumn(col.id)}
                          className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer"
                        />
                        <span>{col.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-indigo-50/30 border-t border-indigo-100 flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="btn-outline text-xs">Cancel</button>
          <button
            type="button"
            onClick={handleExport}
            disabled={students.length === 0 || totalSelected === 0}
            className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            Download CSV ({students.length} rows)
          </button>
        </div>

      </div>
    </div>
  );
}
