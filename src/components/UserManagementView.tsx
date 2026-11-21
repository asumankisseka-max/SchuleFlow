import { useRef, useState } from 'react';
import {
  AlertCircle,
  Copy,
  Download,
  FileSpreadsheet,
  KeyRound,
  Plus,
  Shield,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import type {
  LoginActivityRecord,
  StreamClass,
  SubjectDefinition,
  UserAccount,
  UserRole,
} from '../types';
import {
  downloadStaffImportTemplate,
  parseExcelFile,
  parseStaffDirectoryExcel,
  type StaffDirectoryImportRow,
} from '../utils/excel';
import {
  extractSchoolInitials,
  formatStaffId,
  generateNextStaffId,
  getNextSequenceNumber,
} from '../utils/idGenerator';
import { isTeachingRole, ROLE_DISPLAY_NAMES } from '../utils/rbac';
import { validateUgandanPhone } from '../utils/validation';

interface UserManagementViewProps {
  users: UserAccount[];
  loginActivity: LoginActivityRecord[];
  classes: StreamClass[];
  subjects: SubjectDefinition[];
  schoolName?: string;
  currentUserId: string;
  onAddUser: (user: UserAccount) => void;
  onBulkAddUsers?: (users: UserAccount[]) => void;
  onUpdateUser: (user: UserAccount) => void;
  onResetPassword: (
    userId: string
  ) => Promise<{ temporaryPassword: string; staffId?: string | null; name: string } | void> | void;
}

export function UserManagementView({
  users,
  loginActivity,
  classes,
  subjects,
  schoolName = 'SchuleFlow',
  currentUserId,
  onAddUser,
  onBulkAddUsers,
  onUpdateUser,
  onResetPassword,
}: UserManagementViewProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('teacher');
  const [assignedClassIds, setAssignedClassIds] = useState<string[]>([]);
  const [assignedSubjectIds, setAssignedSubjectIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issuedTempCredential, setIssuedTempCredential] = useState<{
    name: string;
    staffId?: string | null;
    temporaryPassword: string;
  } | null>(null);
  const [resetTarget, setResetTarget] = useState<UserAccount | null>(null);
  const [resetting, setResetting] = useState(false);

  // Bulk Excel/CSV staff upload state
  const [importRows, setImportRows] = useState<StaffDirectoryImportRow[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const staffFileInputRef = useRef<HTMLInputElement | null>(null);

  const schoolInitials = extractSchoolInitials(schoolName);
  const nextStaffIdPreview = generateNextStaffId(
    schoolInitials,
    users.map((u) => u.staffId),
    true
  );
  const nextStaffSeqStart = getNextSequenceNumber(
    users.map((u) => u.staffId),
    'TCH'
  );

  const copyStaffId = async (staffId: string) => {
    try {
      await navigator.clipboard?.writeText(staffId);
      setNotice(`Copied Staff ID ${staffId} to clipboard.`);
    } catch {
      setNotice(`Staff ID: ${staffId}`);
    }
  };

  const openAdd = () => {
    setEditingUser(null);
    setName('');
    setEmail('');
    setUsername('');
    setPassword('');
    setPhone('');
    setRole('teacher');
    setAssignedClassIds([]);
    setAssignedSubjectIds([]);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (u: UserAccount) => {
    setEditingUser(u);
    setName(u.name);
    setEmail(u.email);
    setUsername(u.username);
    setPassword('');
    setPhone(u.phone ?? '');
    setRole(u.role === 'admin' ? 'school_admin' : u.role);
    setAssignedClassIds(u.assignedClassIds);
    setAssignedSubjectIds(u.assignedSubjectIds);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim() || !email.trim() || !username.trim()) return;
    if (!editingUser) {
      const p = password.trim();
      if (p.length < 8 || !/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) {
        setFormError('Initial password must be at least 8 characters and include a letter and a number.');
        return;
      }
    }

    const phoneCheck = validateUgandanPhone(phone, false);
    if (!phoneCheck.valid) {
      setFormError(phoneCheck.error ?? 'Invalid Ugandan mobile number.');
      return;
    }

    const payload: UserAccount = {
      id: editingUser?.id ?? `usr-${Date.now()}`,
      staffId: editingUser?.staffId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      username: username.trim().toLowerCase(),
      password: password.trim() || editingUser?.password || '',
      role,
      active: editingUser?.active ?? true,
      phone: phoneCheck.normalized || undefined,
      assignedClassIds,
      assignedSubjectIds,
      lastLogin: editingUser?.lastLogin,
    };
    if (editingUser) {
      onUpdateUser(payload);
    } else {
      onAddUser(payload);
    }
    setModalOpen(false);
  };

  const handleStaffExcelSelect = async (file: File) => {
    setImportError(null);
    try {
      const wb = await parseExcelFile(file);
      const sheet = wb.sheets[0];
      if (!sheet || sheet.rows.length < 2) {
        setImportError('The uploaded staff spreadsheet appears to be empty.');
        return;
      }
      const existingEmails = new Set(users.map((u) => u.email.trim().toLowerCase()));
      const parsed = parseStaffDirectoryExcel(sheet.rows, existingEmails, classes);
      setImportRows(parsed);
    } catch {
      setImportError('Could not read file. Ensure it is a valid .xlsx, .xls, or .csv spreadsheet.');
    }
  };

  const confirmBulkStaffImport = () => {
    if (!importRows) return;
    const valid = importRows.filter(
      (r) => !r.isDuplicate && !r.phoneInvalid && r.name && r.email
    );
    if (valid.length === 0) return;

    const accounts: UserAccount[] = valid.map((r, idx) => ({
      id: `usr-${Date.now()}-${idx}`,
      name: r.name,
      email: r.email,
      username: r.username,
      password: '',
      role: r.role,
      active: true,
      phone: r.phone || undefined,
      assignedClassIds: r.assignedClassIds,
      assignedSubjectIds: [],
    }));

    if (onBulkAddUsers) {
      onBulkAddUsers(accounts);
    } else {
      accounts.forEach((u) => onAddUser(u));
    }
    setNotice(`Bulk-imported ${accounts.length} staff / teacher account(s).`);
    setImportRows(null);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Staff User Accounts &amp; Role-Based Access
          </h2>
          <p className="text-xs text-slate-500">
            Create or bulk-upload Teachers, Class Teachers, Bursars, DoS, and School Administrators within your institution
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => downloadStaffImportTemplate(schoolName, classes)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Staff Template</span>
          </button>
          <input
            ref={staffFileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleStaffExcelSelect(f);
              e.currentTarget.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => staffFileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
            <span>Import Staff Excel/CSV</span>
          </button>
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-950 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Create Staff User</span>
          </button>
        </div>
      </div>

      {importError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{importError}</span>
        </div>
      )}

      {notice && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-900">
          {notice}
        </div>
      )}

      {issuedTempCredential && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="font-semibold">
              Temporary Password Issued for {issuedTempCredential.name}
              {issuedTempCredential.staffId ? ` (${issuedTempCredential.staffId})` : ''}
            </p>
            <p className="text-[11px] text-amber-900">
              Share this one-time password securely. The user will be forced to set a personal password on next login.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="rounded border border-amber-300 bg-white px-2.5 py-1 font-mono font-bold text-slate-900">
              {issuedTempCredential.temporaryPassword}
            </span>
            <button
              type="button"
              onClick={() => void copyStaffId(issuedTempCredential.temporaryPassword)}
              className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-950 hover:bg-amber-100 whitespace-nowrap"
            >
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </button>
            <button
              type="button"
              onClick={() => setIssuedTempCredential(null)}
              className="p-1 text-amber-800 hover:text-amber-950"
              aria-label="Dismiss temporary password notice"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
                <th className="py-2.5 px-3">Staff ID</th>
                <th className="py-2.5 px-3">Staff Name</th>
                <th className="py-2.5 px-3">Username / Email</th>
                <th className="py-2.5 px-3">Role</th>
                <th className="py-2.5 px-3">Last Login</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {u.staffId ? (
                      <button
                        type="button"
                        onClick={() => void copyStaffId(u.staffId!)}
                        title="Click to copy Staff ID"
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                      >
                        <span>{u.staffId}</span>
                        <Copy className="h-2.5 w-2.5 text-slate-400" />
                      </button>
                    ) : (
                      <span className="font-mono text-[11px] text-slate-400">Pending</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-slate-900">
                    {u.name}
                    {u.id === currentUserId && (
                      <span className="ml-1.5 text-[10px] font-medium text-blue-800">(You)</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="font-mono text-slate-800">{u.username}</div>
                    <div className="text-[11px] text-slate-500">{u.email}</div>
                    {u.phone && (
                      <div className="font-mono text-[10px] text-slate-400">{u.phone}</div>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="inline-flex items-center gap-1 font-medium text-slate-800">
                      <Shield className="h-3.5 w-3.5 text-blue-800" />
                      {ROLE_DISPLAY_NAMES[u.role]}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">
                    {u.lastLogin ? new Date(u.lastLogin).toLocaleString() : 'Never'}
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                        u.active ? 'text-emerald-800' : 'text-slate-500'
                      }`}
                    >
                      {u.active ? <UserCheck className="h-3 w-3" /> : <UserX className="h-3 w-3" />}
                      {u.active ? 'Active' : 'Deactivated'}
                    </span>
                    {u.mustChangePassword && (
                      <div className="text-[10px] font-medium text-amber-700 mt-0.5">
                        Password change required
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEdit(u)}
                        className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setResetTarget(u)}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        <KeyRound className="h-3 w-3" />
                        <span>Reset Password</span>
                      </button>
                      {u.id !== currentUserId && (
                        <button
                          type="button"
                          onClick={() => onUpdateUser({ ...u, active: !u.active })}
                          className={`rounded border px-2.5 py-1 text-[11px] font-medium ${
                            u.active
                              ? 'border-red-200 text-red-700 hover:bg-red-50'
                              : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                          }`}
                        >
                          {u.active ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Login Activity Log */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
        <h3 className="font-display text-sm font-bold text-slate-900">Recent Login Activity Log</h3>
        <div className="divide-y divide-slate-100 text-xs max-h-60 overflow-y-auto">
          {[...loginActivity].reverse().map((rec) => (
            <div key={rec.id} className="py-2 flex items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-slate-900">{rec.userName}</span>{' '}
                <span className="text-slate-500">({ROLE_DISPLAY_NAMES[rec.role]})</span> ·{' '}
                <span className="capitalize text-blue-800 font-medium">
                  {rec.action.replace('_', ' ')}
                </span>
              </div>
              <span className="font-mono text-[11px] text-slate-400">
                {new Date(rec.timestamp).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Add/Edit User Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h3 className="font-display text-base font-bold text-slate-900">
                {editingUser ? 'Edit Staff Account' : 'Create Staff Account'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-4 text-xs">
              {formError && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                  {formError}
                </div>
              )}
              <div className="rounded-md border border-blue-200 bg-blue-50/70 px-3 py-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-blue-900">
                  {editingUser ? 'Assigned Staff Login ID' : 'Auto-Generated Staff ID'}
                </span>
                <span className="font-mono text-xs font-bold text-blue-950">
                  {editingUser ? editingUser.staffId || 'Assigned on save' : nextStaffIdPreview}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Role *</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    <option value="class_teacher">Class Teacher (Homeroom &amp; CA)</option>
                    <option value="teacher">Subject Teacher</option>
                    <option value="bursar">School Bursar (Accounts &amp; Finance)</option>
                    <option value="dos">Director of Studies (DOS)</option>
                    <option value="headteacher">Headteacher</option>
                    <option value="school_admin">School Administrator</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Username *</label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Email *</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {editingUser ? 'New Password (optional)' : 'Initial Password *'}
                  </label>
                  <input
                    type="password"
                    required={!editingUser}
                    minLength={editingUser ? undefined : 8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={editingUser ? 'Leave blank to keep existing' : 'Min 8 chars (letter & number)'}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Ugandan Mobile Phone (SMS / WhatsApp)
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => {
                      setFormError(null);
                      setPhone(e.target.value);
                    }}
                    placeholder="+2567XXXXXXXX or 07XXXXXXXX"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                  />
                </div>
              </div>

              {isTeachingRole(role) && (
                <div className="space-y-3 pt-2 border-t border-slate-200">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1.5">
                      Assigned Classes
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {classes.map((c) => (
                        <label
                          key={c.id}
                          className="inline-flex items-center gap-1.5 rounded border border-slate-200 px-2 py-1"
                        >
                          <input
                            type="checkbox"
                            checked={assignedClassIds.includes(c.id)}
                            onChange={(e) =>
                              setAssignedClassIds((prev) =>
                                e.target.checked
                                  ? [...prev, c.id]
                                  : prev.filter((x) => x !== c.id)
                              )
                            }
                          />
                          <span>{c.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1.5">
                      Assigned Subjects
                    </label>
                    <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                      {subjects.map((s) => (
                        <label
                          key={s.id}
                          className="inline-flex items-center gap-1.5 rounded border border-slate-200 px-2 py-1"
                        >
                          <input
                            type="checkbox"
                            checked={assignedSubjectIds.includes(s.id)}
                            onChange={(e) =>
                              setAssignedSubjectIds((prev) =>
                                e.target.checked
                                  ? [...prev, s.id]
                                  : prev.filter((x) => x !== s.id)
                              )
                            }
                          />
                          <span>
                            {s.name} ({s.level === 'olevel' ? "O'L" : "A'L"})
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded border border-slate-300 px-3.5 py-1.5 font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-blue-900 px-4 py-1.5 font-medium text-white"
                >
                  {editingUser ? 'Save Account' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Staff / Teachers Excel & CSV Import Preview Modal */}
      {importRows && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Preview Bulk Teachers &amp; Staff Import
                </h3>
                <p className="text-xs text-slate-500">
                  {importRows.filter((r) => !r.isDuplicate && !r.phoneInvalid && r.name && r.email).length} ready ·{' '}
                  {importRows.filter((r) => r.isDuplicate).length} duplicate email ·{' '}
                  {importRows.filter((r) => r.phoneInvalid).length} invalid Ugandan phone
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

            <div className="p-5 overflow-y-auto text-xs">
              <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-700">
                      <th className="py-2 px-3">Assigned Staff ID</th>
                      <th className="py-2 px-3">Name</th>
                      <th className="py-2 px-3">Email</th>
                      <th className="py-2 px-3">Role</th>
                      <th className="py-2 px-3">Phone (+256)</th>
                      <th className="py-2 px-3">Classes</th>
                      <th className="py-2 px-3">Validation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(() => {
                      let seqOffset = 0;
                      return importRows.map((row) => {
                        const isReady = !row.isDuplicate && !row.phoneInvalid && Boolean(row.name && row.email);
                        const projectedId = isReady
                          ? formatStaffId(schoolInitials, nextStaffSeqStart + seqOffset++)
                          : '—';
                        return (
                          <tr key={row.rowNumber}>
                            <td className="py-2 px-3 font-mono font-semibold text-blue-900">
                              {projectedId}
                            </td>
                            <td className="py-2 px-3 font-medium text-slate-900">{row.name || 'Missing'}</td>
                            <td className="py-2 px-3 font-mono text-slate-700">{row.email || 'Missing'}</td>
                            <td className="py-2 px-3">{ROLE_DISPLAY_NAMES[row.role]}</td>
                            <td className="py-2 px-3 font-mono">
                              {row.phoneInvalid ? (
                                <span className="text-red-700">{row.phone || 'Invalid'}</span>
                              ) : (
                                row.phone || '—'
                              )}
                            </td>
                            <td className="py-2 px-3 text-slate-600">
                              {row.assignedClassNames.join(', ') || '—'}
                            </td>
                            <td className="py-2 px-3">
                              {row.isDuplicate ? (
                                <span className="text-amber-700 font-medium">Duplicate / Skipped</span>
                              ) : row.phoneInvalid ? (
                                <span className="text-red-700 font-medium">Invalid Ugandan Phone</span>
                              ) : !row.name || !row.email ? (
                                <span className="text-red-700 font-medium">Missing Required Fields</span>
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
                disabled={
                  importRows.filter(
                    (r) => !r.isDuplicate && !r.phoneInvalid && r.name && r.email
                  ).length === 0
                }
                onClick={confirmBulkStaffImport}
                className="rounded-md bg-blue-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-950 disabled:opacity-40"
              >
                Import{' '}
                {
                  importRows.filter(
                    (r) => !r.isDuplicate && !r.phoneInvalid && r.name && r.email
                  ).length
                }{' '}
                Staff Members
              </button>
            </div>
          </div>
        </div>
      )}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <h3 className="font-display text-sm font-bold text-slate-900">
                Issue Temporary Password
              </h3>
              <button
                type="button"
                onClick={() => !resetting && setResetTarget(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs text-slate-700">
              <p>
                Reset credentials for <strong className="text-slate-900">{resetTarget.name}</strong>
                {resetTarget.staffId ? ` (${resetTarget.staffId})` : ''}?
              </p>
              <p className="text-slate-600">
                A random one-time temporary password will be generated on the server and the account
                will be flagged to require a personal password change immediately after next login.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
              <button
                type="button"
                disabled={resetting}
                onClick={() => setResetTarget(null)}
                className="rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={resetting}
                onClick={async () => {
                  setResetting(true);
                  try {
                    const result = await onResetPassword(resetTarget.id);
                    if (result && result.temporaryPassword) {
                      setIssuedTempCredential({
                        name: result.name || resetTarget.name,
                        staffId: result.staffId ?? resetTarget.staffId,
                        temporaryPassword: result.temporaryPassword,
                      });
                    }
                    setNotice(`Temporary password generated for ${resetTarget.name}.`);
                    setResetTarget(null);
                  } catch (err: unknown) {
                    setNotice(
                      err instanceof Error ? err.message : 'Failed to issue temporary password.'
                    );
                  } finally {
                    setResetting(false);
                  }
                }}
                className="rounded-md bg-blue-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-950 disabled:opacity-50"
              >
                {resetting ? 'Generating...' : 'Generate Temporary Password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
