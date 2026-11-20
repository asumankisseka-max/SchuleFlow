import { useEffect, useState } from 'react';
import {
  Award,
  BarChart3,
  BookOpen,
  BookOpenCheck,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  History,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Shield,
  Users,
  X,
} from 'lucide-react';
import type {
  GlobalRole,
  SchoolSettings,
  UserAccount,
  WorkspaceTab,
} from '../types';
import { canAccessTab, normalizeUserRole, ROLE_DISPLAY_NAMES } from '../utils/rbac';

interface SidebarProps {
  currentUser: UserAccount;
  globalRole: GlobalRole;
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  settings: SchoolSettings;
  schoolCode?: string;
  pendingApprovalCount: number;
  returnedCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onLogout: () => void;
}

interface NavGroup {
  id: string;
  title: string;
  collapsible: boolean;
  defaultOpen: boolean;
  items: Array<{ id: WorkspaceTab; label: string; icon: typeof LayoutDashboard }>;
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'home',
    title: 'Home',
    collapsible: false,
    defaultOpen: true,
    items: [{ id: 'dashboard', label: 'Overview', icon: LayoutDashboard }],
  },
  {
    id: 'academics',
    title: 'Exams & Reports',
    collapsible: true,
    defaultOpen: true,
    items: [
      { id: 'marks-entry', label: 'Enter Marks', icon: FileSpreadsheet },
      { id: 'marksheets', label: 'Review Marks', icon: ClipboardCheck },
      { id: 'results-analysis', label: 'Results', icon: BarChart3 },
      { id: 'reports', label: 'Report Cards', icon: FileText },
      { id: 'examinations', label: 'Exams', icon: CalendarClock },
      { id: 'academic-history', label: 'Student History', icon: History },
    ],
  },
  {
    id: 'directory',
    title: 'School & People',
    collapsible: true,
    defaultOpen: false,
    items: [
      { id: 'students', label: 'Students', icon: Users },
      { id: 'classes', label: 'Classes', icon: GraduationCap },
      { id: 'subjects', label: 'Subjects', icon: BookOpen },
      { id: 'teachers', label: 'Teachers', icon: Award },
    ],
  },
  {
    id: 'admin',
    title: 'Finance & Settings',
    collapsible: true,
    defaultOpen: false,
    items: [
      { id: 'billing', label: 'School Billing', icon: CreditCard },
      { id: 'users', label: 'Staff Accounts', icon: Shield },
      { id: 'settings', label: 'School Settings', icon: Settings },
    ],
  },
];

export function Sidebar({
  currentUser,
  globalRole,
  activeTab,
  onSelectTab,
  settings,
  schoolCode,
  pendingApprovalCount,
  returnedCount,
  mobileOpen,
  onCloseMobile,
  onLogout,
}: SidebarProps) {
  const normalizedRole = normalizeUserRole(currentUser.role);
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const g of NAV_GROUPS) {
      initial[g.id] = g.defaultOpen || g.items.some((item) => item.id === activeTab);
    }
    return initial;
  });

  // Automatically expand whichever menu section contains the current page
  useEffect(() => {
    const owningGroup = NAV_GROUPS.find((g) => g.items.some((item) => item.id === activeTab));
    if (owningGroup) {
      setOpenGroups((prev) => (prev[owningGroup.id] ? prev : { ...prev, [owningGroup.id]: true }));
    }
  }, [activeTab]);

  const toggleGroup = (groupId: string) => {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const schoolBadgeUrl = settings.badgeDataUrl || settings.reportLayout.customLogoDataUrl;

  const renderContent = (isMobileDrawer: boolean) => {
    const isCompact = collapsed && !isMobileDrawer;

    return (
      <div
        className={`flex h-full flex-col bg-white border-r border-slate-200 select-none transition-[width] duration-150 ${
          isCompact ? 'w-[72px]' : isMobileDrawer ? 'w-72' : 'w-60'
        }`}
      >
        {/* Clean Brand Header */}
        <div
          className={`flex items-center h-16 border-b-2 border-slate-200 shrink-0 ${
            isCompact ? 'justify-center px-2' : 'justify-between px-4'
          }`}
          style={{ borderBottomColor: 'var(--school-secondary, #e2e8f0)' }}
        >
          {!isCompact && (
            <div className="flex items-center gap-2.5 min-w-0">
              {schoolBadgeUrl ? (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white p-0.5 overflow-hidden">
                  <img
                    src={schoolBadgeUrl}
                    alt={`${settings.schoolName} badge`}
                    className="h-full w-full object-contain"
                  />
                </div>
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-900 text-white">
                  <BookOpenCheck className="h-4 w-4" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0">
                <span className="font-display text-base font-bold tracking-tight text-slate-900 block leading-tight whitespace-nowrap">
                  SchuleFlow
                </span>
                <span className="text-[11px] text-slate-500 truncate block">
                  {schoolCode ? `${schoolCode} · ${settings.schoolName}` : settings.schoolName}
                </span>
              </div>
            </div>
          )}

          {isMobileDrawer ? (
            <button
              type="button"
              onClick={onCloseMobile}
              className="p-2 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setCollapsed((prev) => !prev)}
              className="hidden lg:inline-flex p-2 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              aria-label={isCompact ? 'Expand menu' : 'Collapse menu'}
              title={isCompact ? 'Expand menu' : 'Collapse menu'}
            >
              {isCompact ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          )}
        </div>

        {/* Clean, Role-Filtered Collapsible Menu */}
        <nav
          className={`flex-1 py-4 overflow-y-auto ${isCompact ? 'px-2 space-y-2' : 'px-3 space-y-4'}`}
          aria-label="Workspace Menu"
        >
          {NAV_GROUPS.map((group) => {
            const visibleItems = group.items.filter((item) =>
              canAccessTab(normalizedRole, item.id, globalRole)
            );
            if (visibleItems.length === 0) return null;

            const isGroupOpen = isCompact || !group.collapsible || Boolean(openGroups[group.id]);
            const groupBadgeCount = visibleItems.reduce((sum, item) => {
              if (item.id === 'marksheets') return sum + pendingApprovalCount;
              if (item.id === 'marks-entry') return sum + returnedCount;
              return sum;
            }, 0);

            return (
              <div key={group.id} className="space-y-1">
                {!isCompact && group.collapsible && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={isGroupOpen}
                    className="flex w-full items-center justify-between px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 rounded-md transition-colors"
                  >
                    <span className="truncate">{group.title}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {!isGroupOpen && groupBadgeCount > 0 && (
                        <span className="font-mono text-[11px] font-semibold tabular-nums text-blue-800">
                          {groupBadgeCount}
                        </span>
                      )}
                      {isGroupOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                      )}
                    </span>
                  </button>
                )}

                {isGroupOpen && (
                  <div className="space-y-0.5">
                    {visibleItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.id;
                      const badge =
                        item.id === 'marksheets' && pendingApprovalCount > 0
                          ? pendingApprovalCount
                          : item.id === 'marks-entry' && returnedCount > 0
                            ? returnedCount
                            : null;

                      return (
                        <button
                          key={item.id}
                          type="button"
                          title={isCompact ? item.label : undefined}
                          onClick={() => {
                            onSelectTab(item.id);
                            if (isMobileDrawer) onCloseMobile();
                          }}
                          className={`flex w-full items-center rounded-md text-[13px] font-medium transition-colors whitespace-nowrap min-h-[40px] ${
                            isCompact ? 'justify-center px-2 py-2 relative' : 'justify-between px-3 py-2'
                          } ${
                            isActive
                              ? 'bg-blue-900 text-white font-semibold'
                              : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                          }`}
                        >
                          <span className={`flex items-center min-w-0 ${isCompact ? '' : 'gap-2.5'}`}>
                            <Icon
                              className={`h-4 w-4 shrink-0 ${
                                isActive ? '' : 'text-slate-400'
                              }`}
                              aria-hidden="true"
                            />
                            {!isCompact && <span className="truncate">{item.label}</span>}
                          </span>

                          {!isCompact && badge !== null && (
                            <span
                              className={`font-mono text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded ${
                                isActive
                                  ? 'bg-white/20 text-white'
                                  : item.id === 'marks-entry'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-blue-50 text-blue-800'
                              }`}
                            >
                              {badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Quiet User Profile & Sign Out */}
        <div
          className={`border-t border-slate-200 bg-slate-50/60 shrink-0 ${
            isCompact ? 'p-2 flex flex-col items-center gap-2' : 'px-3.5 py-3 space-y-2.5'
          }`}
        >
          {!isCompact && (
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900 truncate">{currentUser.name}</p>
              <p className="text-[11px] text-slate-500 truncate">
                {ROLE_DISPLAY_NAMES[normalizedRole]}
                {currentUser.staffId ? ` · ${currentUser.staffId}` : ''}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={onLogout}
            title={isCompact ? 'Sign Out' : undefined}
            aria-label="Sign Out"
            className={`flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors whitespace-nowrap min-h-[38px] ${
              isCompact ? 'w-10 h-10 p-0' : 'w-full px-3 py-2'
            }`}
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {!isCompact && <span>Sign Out</span>}
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      <aside className="hidden lg:block shrink-0 no-print">{renderContent(false)}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 flex h-full">{renderContent(true)}</div>
        </div>
      )}
    </>
  );
}
