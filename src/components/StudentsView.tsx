import { useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Camera,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Plus,
  Search,
  Trash2,
  User,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import type {
  CurriculumScope,
  StreamClass,
  StudentProfile,
  StudentStatus,
  SubjectCombination,
  UserRole,
} from '../types';
import {
  downloadStudentImportTemplate,
  parseExcelFile,
  parseStudentDirectoryExcel,
  type StudentDirectoryImportRow,
} from '../utils/excel';
import {
  extractSchoolInitials,
  formatStudentId,
  generateNextStudentId,
  getNextSequenceNumber,
} from '../utils/idGenerator';
import { processStudentPhoto } from '../utils/photo';
import { canManageAcademicSetup } from '../utils/rbac';
import { validateUgandanPhone } from '../utils/validation';

interface StudentsViewProps {
  students: StudentProfile[];
  classes: StreamClass[];
  combinations: SubjectCombination[];
  schoolName: string;
  academicYear: string;
  userRole: UserRole;
  curriculumScope?: CurriculumScope;
  onAddStudent: (student: StudentProfile) => void;
  onBulkAddStudents: (students: StudentProfile[]) => void;
  onUpdateStudent: (student: StudentProfile) => void;
  onBulkPromote: (studentIds: string[], targetClassId: string) => void;
  onViewHistory: (studentId: string) => void;
  onViewReportCard: (classId: string, studentId: string) => void;
}

export function StudentsView({
  students,
  classes,
  combinations,
  schoolName,
  academicYear,
  userRole,
  curriculumScope = 'olevel_alevel',
  onAddStudent,
  onBulkAddStudents,
  onUpdateStudent,
  onBulkPromote,
  onViewHistory,
  onViewReportCard,
}: StudentsViewProps) {
  const canEdit = canManageAcademicSetup(userRole);
  const showAlevel = curriculumScope !== 'olevel_only';
  const scopedClasses = useMemo(() => {
    const filtered = classes.filter((c) =>
      curriculumScope === 'olevel_only'
        ? c.level === 'olevel'
        : curriculumScope === 'alevel_only'
          ? c.level === 'alevel'
          : true
    );
    return filtered.length > 0 ? filtered : classes;
  }, [classes, curriculumScope]);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StudentStatus | 'all'>('active');

  const [editingStudent, setEditingStudent] = useState<StudentProfile | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Form fields
  const [admissionNo, setAdmissionNo] = useState('');
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState<'M' | 'F'>('F');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [classId, setClassId] = useState(scopedClasses[0]?.id ?? '');
  const [combinationId, setCombinationId] = useState('');
  const [parentName, setParentName] = useState('');
  const [parentContact, setParentContact] = useState('');
  const [status, setStatus] = useState<StudentStatus>('active');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);

  // Bulk promote selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [promoteTargetClassId, setPromoteTargetClassId] = useState(
    scopedClasses[1]?.id ?? scopedClasses[0]?.id ?? ''
  );

  // Excel import modal state
  const [importRows, setImportRows] = useState<StudentDirectoryImportRow[] | null>(null);
  const [importClassId, setImportClassId] = useState(scopedClasses[0]?.id ?? '');
  const [importError, setImportError] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  const schoolInitials = useMemo(() => extractSchoolInitials(schoolName), [schoolName]);
  const nextStudentIdPreview = useMemo(
    () =>
      generateNextStudentId(
        schoolInitials,
        students.map((s) => s.studentId),
        true
      ),
    [schoolInitials, students]
  );
  const nextStudentSeqStart = useMemo(
    () =>
      getNextSequenceNumber(
        students.map((s) => s.studentId),
        'STD'
      ),
    [students]
  );

  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const comboMap = useMemo(() => new Map(combinations.map((c) => [c.id, c])), [combinations]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students
      .filter((s) => {
        if (classFilter !== 'all' && s.classId !== classFilter) return false;
        if (statusFilter !== 'all' && s.status !== statusFilter) return false;
        if (q) {
          return (
            s.fullName.toLowerCase().includes(q) ||
            (s.studentId ?? '').toLowerCase().includes(q) ||
            s.admissionNo.toLowerCase().includes(q) ||
            (s.parentName ?? '').toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => (a.studentId || a.admissionNo).localeCompare(b.studentId || b.admissionNo));
  }, [students, classFilter, statusFilter, search]);

  const openAddModal = () => {
    setEditingStudent(null);
    setAdmissionNo(nextStudentIdPreview);
    setFullName('');
    setGender('F');
    setDateOfBirth('');
    const defaultClass = classFilter !== 'all' ? classFilter : scopedClasses[0]?.id ?? '';
    setClassId(defaultClass);
    setCombinationId('');
    setParentName('');
    setParentContact('');
    setStatus('active');
    setPhotoDataUrl(undefined);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (stu: StudentProfile) => {
    setEditingStudent(stu);
    setAdmissionNo(stu.admissionNo);
    setFullName(stu.fullName);
    setGender(stu.gender);
    setDateOfBirth(stu.dateOfBirth ?? '');
    setClassId(stu.classId);
    setCombinationId(stu.combinationId ?? '');
    setParentName(stu.parentName ?? '');
    setParentContact(stu.parentContact ?? '');
    setStatus(stu.status);
    setPhotoDataUrl(stu.photoDataUrl);
    setFormError(null);
    setModalOpen(true);
  };

  const selectedFormClass = classMap.get(classId);

  const handleSaveStudent = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanAdm = admissionNo.trim();
    const cleanName = fullName.trim();
    if (!cleanAdm || !cleanName) {
      setFormError('Admission Number and Student Full Name are required.');
      return;
    }
    const duplicate = students.find(
      (s) =>
        s.admissionNo.trim().toLowerCase() === cleanAdm.toLowerCase() &&
        s.id !== editingStudent?.id
    );
    if (duplicate) {
      setFormError(`Admission No "${cleanAdm}" is already assigned to ${duplicate.fullName}.`);
      return;
    }

    const phoneCheck = validateUgandanPhone(parentContact, false);
    if (!phoneCheck.valid) {
      setFormError(phoneCheck.error ?? 'Invalid Ugandan parent phone number.');
      return;
    }

    const payload: StudentProfile = {
      id: editingStudent?.id ?? `stu-${Date.now()}`,
      studentId: editingStudent?.studentId,
      admissionNo: cleanAdm,
      fullName: cleanName,
      gender,
      dateOfBirth: dateOfBirth || undefined,
      classId,
      academicYear,
      status,
      combinationId:
        selectedFormClass?.level === 'alevel' ? combinationId || combinations[0]?.id : undefined,
      parentName: parentName.trim() || undefined,
      parentContact: phoneCheck.normalized || undefined,
      photoDataUrl,
    };

    if (editingStudent) {
      onUpdateStudent(payload);
    } else {
      onAddStudent(payload);
    }
    setModalOpen(false);
  };

  const handleExcelSelect = async (file: File) => {
    setImportError(null);
    try {
      const wb = await parseExcelFile(file);
      const sheet = wb.sheets[0];
      if (!sheet || sheet.rows.length < 2) {
        setImportError('The uploaded spreadsheet appears to be empty.');
        return;
      }
      const existingAdms = new Set(students.map((s) => s.admissionNo.trim().toLowerCase()));
      const parsed = parseStudentDirectoryExcel(sheet.rows, existingAdms);
      setImportRows(parsed);
    } catch {
      setImportError('Could not read Excel file. Ensure it is a valid .xlsx or .csv file.');
    }
  };

  const confirmBulkImport = () => {
    if (!importRows) return;
    const valid = importRows.filter((r) => !r.isDuplicate && !r.phoneInvalid && r.fullName);
    const targetCls = classMap.get(importClassId);
    const newStudents: StudentProfile[] = valid.map((r, idx) => ({
      id: `stu-${Date.now()}-${idx}`,
      admissionNo: r.admissionNo,
      fullName: r.fullName,
      gender: r.gender,
      dateOfBirth: r.dateOfBirth,
      classId: importClassId,
      academicYear,
      status: 'active',
      combinationId: targetCls?.level === 'alevel' ? combinations[0]?.id : undefined,
      parentName: r.parentName,
      parentContact: r.parentContact,
    }));
    onBulkAddStudents(newStudents);
    setImportRows(null);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredStudents.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredStudents.map((s) => s.id));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-5">
      {/* Header Toolbar */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">Student Directory</h2>
          <p className="text-xs text-slate-500">
            Central registry keyed by unique Admission Number ({students.length} total students)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <>
              <button
                type="button"
                onClick={() => downloadStudentImportTemplate(schoolName)}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Excel Template</span>
              </button>
              <input
                ref={excelInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleExcelSelect(f);
                  e.currentTarget.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => excelInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                <span>Import Excel</span>
              </button>
              <button
                type="button"
                onClick={openAddModal}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-950 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Register Student</span>
              </button>
            </>
          )}
        </div>
      </div>

      {importError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
          {importError}
        </div>
      )}

      {/* Search & Filters */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search admission no, name, or parent..."
              className="w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 py-1.5 text-xs text-slate-900 focus:border-blue-800 focus:outline-none"
            />
          </div>

          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
          >
            <option value="all">All Classes &amp; Streams</option>
            {scopedClasses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.level === 'olevel' ? "O'Level" : "A'Level"})
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StudentStatus | 'all')}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
          >
            <option value="active">Active Students</option>
            <option value="transferred">Transferred</option>
            <option value="inactive">Inactive</option>
            <option value="all">All Statuses</option>
          </select>
        </div>

        {/* Bulk Promote Bar */}
        {canEdit && selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5">
            <span className="text-xs font-semibold text-blue-900">
              {selectedIds.length} selected
            </span>
            <select
              value={promoteTargetClassId}
              onChange={(e) => setPromoteTargetClassId(e.target.value)}
              className="rounded border border-blue-300 bg-white px-2 py-1 text-xs text-slate-900"
            >
              {scopedClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  Move to {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                onBulkPromote(selectedIds, promoteTargetClassId);
                setSelectedIds([]);
              }}
              className="inline-flex items-center gap-1 rounded bg-blue-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-950"
            >
              <ArrowRightLeft className="h-3 w-3" />
              <span>Promote / Transfer</span>
            </button>
          </div>
        )}
      </div>

      {/* Students Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
                {canEdit && (
                  <th className="py-2.5 px-3 w-9">
                    <input
                      type="checkbox"
                      checked={
                        filteredStudents.length > 0 &&
                        selectedIds.length === filteredStudents.length
                      }
                      onChange={toggleSelectAll}
                      aria-label="Select all students"
                    />
                  </th>
                )}
                <th className="py-2.5 px-3">Student ID / Adm No.</th>
                <th className="py-2.5 px-3">Student Name</th>
                <th className="py-2.5 px-3">Gender</th>
                <th className="py-2.5 px-3">Class / Stream</th>
                {showAlevel && <th className="py-2.5 px-3">Combination</th>}
                <th className="py-2.5 px-3">Parent Contact</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={showAlevel ? 9 : 8} className="py-10 text-center text-slate-500">
                    No students match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredStudents.map((stu) => {
                  const cls = classMap.get(stu.classId);
                  const combo = stu.combinationId ? comboMap.get(stu.combinationId) : undefined;
                  return (
                    <tr key={stu.id} className="hover:bg-slate-50/70">
                      {canEdit && (
                        <td className="py-2.5 px-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(stu.id)}
                            onChange={() => toggleOne(stu.id)}
                            aria-label={`Select ${stu.fullName}`}
                          />
                        </td>
                      )}
                      <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-slate-900">
                          {stu.studentId || stu.admissionNo}
                        </div>
                        {stu.studentId && stu.admissionNo && stu.studentId !== stu.admissionNo && (
                          <div className="text-[10px] text-slate-400">Adm: {stu.admissionNo}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className="h-7 w-7 rounded bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                            {stu.photoDataUrl ? (
                              <img
                                src={stu.photoDataUrl}
                                alt={stu.fullName}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <User className="h-3.5 w-3.5 text-slate-400" />
                            )}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900">{stu.fullName}</div>
                            {stu.dateOfBirth && (
                              <div className="text-[11px] text-slate-400 font-mono">
                                DOB: {stu.dateOfBirth}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">{stu.gender}</td>
                      <td className="py-2.5 px-3 text-slate-800 whitespace-nowrap">
                        {cls?.name ?? 'Unassigned'}{' '}
                        <span className="text-slate-400">
                          · {cls?.level === 'olevel' ? "O'Level" : "A'Level"}
                        </span>
                      </td>
                      {showAlevel && (
                        <td className="py-2.5 px-3 font-mono text-slate-700">
                          {combo?.code ?? (cls?.level === 'olevel' ? 'CBC' : '—')}
                        </td>
                      )}
                      <td className="py-2.5 px-3 text-slate-600">
                        <div>{stu.parentName || '—'}</div>
                        {stu.parentContact && (
                          <div className="font-mono text-[11px] text-slate-400">
                            {stu.parentContact}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium capitalize ${
                            stu.status === 'active'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : stu.status === 'transferred'
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                        >
                          {stu.status === 'active' ? (
                            <UserCheck className="h-3 w-3" />
                          ) : (
                            <UserX className="h-3 w-3" />
                          )}
                          {stu.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onViewHistory(stu.id)}
                            title="Academic History"
                            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <History className="h-3 w-3 text-blue-800" />
                            <span>History</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onViewReportCard(stu.classId, stu.id)}
                            title="Report Card"
                            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <FileText className="h-3 w-3 text-slate-600" />
                            <span>Report</span>
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditModal(stu)}
                              className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-blue-800 hover:bg-blue-50"
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Student Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h3 className="font-display text-base font-bold text-slate-900">
                {editingStudent ? 'Edit Student Record' : 'Register New Student'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveStudent} className="p-5 overflow-y-auto space-y-4 text-xs">
              {formError && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                  {formError}
                </div>
              )}

              <div className="rounded-md border border-blue-200 bg-blue-50/70 px-3 py-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-blue-900">
                  {editingStudent ? 'Assigned School Student ID' : 'Auto-Generated Student ID'}
                </span>
                <span className="font-mono text-xs font-bold text-blue-950">
                  {editingStudent
                    ? editingStudent.studentId || editingStudent.admissionNo
                    : nextStudentIdPreview}
                </span>
              </div>

              {/* Passport Photo + Core ID */}
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <div className="flex flex-col items-center gap-1.5 shrink-0">
                  <div className="h-24 w-20 rounded border border-slate-300 bg-slate-50 overflow-hidden flex items-center justify-center">
                    {photoDataUrl ? (
                      <img src={photoDataUrl} alt="Student" className="h-full w-full object-cover" />
                    ) : (
                      <User className="h-7 w-7 text-slate-300" />
                    )}
                  </div>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        const processed = await processStudentPhoto(f);
                        setPhotoDataUrl(processed);
                      }
                    }}
                  />
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Camera className="h-3 w-3" />
                      <span>Photo</span>
                    </button>
                    {photoDataUrl && (
                      <button
                        type="button"
                        onClick={() => setPhotoDataUrl(undefined)}
                        className="rounded border border-slate-300 p-0.5 text-slate-500 hover:text-red-700"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 w-full">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Admission Number *
                    </label>
                    <input
                      type="text"
                      required
                      value={admissionNo}
                      onChange={(e) => setAdmissionNo(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Full Name *</label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Surname GivenName"
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Gender</label>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value as 'M' | 'F')}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                    >
                      <option value="F">Female (F)</option>
                      <option value="M">Male (M)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Date of Birth (Optional)
                    </label>
                    <input
                      type="date"
                      value={dateOfBirth}
                      onChange={(e) => setDateOfBirth(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-200">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Class &amp; Stream</label>
                  <select
                    value={classId}
                    onChange={(e) => setClassId(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                  >
                    {scopedClasses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.level === 'olevel' ? "O'Level" : "A'Level"})
                      </option>
                    ))}
                  </select>
                </div>

                {showAlevel && selectedFormClass?.level === 'alevel' && (
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      A&apos;Level Combination
                    </label>
                    <select
                      value={combinationId}
                      onChange={(e) => setCombinationId(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                    >
                      {combinations.map((cb) => (
                        <option key={cb.id} value={cb.id}>
                          {cb.code} — {cb.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Enrollment Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as StudentStatus)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                  >
                    <option value="active">Active</option>
                    <option value="transferred">Transferred</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Parent / Guardian Name
                  </label>
                  <input
                    type="text"
                    value={parentName}
                    onChange={(e) => setParentName(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Parent Contact (SMS / WhatsApp)
                  </label>
                  <input
                    type="text"
                    value={parentContact}
                    onChange={(e) => {
                      setFormError(null);
                      setParentContact(e.target.value);
                    }}
                    placeholder="+2567XXXXXXXX or 07XXXXXXXX"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-slate-900"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-md border border-slate-300 px-3.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-blue-900 px-4 py-1.5 font-medium text-white hover:bg-blue-950"
                >
                  {editingStudent ? 'Save Changes' : 'Register Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Excel Bulk Student Import Preview Modal */}
      {importRows && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Preview Bulk Student Import
                </h3>
                <p className="text-xs text-slate-500">
                  {importRows.filter((r) => !r.isDuplicate && !r.phoneInvalid && r.fullName).length} valid new students ·{' '}
                  {importRows.filter((r) => r.isDuplicate).length} duplicate/skipped ·{' '}
                  {importRows.filter((r) => r.phoneInvalid).length} invalid phone
                </p>
              </div>
              <button
                type="button"
                onClick={() => setImportRows(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Assign Imported Students to Class
                </label>
                <select
                  value={importClassId}
                  onChange={(e) => setImportClassId(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-slate-900"
                >
                  {scopedClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.level === 'olevel' ? "O'Level" : "A'Level"})
                    </option>
                  ))}
                </select>
              </div>

              <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-700">
                      <th className="py-2 px-3">Student ID</th>
                      <th className="py-2 px-3">Adm No</th>
                      <th className="py-2 px-3">Name</th>
                      <th className="py-2 px-3">Gender</th>
                      <th className="py-2 px-3">Parent Phone (+256)</th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(() => {
                      let seqOffset = 0;
                      return importRows.map((row) => {
                        const isReady = !row.isDuplicate && !row.phoneInvalid && Boolean(row.fullName);
                        const projectedId = isReady
                          ? formatStudentId(schoolInitials, nextStudentSeqStart + seqOffset++)
                          : '—';
                        return (
                          <tr key={row.rowNumber}>
                            <td className="py-2 px-3 font-mono font-semibold text-blue-900">
                              {projectedId}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-600">
                              {row.admissionNo || `Auto (${projectedId})`}
                            </td>
                            <td className="py-2 px-3">{row.fullName || 'Missing'}</td>
                            <td className="py-2 px-3 font-mono">{row.gender}</td>
                            <td className="py-2 px-3 font-mono">
                              {row.phoneInvalid ? (
                                <span className="text-red-700">{row.parentContact || 'Invalid'}</span>
                              ) : (
                                row.parentContact || '—'
                              )}
                            </td>
                            <td className="py-2 px-3">
                              {row.isDuplicate ? (
                                <span className="text-amber-700 font-medium">
                                  Duplicate / Skipped
                                </span>
                              ) : row.phoneInvalid ? (
                                <span className="text-red-700 font-medium">
                                  Invalid Ugandan Phone
                                </span>
                              ) : !row.fullName ? (
                                <span className="text-red-700 font-medium">Missing Name</span>
                              ) : (
                                <span className="text-emerald-700 font-medium">Ready to Import</span>
                              )}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
              <button
                type="button"
                onClick={() => setImportRows(null)}
                className="rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={importRows.filter((r) => !r.isDuplicate && !r.phoneInvalid && r.fullName).length === 0}
                onClick={confirmBulkImport}
                className="rounded-md bg-blue-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-950 disabled:opacity-40"
              >
                Import {importRows.filter((r) => !r.isDuplicate && !r.phoneInvalid && r.fullName).length} Students
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
