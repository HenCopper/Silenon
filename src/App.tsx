/**
 * Memoriz - High Performance Offline Learning & Question Bank Application
 * Minimalist AI Studio Interface with Collapsible Sidebar & Fast Inverted Index
 */

import React from 'react';
import { LocalStorageManager } from './lib/storage';
import { getQuestionContentHash } from './lib/duplicateEngine';
import { applyThemeToDOM } from './hooks/useTheme';

// Custom Dedicated Hooks
import { useTheme } from './hooks/useTheme';
import { useStudyCarousel } from './hooks/useStudyCarousel';
import { useUserAccount } from './hooks/useUserAccount';
import { useStudyData } from './hooks/useStudyData';
import { useModals } from './hooks/useModals';

// UI Components
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { QuestionCard } from './components/QuestionCard';
import { AssociatedContextPanel } from './components/AssociatedContextPanel';
import { SRSModeView } from './components/SRSModeView';
import { SimuladoView } from './components/SimuladoView';
import { ErrorNotebookView } from './components/ErrorNotebookView';
import { MetricsDashboard } from './components/MetricsDashboard';
import { DatabaseManagerModal } from './components/DatabaseManagerModal';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { AppInfoModal } from './components/AppInfoModal';
import { PauseOverlay } from './components/PauseOverlay';
import { UserAccountModal } from './components/UserAccountModal';
import { ThemeKitchenSink } from './components/ThemeKitchenSink';
import { XPPerformanceModal } from './components/XPPerformanceModal';
import { CarouselDiagnosticOverlay } from './components/CarouselDiagnosticOverlay';
import { DraggableModeSwitcher } from './components/DraggableModeSwitcher';
import { BYOKModal } from './components/BYOKModal';
import { GlobalAssistantPopover } from './components/GlobalAssistantPopover';
import { hasAnyAIKey } from './lib/aiOrchestrator';
import { syncWindow } from './lib/mediaWindowCache';

export default function App() {
  // Verificação de ambiente local de desenvolvimento (sem dados pessoais ou e-mails hardcoded)
  const isDevEnvironment = Boolean(
    import.meta.env.DEV ||
    (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
  );
  const isDevUser = isDevEnvironment;

  // 1. Theme Management Hook
  const { theme, setTheme, handleToggleTheme } = useTheme();

  // 2. Study Carousel & Modes Navigation Hook
  const {
    currentMode,
    handleSelectMode,
    modeDragProgress,
    handleModeDragProgress,
    isModeTransitioning,
    isDragging,
    carouselContainerRef,
    rightVeilRef,
    slideRefs,
    containerWidth,
    isCarouselMode,
    pixelOffset,
    slideWidthStyle,
    trackWidthStyle,
  } = useStudyCarousel({
    isDevEnvironment,
  });

  // 3. Question Bank, Filters, Search & Progress State Hook
  const {
    databases,
    setDatabases,
    questions,
    answers,
    srsItems,
    bookmarks,
    strikes,
    stats,
    unansweredTimes,
    filters,
    setFilters,
    currentIndex,
    setCurrentIndex,
    searchEngine,
    twinMap,
    lastAnswerMap,
    filteredQuestions,
    currentQuestion,
    subjectCounts,
    statusCounts,
    errorCount,
    srsDueCount,
    activePoolQuestions,
    totalPoolUniqueQuestions,
    handleAnswer,
    handleRateSRS,
    handleToggleBookmark,
    handleSaveNote,
    handleToggleStrike,
    handleSetStrikes,
    handleSelectDatabase,
    handleAddDatabase,
    handleRenameDatabase,
    handleDeleteDatabase,
    handleRestoreDefaultDatabases,
    handleRecordSimuladoResult,
    handleSaveSRSFromView,
    handleRecordSRSAnswer,
    handleResetAllProgress,
    handleUpdateElapsedSeconds,
    handleUpdateDailyGoalXP,
  } = useStudyData({ currentMode });

  const scrollPracticeSlideToTop = React.useCallback(() => {
    slideRefs.current[0]?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [slideRefs]);

  const handlePrevQuestion = React.useCallback(() => {
    setCurrentIndex(i => Math.max(0, i - 1));
    scrollPracticeSlideToTop();
  }, [setCurrentIndex, scrollPracticeSlideToTop]);

  const handleNextQuestion = React.useCallback(() => {
    setCurrentIndex(i => Math.min(filteredQuestions.length - 1, i + 1));
    scrollPracticeSlideToTop();
  }, [setCurrentIndex, filteredQuestions.length, scrollPracticeSlideToTop]);

  // 4. User Account & Cloud Synchronization Hook
  const { userAccount, setUserAccount } = useUserAccount({
    stats,
    srsItems,
    answers,
    bookmarks,
  });

  // 5. Modal Windows & Keyboard Shortcuts Hook
  const {
    isSidebarOpen,
    setIsSidebarOpen,
    isShortcutsOpen,
    setIsShortcutsOpen,
    isDatabaseManagerOpen,
    setIsDatabaseManagerOpen,
    isAppInfoOpen,
    setIsAppInfoOpen,
    isXPPerformanceOpen,
    setIsXPPerformanceOpen,
    isUserAccountModalOpen,
    setIsUserAccountModalOpen,
    isBYOKModalOpen,
    setIsBYOKModalOpen,
    isGlobalAssistantOpen,
    setIsGlobalAssistantOpen,
    isPaused,
    setIsPaused,
    isPracticeTimerPaused,
    isSRSTimerPaused,
    isErrorTimerPaused,
    isSimuladoTimerPaused,
  } = useModals({
    currentMode,
    onSelectMode: handleSelectMode,
    filteredQuestionsLength: filteredQuestions.length,
    onNavigatePrevQuestion: handlePrevQuestion,
    onNavigateNextQuestion: handleNextQuestion,
    onToggleBookmark: () => handleToggleBookmark(),
  });

  // Synchronize sliding window media cache in Practice Mode
  React.useEffect(() => {
    if (currentMode === 'practice' && filteredQuestions.length > 0) {
      syncWindow(filteredQuestions, currentIndex);
    }
  }, [currentMode, filteredQuestions, currentIndex]);

  return (
    <div className="w-full h-[100vh] h-[100dvh] overflow-hidden flex flex-col">
      {/* Top Minimalist Header */}
      <Header
        currentMode={currentMode}
        onSelectMode={handleSelectMode}
        stats={stats}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
        onOpenDatabaseManager={() => setIsDatabaseManagerOpen(true)}
        onOpenAppInfo={() => setIsAppInfoOpen(true)}
        onOpenXPPerformance={() => setIsXPPerformanceOpen(true)}
        errorCount={errorCount}
        srsDueCount={srsDueCount}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(open => !open)}
        filters={filters}
        currentQuestionIndex={currentIndex}
        totalQuestions={filteredQuestions.length}
        isPaused={isPaused}
        onTogglePause={() => setIsPaused(p => !p)}
        userAccount={userAccount}
        onOpenAccountModal={() => setIsUserAccountModalOpen(true)}
        isDevUser={isDevUser}
        modeDragProgress={modeDragProgress}
        onModeDragProgress={handleModeDragProgress}
        onOpenAIAssistant={() => {
          if (!hasAnyAIKey()) {
            setIsBYOKModalOpen(true);
          } else {
            setIsGlobalAssistantOpen(prev => !prev);
          }
        }}
      />

      {/* Collapsible Sidebar Drawer with Filters & Nav */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onToggle={() => setIsSidebarOpen(prev => !prev)}
        currentMode={currentMode}
        onSelectMode={handleSelectMode}
        databases={databases}
        activeDatabaseId={filters.database_id}
        onChangeDatabase={handleSelectDatabase}
        stats={stats}
        errorCount={errorCount}
        srsDueCount={srsDueCount}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
        onOpenDatabaseManager={() => setIsDatabaseManagerOpen(true)}
        onOpenAppInfo={() => setIsAppInfoOpen(true)}
        onOpenXPPerformance={() => setIsXPPerformanceOpen(true)}
        userAccount={userAccount}
        onOpenAccountModal={() => setIsUserAccountModalOpen(true)}
        isDevUser={isDevUser}
        filters={filters}
        onChangeFilters={setFilters}
        subjects={searchEngine.subjects}
        examBoards={searchEngine.examBoards}
        years={searchEngine.years}
        topics={searchEngine.topics}
        subjectCounts={subjectCounts}
        statusCounts={statusCounts}
        totalFiltered={filteredQuestions.length}
        totalAll={totalPoolUniqueQuestions}
      />

      {/* Main Content Area with Independent Scrollable Mode Slides */}
      <main className="flex-1 min-h-0 w-full flex flex-col overflow-hidden">
        {(() => {
          if (isCarouselMode) {
            return (
              <div
                ref={carouselContainerRef}
                onScroll={(e) => {
                  e.currentTarget.scrollLeft = 0;
                }}
                className="relative flex-1 min-h-0 w-full h-full overflow-hidden bg-canvas theme-bg-canvas"
              >
                <div
                  className="flex items-stretch flex-nowrap h-full"
                  style={{
                    width: trackWidthStyle,
                    transform: `translate3d(${pixelOffset}px, 0, 0)`,
                    willChange: isDragging || isModeTransitioning ? 'transform' : 'auto',
                    transition: isDragging
                      ? 'none'
                      : 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
                  }}
                >
                  {/* SLIDE 0: PRÁTICA DE QUESTÕES COM SPLIT-SCREEN INTELIGENTE */}
                  <div
                    ref={(el) => {
                      slideRefs.current[0] = el;
                    }}
                    className="shrink-0 h-full overflow-y-auto overflow-x-hidden overscroll-y-contain pb-24 lg:pb-8 bg-canvas theme-bg-canvas px-4 sm:px-6 lg:px-8 pt-3 sm:pt-4"
                    style={{
                      width: slideWidthStyle,
                      minWidth: slideWidthStyle,
                      maxWidth: slideWidthStyle,
                      flexShrink: 0,
                      boxSizing: 'border-box',
                    }}
                  >
                    <div
                      className={
                        currentQuestion?.associated_context?.has_associated_context
                          ? 'max-w-7xl mx-auto w-full space-y-4'
                          : 'max-w-4xl mx-auto w-full space-y-4'
                      }
                    >
                      {/* Questions View */}
                      {filteredQuestions.length === 0 ? (
                        <div className="theme-card border border-border rounded-xl p-10 text-center space-y-3 shadow-xs">
                          <div className="w-12 h-12 bg-surface-subtle text-muted border border-border rounded-lg flex items-center justify-center mx-auto text-xl font-bold">
                            ∅
                          </div>
                          <h3 className="font-semibold text-base text-primary theme-text-primary">
                            Nenhuma questão encontrada
                          </h3>
                          <p className="text-xs text-muted theme-text-muted max-w-sm mx-auto">
                            Nenhum registro corresponde aos filtros selecionados.
                          </p>
                          <button
                            onClick={() =>
                              setFilters({
                                database_id: 'all',
                                subject: 'all',
                                exam_board: 'all',
                                year: 'all',
                                topic: 'all',
                                status: 'all',
                                searchQuery: '',
                              })
                            }
                            className="px-4 py-2 theme-btn-accent font-medium rounded-lg text-xs transition-colors cursor-pointer"
                          >
                            Restaurar Todos os Filtros
                          </button>
                        </div>
                      ) : currentQuestion ? (
                        <div
                          className={
                            currentQuestion.associated_context?.has_associated_context
                              ? 'grid grid-cols-1 lg:grid-cols-12 gap-5 w-full items-start'
                              : 'w-full'
                          }
                        >
                          {/* Left Split: Texto de Apoio com altura livre e rolagem natural junto com o slide */}
                          {currentQuestion.associated_context?.has_associated_context && (
                            <div className="lg:col-span-5 w-full">
                              <AssociatedContextPanel
                                context={currentQuestion.associated_context}
                              />
                            </div>
                          )}

                          {/* Right Split: Question Card & Resolutions */}
                          <div
                            className={
                              currentQuestion.associated_context?.has_associated_context
                                ? 'lg:col-span-7 w-full'
                                : 'w-full'
                            }
                          >
                            <QuestionCard
                              question={currentQuestion}
                              currentIndex={currentIndex}
                              totalFiltered={filteredQuestions.length}
                              onPrev={handlePrevQuestion}
                              onNext={handleNextQuestion}
                              onAnswer={handleAnswer}
                              lastAnswer={lastAnswerMap[currentQuestion.sequence_id]}
                              srsItem={srsItems[currentQuestion.sequence_id]}
                              onRateSRS={handleRateSRS}
                              isBookmarked={!!bookmarks[currentQuestion.sequence_id]}
                              bookmarkData={bookmarks[currentQuestion.sequence_id]}
                              onToggleBookmark={handleToggleBookmark}
                              onSaveNote={handleSaveNote}
                              strikes={strikes[currentQuestion.sequence_id] || []}
                              onToggleStrike={handleToggleStrike}
                              onSetStrikes={handleSetStrikes}
                              isPaused={isPracticeTimerPaused}
                              initialElapsedSeconds={
                                unansweredTimes[currentQuestion.sequence_id] || 0
                              }
                              onUpdateElapsedSeconds={(secs) => {
                                handleUpdateElapsedSeconds(currentQuestion.sequence_id, secs);
                              }}
                              onOpenAIAssistant={() => setIsBYOKModalOpen(true)}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* SLIDE 1: MODO SRS REPETIÇÃO ESPAÇADA */}
                  <div
                    ref={(el) => {
                      slideRefs.current[1] = el;
                    }}
                    className="shrink-0 h-full overflow-y-auto overflow-x-hidden overscroll-y-contain pb-24 lg:pb-8 bg-canvas theme-bg-canvas px-4 sm:px-6 lg:px-8 pt-3 sm:pt-4"
                    style={{
                      width: slideWidthStyle,
                      minWidth: slideWidthStyle,
                      maxWidth: slideWidthStyle,
                      flexShrink: 0,
                      boxSizing: 'border-box',
                    }}
                  >
                    <div className="max-w-7xl mx-auto w-full">
                      <SRSModeView
                        questions={questions}
                        srsItems={srsItems}
                        isPaused={isSRSTimerPaused}
                        onSaveSRS={handleSaveSRSFromView}
                        onRecordAnswer={handleRecordSRSAnswer}
                        streakDays={stats.streak_days}
                        onExit={() => handleSelectMode('practice')}
                      />
                    </div>
                  </div>

                  {/* SLIDE 2: CADERNO DE ERROS AUTOMÁTICO */}
                  <div
                    ref={(el) => {
                      slideRefs.current[2] = el;
                    }}
                    className="shrink-0 h-full overflow-y-auto overflow-x-hidden overscroll-y-contain pb-24 lg:pb-8 bg-canvas theme-bg-canvas px-0 pt-0"
                    style={{
                      width: slideWidthStyle,
                      minWidth: slideWidthStyle,
                      maxWidth: slideWidthStyle,
                      flexShrink: 0,
                      boxSizing: 'border-box',
                    }}
                  >
                    <div className="max-w-7xl mx-auto w-full">
                      <ErrorNotebookView
                        questions={questions}
                        lastAnswers={lastAnswerMap}
                        onStartPracticeQuestion={(q) => {
                          setFilters({
                            database_id: 'all',
                            subject: 'all',
                            exam_board: 'all',
                            year: 'all',
                            topic: 'all',
                            status: 'wrong',
                            searchQuery: '',
                          });
                          handleSelectMode('practice');
                          const targetHash = getQuestionContentHash(q);
                          const idx = filteredQuestions.findIndex(
                            (item) =>
                              item.sequence_id === q.sequence_id ||
                              getQuestionContentHash(item) === targetHash
                          );
                          setCurrentIndex(idx >= 0 ? idx : 0);
                          scrollPracticeSlideToTop();
                        }}
                        onExit={() => handleSelectMode('practice')}
                        onAnswerQuestion={handleAnswer}
                        srsItems={srsItems}
                        onRateSRS={handleRateSRS}
                        bookmarks={bookmarks}
                        onToggleBookmark={handleToggleBookmark}
                        onSaveNote={handleSaveNote}
                        strikes={strikes}
                        onToggleStrike={handleToggleStrike}
                        onSetStrikes={handleSetStrikes}
                        isPaused={isErrorTimerPaused}
                        isPageSettled={
                          currentMode === 'error_notebook' &&
                          !modeDragProgress?.isDragging &&
                          !isModeTransitioning
                        }
                      />
                    </div>
                  </div>

                  {/* SLIDE 3: MODO SIMULADO COM CRONÔMETRO */}
                  <div
                    ref={(el) => {
                      slideRefs.current[3] = el;
                    }}
                    className="shrink-0 h-full overflow-y-auto overflow-x-hidden overscroll-y-contain pb-24 lg:pb-8 bg-canvas theme-bg-canvas px-4 sm:px-6 lg:px-8 pt-3 sm:pt-4"
                    style={{
                      width: slideWidthStyle,
                      minWidth: slideWidthStyle,
                      maxWidth: slideWidthStyle,
                      flexShrink: 0,
                      boxSizing: 'border-box',
                    }}
                  >
                    <div className="max-w-7xl mx-auto w-full">
                      <SimuladoView
                        questions={activePoolQuestions}
                        lastAnswers={answers}
                        isPaused={isSimuladoTimerPaused}
                        onRecordSimuladoResult={handleRecordSimuladoResult}
                        onExit={() => handleSelectMode('practice')}
                      />
                    </div>
                  </div>

                  {/* SLIDE 4: DASHBOARD DE MÉTRICAS & RETENÇÃO */}
                  <div
                    ref={(el) => {
                      slideRefs.current[4] = el;
                    }}
                    className="shrink-0 h-full overflow-y-auto overflow-x-hidden overscroll-y-contain pb-24 lg:pb-8 bg-canvas theme-bg-canvas px-4 sm:px-6 lg:px-8 pt-3 sm:pt-4"
                    style={{
                      width: slideWidthStyle,
                      minWidth: slideWidthStyle,
                      maxWidth: slideWidthStyle,
                      flexShrink: 0,
                      boxSizing: 'border-box',
                    }}
                  >
                    <div className="max-w-7xl mx-auto w-full">
                      <MetricsDashboard
                        stats={stats}
                        questions={questions}
                        srsItems={srsItems}
                        answers={answers}
                        onResetProgress={handleResetAllProgress}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          if (currentMode === 'kitchen_sink') {
            return (
              <div className="flex-1 min-h-0 h-full overflow-y-auto overflow-x-hidden overscroll-y-contain pb-24 lg:pb-8 px-4 sm:px-6 lg:px-8 pt-3 sm:pt-4">
                <div className="max-w-7xl mx-auto w-full">
                  <ThemeKitchenSink
                    onExit={() => handleSelectMode('practice')}
                    currentActiveTheme={theme}
                    onSelectActiveTheme={(newTheme) => {
                      setTheme(newTheme);
                      applyThemeToDOM(newTheme);
                      LocalStorageManager.savePreferences({ theme: newTheme });
                    }}
                  />
                </div>
              </div>
            );
          }

          return null;
        })()}
      </main>

      {/* Database Manager Modal */}
      <DatabaseManagerModal
        isOpen={isDatabaseManagerOpen}
        onClose={() => setIsDatabaseManagerOpen(false)}
        databases={databases}
        activeDatabaseId={filters.database_id}
        onSelectDatabase={handleSelectDatabase}
        onAddDatabase={handleAddDatabase}
        onRenameDatabase={handleRenameDatabase}
        onDeleteDatabase={handleDeleteDatabase}
        onRestoreDefault={handleRestoreDefaultDatabases}
        onRestoreBackupSuccess={() => {
          setDatabases(LocalStorageManager.getDatabases());
          setCurrentIndex(0);
        }}
      />

      {/* Keyboard Shortcuts Reference Modal */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />

      {/* App Info & PWA Install Modal */}
      <AppInfoModal
        isOpen={isAppInfoOpen}
        onClose={() => setIsAppInfoOpen(false)}
        totalQuestions={questions.length}
        isDevUser={isDevUser}
        onOpenKitchenSink={() => {
          setIsAppInfoOpen(false);
          handleSelectMode('kitchen_sink');
        }}
      />

      {/* Full-Screen Blur Pause Overlay */}
      <PauseOverlay
        isOpen={isPaused}
        onResume={() => setIsPaused(false)}
      />

      {/* User Account, Profile & Storage Manager Modal */}
      <UserAccountModal
        isOpen={isUserAccountModalOpen}
        onClose={() => setIsUserAccountModalOpen(false)}
        account={userAccount}
        onUpdateAccount={setUserAccount}
        stats={stats}
        onNavigateToMetrics={() => handleSelectMode('metrics')}
      />

      {/* XP Performance & Daily Goals Panel */}
      <XPPerformanceModal
        isOpen={isXPPerformanceOpen}
        onClose={() => setIsXPPerformanceOpen(false)}
        stats={stats}
        onUpdateGoal={handleUpdateDailyGoalXP}
      />

      {/* Bring Your Own Key (BYOK) AI Configuration Modal */}
      <BYOKModal
        isOpen={isBYOKModalOpen}
        onClose={() => setIsBYOKModalOpen(false)}
      />

      {/* Global AI Assistant & Learning Improvement Popover */}
      <GlobalAssistantPopover
        isOpen={isGlobalAssistantOpen}
        onClose={() => setIsGlobalAssistantOpen(false)}
        onOpenBYOKModal={() => setIsBYOKModalOpen(true)}
        stats={stats}
        answers={answers}
        questions={questions}
        currentQuestion={currentQuestion}
      />

      {/* Mobile Floating Bottom Mode Switcher Bar (< lg / compact style) */}
      <nav 
        aria-label="Navegação de modos de estudo"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-transparent pointer-events-none pb-[max(0.75rem,env(safe-area-inset-bottom))] px-3 select-none flex justify-center"
      >
        <div className="w-full max-w-md pointer-events-auto rounded-2xl shadow-xl bg-surface/90 backdrop-blur-xl border border-border">
          <DraggableModeSwitcher
            variant="bottom-bar"
            currentMode={currentMode}
            onSelectMode={handleSelectMode}
            srsDueCount={srsDueCount}
            errorCount={errorCount}
            dragProgress={modeDragProgress}
            onDragProgress={handleModeDragProgress}
          />
        </div>
      </nav>

      {/* Real-time Carousel Diagnostic Tooling & Overlay (Oculto por padrão; ativado apenas com parâmetro explícito ?diag=1) */}
      {isDevEnvironment && typeof window !== 'undefined' && window.location.search.includes('diag=1') && (
        <CarouselDiagnosticOverlay
          containerWidth={containerWidth}
          carouselContainerRef={carouselContainerRef}
          slideRefs={slideRefs}
          rightVeilRef={rightVeilRef}
          currentMode={currentMode}
        />
      )}
    </div>
  );
}
