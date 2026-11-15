import React, { useEffect, useState } from 'react';
import { 
  Flame, 
  Search, 
  RotateCcw, 
  CheckCircle2, 
  XCircle, 
  Bookmark, 
  X,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Settings,
  Filter,
  Layers
} from 'lucide-react';
import { StudyMode, FilterState, UserStatistics, QuestionDatabase, UserAccount } from '../types/question';
import { MemorizLogo } from './MemorizLogo';

interface SidebarProps {
  isOpen: boolean;
  onToggle?: () => void;
  onClose?: () => void;
  currentMode: StudyMode;
  onSelectMode: (mode: StudyMode) => void;
  databases: QuestionDatabase[];
  activeDatabaseId: string | 'all';
  onChangeDatabase: (dbId: string | 'all') => void;
  filters: FilterState;
  onChangeFilters: (newFilters: FilterState) => void;
  subjects: string[];
  examBoards: string[];
  years: number[];
  topics: string[];
  subjectCounts: Record<string, number>;
  statusCounts: {
    all: number;
    unanswered: number;
    correct: number;
    wrong: number;
    bookmarked: number;
    srs_due: number;
  };
  totalFiltered: number;
  totalAll: number;
  stats: UserStatistics;
  errorCount: number;
  srsDueCount: number;
  onOpenDatabaseManager: () => void;
  onOpenShortcuts: () => void;
  onOpenAppInfo?: () => void;
  onOpenXPPerformance?: () => void;
  userAccount?: UserAccount;
  onOpenAccountModal?: () => void;
  isDevUser?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onToggle,
  onClose,
  filters,
  onChangeFilters,
  subjects,
  examBoards,
  years,
  topics,
  subjectCounts,
  statusCounts,
  totalAll,
  stats,
  onOpenAppInfo,
  onOpenXPPerformance,
  userAccount,
  onOpenAccountModal,
}) => {
  const [isStatusTreeOpen, setIsStatusTreeOpen] = useState(false);
  const [isSubjectsTreeOpen, setIsSubjectsTreeOpen] = useState(false);

  // Prevent background scrolling when sidebar is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else if (onToggle) {
      onToggle();
    }
  };

  const handleResetFilters = () => {
    onChangeFilters({
      database_id: 'all',
      subject: 'all',
      exam_board: 'all',
      year: 'all',
      topic: 'all',
      status: 'all',
      searchQuery: '',
      isRegexSearch: false,
    });
  };

  const hasActiveFilters = 
    filters.subject !== 'all' || 
    filters.exam_board !== 'all' || 
    filters.year !== 'all' || 
    filters.topic !== 'all' || 
    filters.status !== 'all' || 
    filters.searchQuery.trim().length > 0 ||
    !!filters.isRegexSearch;

  const getActiveStatusLabel = () => {
    switch (filters.status) {
      case 'unanswered':
        return { label: 'Novas', count: statusCounts.unanswered };
      case 'correct':
        return { label: 'Acertos', count: statusCounts.correct };
      case 'wrong':
        return { label: 'Erros', count: statusCounts.wrong };
      case 'bookmarked':
        return { label: 'Salvas', count: statusCounts.bookmarked };
      default:
        return { label: 'Todas', count: statusCounts.all };
    }
  };

  const activeStatusInfo = getActiveStatusLabel();
  const activeSubjectLabel = filters.subject === 'all' ? 'Todas' : filters.subject;
  const activeSubjectCount =
    filters.subject === 'all' ? totalAll : subjectCounts[filters.subject] || 0;

  const effectiveGoal = stats.daily_goal_xp > 0 ? stats.daily_goal_xp : 50;
  const currentTodayXP = typeof stats.today_xp === 'number' && stats.today_xp > 0 
    ? stats.today_xp 
    : (stats.xp_points > 0 ? stats.xp_points : 0);
  const xpProgress = Math.min(100, Math.max(0, Math.round((currentTodayXP / effectiveGoal) * 100)));

  return (
    <>
      {/* Mobile & Desktop Backdrop */}
      {isOpen && (
        <div 
          onClick={handleClose}
          className="fixed inset-0 z-40 bg-canvas/80 backdrop-blur-xs transition-opacity"
        />
      )}

      {/* Sidebar Drawer */}
      <aside
        className={`fixed top-0 left-0 bottom-0 z-50 w-80 sm:w-88 bg-surface border-border rounded-none border-r flex flex-col transition-transform duration-300 ease-in-out shadow-2xl ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Top Header inside Sidebar: User Profile & Close button - aligned to h-14 to match main header border-b */}
        <div className="h-14 px-3.5 flex items-center justify-between border-b border-border shrink-0 gap-2">
          {userAccount ? (
            <button
              id="sidebar-user-account-header-btn"
              type="button"
              onClick={() => {
                if (onOpenAccountModal) onOpenAccountModal();
                if (window.innerWidth < 1024) handleClose();
              }}
              className="flex-1 min-w-0 flex items-center gap-2.5 p-1 rounded-xl hover:bg-surface-subtle transition-all text-left cursor-pointer group"
              title="Gerenciar perfil e metas de estudo"
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg bg-surface border border-border shrink-0 shadow-2xs group-hover:scale-105 transition-transform overflow-hidden">
                {userAccount.avatar?.startsWith('http') ? (
                  <img 
                    src={userAccount.avatar} 
                    alt={userAccount.name} 
                    className="w-full h-full object-cover rounded-xl avatar-icon" 
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="avatar-icon emoji-filter" data-emoji="true">{userAccount.avatar}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold truncate text-primary group-hover:text-accent transition-colors">
                    {userAccount.name}
                  </span>
                  {userAccount.provider === 'google' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" title="Conta Google conectada" />
                  )}
                </div>
                <div className="text-[10px] text-muted truncate">
                  {userAccount.targetExam || 'Objetivo de Estudo'}
                </div>
              </div>
            </button>
          ) : (
            <div className="flex items-center gap-2.5">
              <MemorizLogo size={28} />
              <span className="font-bold text-base text-primary">Silenon</span>
            </div>
          )}

          <button
            id="collapse-sidebar-btn"
            onClick={handleClose}
            className="p-1.5 text-muted hover:text-primary hover:bg-surface-subtle rounded-lg transition-colors cursor-pointer shrink-0"
            title="Recolher menu lateral"
            aria-label="Recolher menu lateral"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div
          className="flex-1 overflow-y-auto p-4 space-y-5 text-xs"
          style={{ scrollbarGutter: 'stable' }}
        >

          {/* SECTION 1: BUSCA & FILTROS DE QUESTÕES */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-2">
              <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">
                Busca e Filtros
              </span>
              {hasActiveFilters && (
                <button
                  onClick={handleResetFilters}
                  className="text-[11px] text-accent hover:underline flex items-center gap-1 font-medium cursor-pointer"
                  title="Restaurar todos os filtros"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Limpar</span>
                </button>
              )}
            </div>

            {/* Fast Search Input with Regex Support */}
            <div className="space-y-1">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                <input
                  type="text"
                  value={filters.searchQuery}
                  onChange={(e) => onChangeFilters({ ...filters, searchQuery: e.target.value })}
                  placeholder={filters.isRegexSearch ? "Regex ex: (furto|roubo), art\\.\\s*\\d+" : "Buscar termo ou código..."}
                  className={`w-full pl-9 pr-16 py-2 theme-input rounded-lg text-xs ${
                    filters.isRegexSearch
                      ? 'border-accent font-mono text-[11px]'
                      : ''
                  }`}
                />
                
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {/* Regex Mode Toggle Button */}
                  <button
                    type="button"
                    onClick={() => onChangeFilters({ ...filters, isRegexSearch: !filters.isRegexSearch })}
                    className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-bold tracking-tighter transition-colors cursor-pointer ${
                      filters.isRegexSearch
                        ? 'bg-accent text-accent-contrast shadow-xs'
                        : 'text-muted hover:text-primary hover:bg-surface-subtle'
                    }`}
                    title={filters.isRegexSearch ? "Busca por Expressão Regular (Regex) ATIVA (clique para desativar)" : "Ativar busca por Expressão Regular (Regex)"}
                  >
                    .*
                  </button>

                  {/* Clear Button */}
                  {filters.searchQuery && (
                    <button
                      type="button"
                      onClick={() => onChangeFilters({ ...filters, searchQuery: '' })}
                      className="p-1 text-muted hover:text-primary rounded cursor-pointer"
                      title="Limpar busca"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {filters.isRegexSearch && (
                <div className="flex items-center justify-between px-1 text-[10px] text-accent font-mono">
                  <span>Modo Regex ativo</span>
                  <span className="opacity-75">Ex: \bcrime\b | art\.\s*\d+</span>
                </div>
              )}
            </div>

            {/* ÁRVORE EXPANSÍVEL 1: FILTRAR POR STATUS */}
            <div>
              <button
                type="button"
                onClick={() => setIsStatusTreeOpen((prev) => !prev)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-colors cursor-pointer ${
                  isStatusTreeOpen || filters.status !== 'all'
                    ? 'bg-surface-subtle border-accent/40 text-primary'
                    : 'bg-surface-subtle border-border text-secondary hover:text-primary hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isStatusTreeOpen ? (
                    <ChevronDown className="w-4 h-4 text-accent shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted shrink-0" />
                  )}
                  <Filter className="w-3.5 h-3.5 text-muted shrink-0" />
                  <span className="font-semibold text-xs truncate">Filtrar por Status</span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 pl-2">
                  <span
                    className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${
                      filters.status !== 'all'
                        ? 'bg-accent text-accent-contrast font-semibold'
                        : 'bg-surface text-secondary border border-border'
                    }`}
                  >
                    {activeStatusInfo.label}
                  </span>
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-surface border border-border text-primary">
                    {activeStatusInfo.count}
                  </span>
                </div>
              </button>

              <div
                className={`grid transition-[grid-template-rows,opacity] duration-250 ease-out ${
                  isStatusTreeOpen
                    ? 'grid-rows-[1fr] opacity-100'
                    : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                }`}
              >
                <div className="overflow-hidden min-h-0">
                  <div className="pl-3 ml-2 border-l-2 border-border space-y-1.5 pt-2.5">
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={() => onChangeFilters({ ...filters, status: 'all' })}
                        className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                          filters.status === 'all'
                            ? 'theme-chip-active font-semibold'
                            : 'theme-chip-inactive'
                        }`}
                      >
                        <span>Todas</span>
                        <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          filters.status === 'all' ? 'bg-accent-contrast/20 text-accent-contrast' : 'text-primary bg-surface border border-border'
                        }`}>{statusCounts.all}</span>
                      </button>

                      <button
                        onClick={() => onChangeFilters({ ...filters, status: 'unanswered' })}
                        className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                          filters.status === 'unanswered'
                            ? 'theme-chip-active font-semibold'
                            : 'theme-chip-inactive'
                        }`}
                      >
                        <span>Novas</span>
                        <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          filters.status === 'unanswered' ? 'bg-accent-contrast/20 text-accent-contrast' : 'text-primary bg-surface border border-border'
                        }`}>{statusCounts.unanswered}</span>
                      </button>

                      <button
                        onClick={() => onChangeFilters({ ...filters, status: 'correct' })}
                        className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                          filters.status === 'correct'
                            ? 'bg-success-bg text-success border border-success-border font-semibold'
                            : 'theme-chip-inactive'
                        }`}
                      >
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-success" />
                          <span>Acertos</span>
                        </span>
                        <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          filters.status === 'correct' ? 'bg-success/20 text-success' : 'text-primary bg-surface border border-border'
                        }`}>{statusCounts.correct}</span>
                      </button>

                      <button
                        onClick={() => onChangeFilters({ ...filters, status: 'wrong' })}
                        className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                          filters.status === 'wrong'
                            ? 'bg-danger-bg text-danger border border-danger-border font-semibold'
                            : 'theme-chip-inactive'
                        }`}
                      >
                        <span className="flex items-center gap-1">
                          <XCircle className="w-3 h-3 text-danger" />
                          <span>Erros</span>
                        </span>
                        <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          filters.status === 'wrong' ? 'bg-danger/20 text-danger' : 'text-primary bg-surface border border-border'
                        }`}>{statusCounts.wrong}</span>
                      </button>

                      <button
                        onClick={() => onChangeFilters({ ...filters, status: 'bookmarked' })}
                        className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-between transition-colors col-span-2 cursor-pointer ${
                          filters.status === 'bookmarked'
                            ? 'theme-badge-accent shadow-xs font-semibold'
                            : 'theme-chip-inactive'
                        }`}
                      >
                        <span className="flex items-center gap-1">
                          <Bookmark className={`w-3 h-3 ${filters.status === 'bookmarked' ? 'fill-current text-accent' : 'text-muted'}`} />
                          <span>Marcadas / Salvas</span>
                        </span>
                        <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          filters.status === 'bookmarked' ? 'theme-badge-accent font-bold' : 'text-primary bg-surface border border-border'
                        }`}>{statusCounts.bookmarked}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ÁRVORE EXPANSÍVEL 2: FILTRAR POR DISCIPLINAS */}
            <div>
              <button
                type="button"
                onClick={() => setIsSubjectsTreeOpen((prev) => !prev)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-colors cursor-pointer ${
                  isSubjectsTreeOpen || filters.subject !== 'all'
                    ? 'bg-surface-subtle border-accent/40 text-primary'
                    : 'bg-surface-subtle border-border text-secondary hover:text-primary hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isSubjectsTreeOpen ? (
                    <ChevronDown className="w-4 h-4 text-accent shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted shrink-0" />
                  )}
                  <Layers className="w-3.5 h-3.5 text-muted shrink-0" />
                  <span className="font-semibold text-xs truncate">Filtrar por Disciplinas</span>
                </div>

                <div className="flex items-center gap-1.5 min-w-0 max-w-[50%] pl-2">
                  <span
                    className={`px-2 py-0.5 rounded-md text-[11px] font-medium truncate ${
                      filters.subject !== 'all'
                        ? 'bg-accent text-accent-contrast font-semibold'
                        : 'bg-surface text-secondary border border-border'
                    }`}
                  >
                    {activeSubjectLabel}
                  </span>
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-surface border border-border text-primary shrink-0">
                    {activeSubjectCount}
                  </span>
                </div>
              </button>

              <div
                className={`grid transition-[grid-template-rows,opacity] duration-250 ease-out ${
                  isSubjectsTreeOpen
                    ? 'grid-rows-[1fr] opacity-100'
                    : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                }`}
              >
                <div className="overflow-hidden min-h-0">
                  <div className="pl-3 ml-2 border-l-2 border-border space-y-1 pt-2.5">
                    <button
                      onClick={() => onChangeFilters({ ...filters, subject: 'all' })}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
                        filters.subject === 'all'
                          ? 'bg-accent text-accent-contrast font-semibold shadow-xs'
                          : 'text-secondary hover:bg-surface-subtle'
                      }`}
                    >
                      <span>Todas as Disciplinas</span>
                      <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded min-w-[26px] text-center shrink-0 ${
                        filters.subject === 'all' ? 'bg-accent-contrast/20 text-accent-contrast border border-transparent' : 'text-primary bg-surface-subtle border border-border'
                      }`}>{totalAll}</span>
                    </button>

                    {subjects.map(s => {
                      const count = subjectCounts[s] || 0;
                      const isSelected = filters.subject === s;
                      return (
                        <button
                          key={s}
                          onClick={() => onChangeFilters({ ...filters, subject: isSelected ? 'all' : s })}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-accent text-accent-contrast font-semibold shadow-xs'
                              : 'text-secondary hover:bg-surface-subtle'
                          }`}
                        >
                          <span className="truncate pr-2">{s}</span>
                          <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded min-w-[26px] text-center shrink-0 ${
                            isSelected ? 'bg-accent-contrast/20 text-accent-contrast border border-transparent' : 'text-primary bg-surface-subtle border border-border'
                          }`}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Origens, Anos & Tópicos Dropdowns */}
            <div className="space-y-2 pt-2">
              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider block mb-1 font-medium">
                  Origem / Banca
                </label>
                <select
                  value={filters.exam_board}
                  onChange={(e) => onChangeFilters({ ...filters, exam_board: e.target.value })}
                  className="w-full px-2.5 py-1.5 theme-input rounded-lg text-xs"
                >
                  <option value="all">Todas as Origens / Bancas</option>
                  {examBoards.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider block mb-1 font-medium">
                  Ano
                </label>
                <select
                  value={filters.year.toString()}
                  onChange={(e) => onChangeFilters({ ...filters, year: e.target.value === 'all' ? 'all' : Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 theme-input rounded-lg text-xs"
                >
                  <option value="all">Todos os Anos</option>
                  {years.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>

              {topics.length > 0 && (
                <div>
                  <label className="text-[10px] text-muted uppercase tracking-wider block mb-1 font-medium">
                    Tópico / Conteúdo
                  </label>
                  <select
                    value={filters.topic}
                    onChange={(e) => onChangeFilters({ ...filters, topic: e.target.value })}
                    className="w-full px-2.5 py-1.5 theme-input rounded-lg text-xs"
                  >
                    <option value="all">Todos os Tópicos</option>
                    {topics.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* SECTION 2: CONFIGURAÇÕES CENTRALIZADAS */}
          <div className="space-y-1 pt-3 border-t border-border">
            <button
              id="sidebar-app-info-item-btn"
              type="button"
              onClick={() => {
                if (onOpenAppInfo) onOpenAppInfo();
                if (window.innerWidth < 1024) handleClose();
              }}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-surface-subtle hover:bg-surface-hover border border-border text-secondary hover:text-primary transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-2.5">
                <Settings className="w-4 h-4 text-accent group-hover:rotate-45 transition-transform" />
                <span className="font-semibold text-xs text-primary">Configurações</span>
              </div>
              <ChevronRight className="w-4 h-4 text-muted" />
            </button>
          </div>
        </div>

        {/* Footer: User Gamification Stats (Click opens Duolingo-style Performance Panel) */}
        <div className="p-3 border-t border-border theme-card-subtle shrink-0">
          <button 
            type="button"
            onClick={onOpenXPPerformance}
            className="relative w-full h-9 rounded-xl overflow-hidden border border-border/80 flex items-center px-3 justify-between text-xs select-none shadow-xs xp-track cursor-pointer hover:opacity-95 active:scale-[0.99] transition-all"
            title={`Clique para abrir seu Painel de Desempenho e Metas | Ofensiva: ${stats.streak_days} dias | Meta: ${currentTodayXP}/${effectiveGoal} XP (${xpProgress}%)`}
          >
            {/* Progress Fill Underlay - Proportional with clean edge fill */}
            {xpProgress > 0 && (
              <div 
                className="absolute left-0 top-0 bottom-0 h-full xp-fill transition-all duration-500 ease-out pointer-events-none"
                style={{ width: `${Math.max(4, Math.min(100, xpProgress))}%` }}
              />
            )}

            {/* Left Content Inside Bar: Streak Flame + Text */}
            <div className="relative z-10 flex items-center gap-1.5 font-semibold xp-streak-text min-w-0">
              <Flame className="w-4 h-4 xp-flame-icon shrink-0" />
              <span className="truncate">{stats.streak_days} {stats.streak_days === 1 ? 'dia' : 'dias'} de Ofensiva</span>
            </div>

            {/* Right Content Inside Bar: XP Badge */}
            <div className="relative z-10 flex items-center gap-1 font-mono font-bold xp-badge-text shrink-0 text-xs pl-2">
              <span>{stats.xp_points > 0 ? `${stats.xp_points} XP` : `${currentTodayXP} XP`}</span>
            </div>
          </button>
        </div>
      </aside>
    </>
  );
};
