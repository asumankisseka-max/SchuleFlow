import { useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Camera,
  Download,
  FileSpreadsheet,
  FileText,
  GraduationCap,
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
  SubjectDefinition,
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
  subjects?: SubjectDefinition[];
  combinations: SubjectCombination[];
  schoolName: string;
  academicYear: string;
  userRole: UserRole;
  curriculumScope?: CurriculumScope;
  onAddStudent: (student: StudentProfile) => void;
  onBulkAddStudents: (students: StudentProfile[]) => void;
  onUpdateStudent: (student: StudentProfile) => void;
  onDeleteStudent?: (studentId: string) => void;
  onUploadStudentPhoto?: (studentId: string, dataUrl: string) => Promise<string>;
  onBulkPromote: (
    studentIds: string[],
    options: {
      targetClassId?: string;
      targetAcademicYear?: string;
      targetStatus?: 'active' | 'transferred' | 'inactive';
      updateSchoolYear?: boolean;
      resetElectives?: boolean;
    }
  ) => void;
  onViewHistory: (studentId: string) => void;
  onViewReportCard: (classId: string, studentId: string) => void;
}

export function StudentsView({
  students,
  classes,
  subjects = [],
  combinations,
  schoolName,
  academicYear,
  userRole,
  curriculumScope = 'olevel_alevel',
  onAddStudent,
  onBulkAddStudents,
  onUpdateStudent,
  onDeleteStudent,
  onUploadStudentPhoto,
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
  const [customOfferingsEnabled, setCustomOfferingsEnabled] = useState(false);
  const [offeredSubjectIds, setOfferedSubjectIds] = useState<string[]>([]);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | undefined>(undefined);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Bulk promote selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [promoteTargetClassId, setPromoteTargetClassId] = useState(
    scopedClasses[1]?.id ?? scopedClasses[0]?.id ?? ''
  );

  // End-of-Year Class Promotion modal state
  const [promoModalOpen, setPromoModalOpen] = useState(false);
  const [promoSourceClassId, setPromoSourceClassId] = useState(scopedClasses[0]?.id ?? '');
  const [promoMode, setPromoMode] = useState<'promote' | 'graduate'>('promote');
  const [promoTargetClassId, setPromoTargetClassId] = useState(
    scopedClasses[1]?.id ?? scopedClasses[0]?.id ?? ''
  );
  const [promoAcademicYear, setPromoAcademicYear] = useState(() => {
    const num = Number(academicYear);
    return Number.isFinite(num) && num > 2000 ? String(num + 1) : academicYear;
  });
  const [promoUpdateSchoolYear, setPromoUpdateSchoolYear] = useState(false);
  const [promoResetElectives, setPromoResetElectives] = useState(true);
  const [promoStudentIds, setPromoStudentIds] = useState<string[]>([]);

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
  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
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

  const suggestPromotionTarget = (sourceClsId: string) => {
    const src = classMap.get(sourceClsId);
    const activeInSource = students
      .filter((s) => s.classId === sourceClsId && s.status === 'active')
      .map((s) => s.id);
    setPromoStudentIds(activeInSource);

    if (!src) return;
    const gradeOrder = ['S.1', 'S.2', 'S.3', 'S.4', 'S.5', 'S.6'];
    const idx = gradeOrder.indexOf(src.gradeLevel);
    if (src.gradeLevel === 'S.6' || (src.gradeLevel === 'S.4' && !showAlevel)) {
      setPromoMode('graduate');
      return;
    }
    setPromoMode('promote');
    if (idx >= 0 && idx + 1 < gradeOrder.length) {
      const nextGrade = gradeOrder[idx + 1];
      const exactStreamMatch = scopedClasses.find(
        (c) =>
          c.id !== src.id &&
          c.gradeLevel === nextGrade &&
          (c.stream ?? '').toLowerCase() === (src.stream ?? '').toLowerCase()
      );
      const gradeMatch = scopedClasses.find(
        (c) => c.id !== src.id && c.gradeLevel === nextGrade
      );
      const fallback = scopedClasses.find((c) => c.id !== src.id) ?? scopedClasses[0];
      setPromoTargetClassId((exactStreamMatch ?? gradeMatch ?? fallback)?.id ?? '');
    }
  };

  const openPromoModal = () => {
    const defaultSrc =
      (classFilter !== 'all' ? classFilter : undefined) ??
      scopedClasses.find((c) =>
        students.some((s) => s.classId === c.id && s.status === 'active')
      )?.id ??
      scopedClasses[0]?.id ??
      '';
    setPromoSourceClassId(defaultSrc);
    const num = Number(academicYear);
    setPromoAcademicYear(Number.isFinite(num) && num > 2000 ? String(num + 1) : academicYear);
    setPromoUpdateSchoolYear(false);
    setPromoResetElectives(true);
    suggestPromotionTarget(defaultSrc);
    setPromoModalOpen(true);
  };

  const promoSourceStudents = useMemo(
    () =>
      students
        .filter((s) => s.classId === promoSourceClassId && s.status === 'active')
        .sort((a, b) => (a.studentId || a.admissionNo).localeCompare(b.studentId || b.admissionNo)),
    [students, promoSourceClassId]
  );

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
    setCustomOfferingsEnabled(false);
    setOfferedSubjectIds(classMap.get(defaultClass)?.subjectIds ?? []);
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
    const hasCustom = Boolean(stu.offeredSubjectIds && stu.offeredSubjectIds.length > 0);
    setCustomOfferingsEnabled(hasCustom);
    setOfferedSubjectIds(
      hasCustom
        ? stu.offeredSubjectIds ?? []
        : classMap.get(stu.classId)?.subjectIds ?? []
    );
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

    const resolvedOfferedSubjects =
      customOfferingsEnabled && offeredSubjectIds.length > 0
        ? offeredSubjectIds
        : undefined;

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
      offeredSubjectIds: resolvedOfferedSubjects,
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
                onClick={openPromoModal}
                className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-900 hover:bg-blue-100 whitespace-nowrap shrink-0"
              >
                <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
                <span>End-of-Year Promotion</span>
              </button>
              <button
                type="button"
                onClick={() => downloadStudentImportTemplate(schoolName)}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
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
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                <span>Import Excel</span>
              </button>
              <button
                type="button"
                onClick={openAddModal}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-950 whitespace-nowrap shrink-0"
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
                onBulkPromote(selectedIds, {
                  targetClassId: promoteTargetClassId,
                  resetElectives: true,
                });
                setSelectedIds([]);
              }}
              className="inline-flex items-center gap-1 rounded bg-blue-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-950 whitespace-nowrap shrink-0"
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
                          {canEdit && onDeleteStudent && (
                            confirmDeleteId === stu.id ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    onDeleteStudent(stu.id);
                                    setConfirmDeleteId(null);
                                  }}
                                  className="rounded bg-red-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-800"
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-600"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(stu.id)}
                                title="Delete student record (only if no marks recorded)"
                                className="rounded border border-slate-200 bg-white p-1 text-slate-400 hover:text-red-700 hover:border-red-200"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )
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
                      e.currentTarget.value = '';
                      if (!f) return;
                      setUploadingPhoto(true);
                      setFormError(null);
                      try {
                        const processed = await processStudentPhoto(f);
                        const entityId =
                          editingStudent?.id ?? `stu-${admissionNo.trim() || Date.now()}`;
                        const finalUrl = onUploadStudentPhoto
                          ? await onUploadStudentPhoto(entityId, processed)
                          : processed;
                        setPhotoDataUrl(finalUrl);
                      } catch (err) {
                        setFormError(
                          err instanceof Error ? err.message : 'Failed to process student photo.'
                        );
                      } finally {
                        setUploadingPhoto(false);
                      }
                    }}
                  />
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={uploadingPhoto}
                      onClick={() => photoInputRef.current?.click()}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Camera className="h-3 w-3" />
                      <span>{uploadingPhoto ? 'Uploading...' : 'Photo'}</span>
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
                    onChange={(e) => {
                      const nextCid = e.target.value;
                      setClassId(nextCid);
                      if (!customOfferingsEnabled) {
                        setOfferedSubjectIds(classMap.get(nextCid)?.subjectIds ?? []);
                      }
                    }}
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

              {selectedFormClass && selectedFormClass.subjectIds.length > 0 && subjects.length > 0 && (
                <div className="pt-2 border-t border-slate-200 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-2 font-medium text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={customOfferingsEnabled}
                        onChange={(e) => {
                          const enabled = e.target.checked;
                          setCustomOfferingsEnabled(enabled);
                          if (enabled && offeredSubjectIds.length === 0) {
                            setOfferedSubjectIds(selectedFormClass.subjectIds);
                          }
                        }}
                      />
                      <span>Customize subjects offered by this student (electives)</span>
                    </label>
                    <span className="text-[11px] text-slate-400">
                      {customOfferingsEnabled
                        ? `${offeredSubjectIds.length} selected`
                        : selectedFormClass.level === 'alevel'
                          ? 'Uses A-Level combination'
                          : 'All class subjects'}
                    </span>
                  </div>

                  {customOfferingsEnabled && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 rounded-md border border-slate-200 bg-slate-50 p-2.5">
                      {selectedFormClass.subjectIds.map((sid) => {
                        const sub = subjectMap.get(sid);
                        if (!sub) return null;
                        const checked = offeredSubjectIds.includes(sid);
                        return (
                          <label
                            key={sid}
                            className="inline-flex items-center gap-1.5 text-[11px] text-slate-800 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setOfferedSubjectIds((prev) =>
                                  prev.includes(sid)
                                    ? prev.filter((id) => id !== sid)
                                    : [...prev, sid]
                                );
                              }}
                            />
                            <span className="truncate">{sub.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

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

      {/* End-of-Year Class Promotion Modal */}
      {promoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  End-of-Year Student Promotion
                </h3>
                <p className="text-xs text-slate-500">
                  Promote an entire class to the next grade or mark graduating finalists (S.4 / S.6) inactive while keeping historical reports intact.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPromoModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Source Class (Current)
                  </label>
                  <select
                    value={promoSourceClassId}
                    onChange={(e) => {
                      const nextSrc = e.target.value;
                      setPromoSourceClassId(nextSrc);
                      suggestPromotionTarget(nextSrc);
                    }}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900"
                  >
                    {scopedClasses.map((c) => {
                      const activeCount = students.filter(
                        (s) => s.classId === c.id && s.status === 'active'
                      ).length;
                      return (
                        <option key={c.id} value={c.id}>
                          {c.name} ({activeCount} active)
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Promotion Action
                  </label>
                  <select
                    value={promoMode}
                    onChange={(e) =>
                      setPromoMode(e.target.value as 'promote' | 'graduate')
                    }
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900"
                  >
                    <option value="promote">Promote to Next Class</option>
                    <option value="graduate">
                      Graduate / Complete Year (Mark Inactive)
                    </option>
                  </select>
                </div>

                {promoMode === 'promote' && (
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Destination Class
                    </label>
                    <select
                      value={promoTargetClassId}
                      onChange={(e) => setPromoTargetClassId(e.target.value)}
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900"
                    >
                      {scopedClasses.map((c) => (
                        <option key={c.id} value={c.id} disabled={c.id === promoSourceClassId}>
                          {c.name} ({c.level === 'olevel' ? "O'Level" : "A'Level"})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Target Academic Year
                  </label>
                  <input
                    type="text"
                    value={promoAcademicYear}
                    onChange={(e) => setPromoAcademicYear(e.target.value)}
                    placeholder="e.g. 2027"
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-slate-900"
                  />
                </div>
              </div>

              <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                {promoMode === 'promote' && (
                  <label className="flex items-center gap-2 text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={promoResetElectives}
                      onChange={(e) => setPromoResetElectives(e.target.checked)}
                    />
                    <span>
                      Reset custom elective subject overrides so promoted students inherit the destination class subjects
                    </span>
                  </label>
                )}
                <label className="flex items-center gap-2 text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={promoUpdateSchoolYear}
                    onChange={(e) => setPromoUpdateSchoolYear(e.target.checked)}
                  />
                  <span>
                    Also advance school workspace academic year to{' '}
                    <strong className="font-mono">{promoAcademicYear || academicYear}</strong>
                  </span>
                </label>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">
                    Students in Source Class ({promoStudentIds.length}/{promoSourceStudents.length} selected — uncheck repeaters)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPromoStudentIds(promoSourceStudents.map((s) => s.id))}
                      className="text-blue-800 hover:underline font-medium"
                    >
                      Select All
                    </button>
                    <span className="text-slate-300">·</span>
                    <button
                      type="button"
                      onClick={() => setPromoStudentIds([])}
                      className="text-slate-600 hover:underline font-medium"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {promoSourceStudents.length === 0 ? (
                  <div className="rounded-md border border-slate-200 p-4 text-center text-slate-500">
                    No active students currently enrolled in this class.
                  </div>
                ) : (
                  <div className="max-h-56 overflow-y-auto divide-y divide-slate-200 rounded-md border border-slate-200">
                    {promoSourceStudents.map((stu) => {
                      const checked = promoStudentIds.includes(stu.id);
                      return (
                        <label
                          key={stu.id}
                          className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setPromoStudentIds((prev) =>
                                  prev.includes(stu.id)
                                    ? prev.filter((id) => id !== stu.id)
                                    : [...prev, stu.id]
                                )
                              }
                            />
                            <span className="font-mono font-semibold text-slate-700">
                              {stu.studentId || stu.admissionNo}
                            </span>
                            <span className="font-medium text-slate-900 truncate">
                              {stu.fullName}
                            </span>
                          </div>
                          <span className="text-[11px] font-mono text-slate-500 shrink-0">
                            Year {stu.academicYear}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
              <button
                type="button"
                onClick={() => setPromoModalOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  promoStudentIds.length === 0 ||
                  (promoMode === 'promote' &&
                    (!promoTargetClassId || promoTargetClassId === promoSourceClassId))
                }
                onClick={() => {
                  onBulkPromote(promoStudentIds, {
                    targetClassId: promoMode === 'promote' ? promoTargetClassId : undefined,
                    targetAcademicYear: promoAcademicYear.trim() || academicYear,
                    targetStatus: promoMode === 'graduate' ? 'inactive' : 'active',
                    updateSchoolYear: promoUpdateSchoolYear,
                    resetElectives: promoMode === 'promote' ? promoResetElectives : false,
                  });
                  setPromoModalOpen(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-950 disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {promoMode === 'graduate'
                    ? `Graduate ${promoStudentIds.length} Student(s)`
                    : `Promote ${promoStudentIds.length} Student(s)`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
