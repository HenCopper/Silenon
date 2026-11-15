import { useState, useMemo, useCallback, useEffect } from 'react';
import { 
  Question, 
  QuestionDatabase,
  StudyMode,
  FilterState, 
  SRSItem, 
  SRSRating, 
  UserAnswerRecord, 
  UserBookmark, 
  SimuladoResult, 
  UserStatistics 
} from '../types/question';
import { initialQuestionBank, loadDefaultZipQuestionBanks } from '../data/question_bank';
import { LocalStorageManager, defaultStatistics } from '../lib/storage';
import { FastSearchEngine } from '../lib/searchEngine';
import { calculateNextSRS, isItemDueForReview } from '../lib/srsEngine';
import { buildTwinMap, getQuestionContentHash, countUniqueQuestions } from '../lib/duplicateEngine';
import { deleteDatabaseMedia } from '../lib/mediaBlobStorage';
import { acquireMediaUrl, getCachedMediaUrlSync } from '../lib/mediaWindowCache';
import { preloadAndAnalyzeImage } from '../components/SmartQuestionImage';
import { detectMediaRenderKind, preloadSvgMarkup } from '../components/QuestionMediaRenderer';

interface UseStudyDataOptions {
  currentMode: StudyMode;
}

export function useStudyData({ currentMode }: UseStudyDataOptions) {
  // 1. Core Data State
  const [databases, setDatabases] = useState<QuestionDatabase[]>(() => {
    return LocalStorageManager.getDatabases(initialQuestionBank.question_bank);
  });
  const [isLoadingDefaultBanks, setIsLoadingDefaultBanks] = useState<boolean>(
    () => databases.length === 0
  );
  const [defaultBanksError, setDefaultBanksError] = useState<string | null>(null);

  const questions = useMemo(() => {
    return LocalStorageManager.getAllQuestions(databases);
  }, [databases]);

  const [answers, setAnswers] = useState<Record<number, UserAnswerRecord[]>>(() => LocalStorageManager.getAnswers());
  const [srsItems, setSRSItems] = useState<Record<number, SRSItem>>(() => LocalStorageManager.getSRSItems());
  const [bookmarks, setBookmarks] = useState<Record<number, UserBookmark>>(() => LocalStorageManager.getBookmarks());
  const [strikes, setStrikes] = useState<Record<number, string[]>>(() => LocalStorageManager.getOptionStrikes());
  const [stats, setStats] = useState<UserStatistics>(() => LocalStorageManager.getStatistics());
  const [unansweredTimes, setUnansweredTimes] = useState<Record<number, number>>(() => {
    return LocalStorageManager.getUnansweredTimes();
  });

  // 2. Filters State
  const [filters, setFilters] = useState<FilterState>(() => {
    const savedDbId = LocalStorageManager.getActiveDatabaseId();
    const isValidSaved =
      savedDbId === 'all' || databases.some((db) => db.id === savedDbId);
    const initialDbId = isValidSaved ? savedDbId : 'all';
    return {
      database_id: initialDbId,
      subject: 'all',
      exam_board: 'all',
      year: 'all',
      topic: 'all',
      status: 'all',
      searchQuery: '',
    };
  });

  const [currentIndex, setCurrentIndex] = useState<number>(() => {
    return LocalStorageManager.getLastQuestionIndex(filters.database_id);
  });

  useEffect(() => {
    if (databases.length > 0) {
      LocalStorageManager.saveActiveDatabaseId(filters.database_id);
    }
  }, [filters.database_id, databases.length]);

  const bootstrapDefaultBanks = useCallback(async () => {
    const existing = LocalStorageManager.getDatabases(initialQuestionBank.question_bank);
    if (existing.length > 0) {
      setDatabases(existing);
      setIsLoadingDefaultBanks(false);
      setDefaultBanksError(null);
      return;
    }

    setIsLoadingDefaultBanks(true);
    setDefaultBanksError(null);

    try {
      const importedBanks = await loadDefaultZipQuestionBanks();

      // Re-check after async work to stay idempotent under StrictMode/concurrent mounts
      const currentSaved = LocalStorageManager.getDatabases(initialQuestionBank.question_bank);
      if (currentSaved.length > 0) {
        setDatabases(currentSaved);
        return;
      }

      let nextDatabases: QuestionDatabase[] = [];
      let initialActiveDatabaseId: string | 'all' = 'all';

      for (const bank of importedBanks) {
        const { updatedDatabases, newDatabaseId } = LocalStorageManager.addDatabase(
          {
            name: bank.name,
            filename: bank.filename,
            databaseId: bank.databaseId,
            questions: bank.questions,
            isDefault: true,
          },
          nextDatabases
        );
        nextDatabases = updatedDatabases;
        if (bank.isInitialActive) {
          initialActiveDatabaseId = newDatabaseId;
        }
      }

      if (initialActiveDatabaseId === 'all' && nextDatabases.length > 0) {
        initialActiveDatabaseId = nextDatabases[nextDatabases.length - 1].id;
      }

      LocalStorageManager.saveActiveDatabaseId(initialActiveDatabaseId);
      setDatabases(nextDatabases);
      setFilters((prev) => ({ ...prev, database_id: initialActiveDatabaseId }));
      setCurrentIndex(LocalStorageManager.getLastQuestionIndex(initialActiveDatabaseId));
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Não foi possível carregar os bancos de questões iniciais.';
      setDefaultBanksError(message);
    } finally {
      setIsLoadingDefaultBanks(false);
    }
  }, []);

  useEffect(() => {
    if (LocalStorageManager.getDatabases(initialQuestionBank.question_bank).length === 0) {
      void bootstrapDefaultBanks();
    } else {
      setIsLoadingDefaultBanks(false);
    }
  }, [bootstrapDefaultBanks]);

  // 3. High-performance Search Engine Instance
  const searchEngine = useMemo(() => {
    return new FastSearchEngine(questions);
  }, [questions]);

  // 4. Derived Twin Map for duplicate questions
  const twinMap = useMemo(() => {
    return buildTwinMap(questions);
  }, [questions]);

  // 5. Derived Map of latest answers per question
  const lastAnswerMap = useMemo(() => {
    const rawMap: Record<number, UserAnswerRecord> = {};
    const hashToAnswerMap = new Map<string, UserAnswerRecord>();

    for (const [qidStr, recordList] of Object.entries(answers) as [string, UserAnswerRecord[]][]) {
      const qid = Number(qidStr);
      if (recordList && recordList.length > 0) {
        const latest = recordList[recordList.length - 1];
        if (latest.content_hash) {
          hashToAnswerMap.set(latest.content_hash, latest);
        }
        rawMap[qid] = latest;
      }
    }

    const verifiedMap: Record<number, UserAnswerRecord> = {};
    for (const q of questions) {
      const qHash = getQuestionContentHash(q);
      const answerByHash = hashToAnswerMap.get(qHash);
      if (answerByHash) {
        verifiedMap[q.sequence_id] = { ...answerByHash, question_id: q.sequence_id };
      } else if (rawMap[q.sequence_id]) {
        const directAns = rawMap[q.sequence_id];
        if (directAns.content_hash) {
          if (directAns.content_hash === qHash) {
            verifiedMap[q.sequence_id] = directAns;
          }
        } else {
          const qDb = q.database_id || 'default_main';
          const ansDb = directAns.database_id || 'default_main';
          if (qDb === ansDb) {
            verifiedMap[q.sequence_id] = directAns;
          }
        }
      }
    }

    return verifiedMap;
  }, [answers, questions]);

  // 6. Compute Filtered Question Indices via Inverted Index
  const matchedIndices = useMemo(() => {
    return searchEngine.filter(filters, srsItems, bookmarks, lastAnswerMap);
  }, [searchEngine, filters, srsItems, bookmarks, lastAnswerMap]);

  // 7. Filtered Questions Array
  const filteredQuestions = useMemo(() => {
    return matchedIndices
      .map(idx => questions[idx])
      .filter((q): q is Question => Boolean(q));
  }, [matchedIndices, questions]);

  // 8. Compute Facet Counts for Filter Sidebar
  const { subjectCounts, statusCounts } = useMemo(() => {
    return searchEngine.getFacetCounts(filters, srsItems, bookmarks, lastAnswerMap);
  }, [searchEngine, filters, lastAnswerMap, bookmarks, srsItems]);

  // 9. Clamp Current Index safely
  useEffect(() => {
    if (currentIndex >= filteredQuestions.length && filteredQuestions.length > 0) {
      setCurrentIndex(filteredQuestions.length - 1);
    }
  }, [filteredQuestions.length, currentIndex]);

  // Gravação automática da última questão acessada por banco
  useEffect(() => {
    if (filteredQuestions.length > 0 && currentIndex >= 0) {
      LocalStorageManager.saveLastQuestionIndex(filters.database_id, currentIndex);
    }
  }, [currentIndex, filters.database_id, filteredQuestions.length]);

  const currentQuestion: Question | undefined = filteredQuestions[currentIndex];

  // Silent RAM preload (Image decode + monochrome canvas inspection + SVG cache) for adjacent questions
  useEffect(() => {
    if (currentMode !== 'practice' || filteredQuestions.length === 0) return;

    const adjacentQuestions: Question[] = [];
    const nextQ =
      currentIndex + 1 >= 0 && currentIndex + 1 < filteredQuestions.length
        ? filteredQuestions[currentIndex + 1]
        : undefined;
    const prevQ =
      currentIndex - 1 >= 0 && currentIndex - 1 < filteredQuestions.length
        ? filteredQuestions[currentIndex - 1]
        : undefined;
    if (nextQ) adjacentQuestions.push(nextQ);
    if (prevQ) adjacentQuestions.push(prevQ);
    if (adjacentQuestions.length === 0) return;

    let cancelled = false;
    const mediaItems: Array<{ url: string; type?: string }> = [];
    const seenUrls = new Set<string>();

    const pushMedia = (url?: string | null, type?: string) => {
      const trimmed = url?.trim();
      if (!trimmed || seenUrls.has(trimmed)) return;
      seenUrls.add(trimmed);
      mediaItems.push({ url: trimmed, type });
    };

    for (const q of adjacentQuestions) {
      if (!q) continue;
      if (Array.isArray(q?.media)) {
        for (const m of q.media) pushMedia(m?.url, m?.type);
      }
      if (Array.isArray(q?.options)) {
        for (const opt of q.options) {
          pushMedia(opt?.media_url);
          if (Array.isArray(opt?.media)) {
            for (const m of opt.media) pushMedia(m?.url, m?.type);
          }
        }
      }
      if (Array.isArray(q?.resolution?.media)) {
        for (const m of q.resolution.media) pushMedia(m?.url, m?.type);
      }
    }

    if (mediaItems.length === 0) return;

    const runPreload = () => {
      if (cancelled) return;
      for (const item of mediaItems) {
        const kind = detectMediaRenderKind(item.url, item.type);
        if (kind === 'audio' || kind === 'video') continue;

        const syncResolved = getCachedMediaUrlSync(item.url);
        const resolvePromise = syncResolved
          ? Promise.resolve(syncResolved)
          : acquireMediaUrl(item.url);

        void resolvePromise.then((resolved) => {
          if (cancelled || !resolved) return;
          if (kind === 'svg') {
            void preloadSvgMarkup(resolved, item.url);
          } else {
            void preloadAndAnalyzeImage(resolved);
          }
        });
      }
    };

    const timerId = window.setTimeout(runPreload, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [currentMode, filteredQuestions, currentIndex]);

  // 10. Handler: Answer Submission
  const handleAnswer = useCallback((
    letter: string, 
    timeSpentSeconds: number, 
    answeredStrikes?: string[], 
    targetQuestionOverride?: Question,
    eliminatedOptionsTimestamp?: number
  ) => {
    const q = targetQuestionOverride || currentQuestion;
    if (!q) return;

    const isCorrect = letter === q.resolution.deduced_answer;
    const earnedXP = isCorrect ? 15 : 5;
    const twinIds = twinMap.get(q.sequence_id) || [q.sequence_id];
    const strikesToSave = answeredStrikes !== undefined ? answeredStrikes : (strikes[q.sequence_id] || []);
    const now = Date.now();
    const strikeMoment = eliminatedOptionsTimestamp ?? now;

    const record: UserAnswerRecord = {
      question_id: q.sequence_id,
      content_hash: getQuestionContentHash(q),
      database_id: q.database_id || 'default_main',
      selected_letter: letter,
      is_correct: isCorrect,
      timestamp: now,
      time_spent_seconds: timeSpentSeconds,
      mode: currentMode === 'practice' ? 'practice' : 'error_notebook',
      eliminated_options: strikesToSave,
      eliminated_options_timestamp: strikeMoment,
    };

    const updatedAnswers = LocalStorageManager.saveAnswer(record, twinIds);
    setAnswers(updatedAnswers);

    const updatedStats = LocalStorageManager.addXP(earnedXP, isCorrect, q.metadata.subject);
    setStats(updatedStats);

    const existingSRS = srsItems[q.sequence_id];
    const defaultRating: SRSRating = isCorrect ? 2 : 1;
    const updatedSRS = calculateNextSRS(existingSRS, defaultRating, q.sequence_id);
    const newSRSItems = LocalStorageManager.saveSRSItem(updatedSRS, twinIds);
    setSRSItems(newSRSItems);

    LocalStorageManager.clearUnansweredTime(q.sequence_id);
    setUnansweredTimes(prev => {
      const next = { ...prev };
      delete next[q.sequence_id];
      return next;
    });
  }, [currentQuestion, currentMode, srsItems, twinMap, strikes]);

  // 11. Handler: Rate SRS manually
  const handleRateSRS = useCallback((rating: SRSRating, targetQuestionOverride?: Question) => {
    const q = targetQuestionOverride || currentQuestion;
    if (!q) return;
    const twinIds = twinMap.get(q.sequence_id) || [q.sequence_id];
    const existingSRS = srsItems[q.sequence_id];
    const updated = calculateNextSRS(existingSRS, rating, q.sequence_id);
    const newSRSItems = LocalStorageManager.saveSRSItem(updated, twinIds);
    setSRSItems(newSRSItems);
  }, [currentQuestion, srsItems, twinMap]);

  // 12. Handler: Toggle Bookmark
  const handleToggleBookmark = useCallback((targetQuestionOverride?: Question) => {
    const isValidQuestion = Boolean(
      targetQuestionOverride && 
      typeof (targetQuestionOverride as any).sequence_id === 'number'
    );
    const q = isValidQuestion ? targetQuestionOverride : currentQuestion;
    if (!q || typeof q.sequence_id !== 'number') return;

    const twinIds = twinMap.get(q.sequence_id) || [q.sequence_id];
    const newBookmarks = LocalStorageManager.toggleBookmark(q.sequence_id, '', [], twinIds);
    setBookmarks(newBookmarks);
  }, [currentQuestion, twinMap]);

  // 13. Handler: Save Personal Note
  const handleSaveNote = useCallback((note: string, targetQuestionId?: number) => {
    const qid = targetQuestionId ?? currentQuestion?.sequence_id;
    if (!qid) return;
    const twinIds = twinMap.get(qid) || [qid];
    const newBookmarks = LocalStorageManager.updateBookmarkNote(qid, note, twinIds);
    setBookmarks(newBookmarks);
  }, [currentQuestion, twinMap]);

  // 14. Handler: Option Strike
  const handleToggleStrike = useCallback((letter: string, targetQuestionId?: number) => {
    const qid = targetQuestionId ?? currentQuestion?.sequence_id;
    if (!qid) return;
    const twinIds = twinMap.get(qid) || [qid];
    const newStrikes = LocalStorageManager.toggleOptionStrike(qid, letter, twinIds);
    setStrikes(newStrikes);
  }, [currentQuestion, twinMap]);

  // 15. Handler: Set All Strikes for question
  const handleSetStrikes = useCallback((letters: string[]) => {
    if (!currentQuestion) return;
    const twinIds = twinMap.get(currentQuestion.sequence_id) || [currentQuestion.sequence_id];
    const newStrikes = LocalStorageManager.setOptionStrikes(currentQuestion.sequence_id, letters, twinIds);
    setStrikes(newStrikes);
  }, [currentQuestion, twinMap]);

  // 16. Error count & SRS due count for badges
  const errorCount = useMemo(() => {
    const wrongHashes = new Set<string>();
    for (const q of questions) {
      const last = lastAnswerMap[q.sequence_id];
      if (last && !last.is_correct) {
        wrongHashes.add(getQuestionContentHash(q));
      }
    }
    return wrongHashes.size;
  }, [questions, lastAnswerMap]);

  const srsDueCount = useMemo(() => {
    const dueHashes = new Set<string>();
    for (const q of questions) {
      if (isItemDueForReview(srsItems[q.sequence_id])) {
        dueHashes.add(getQuestionContentHash(q));
      }
    }
    return dueHashes.size;
  }, [questions, srsItems]);

  const activePoolQuestions = useMemo(() => {
    if (filters.database_id === 'all') return questions;
    return questions.filter(q => (q.database_id || 'default_main') === filters.database_id);
  }, [questions, filters.database_id]);

  const totalPoolUniqueQuestions = useMemo(() => {
    return countUniqueQuestions(activePoolQuestions);
  }, [activePoolQuestions]);

  const hasActiveFilters = 
    filters.database_id !== 'all' ||
    filters.subject !== 'all' || 
    filters.exam_board !== 'all' || 
    filters.year !== 'all' || 
    filters.topic !== 'all' || 
    filters.status !== 'all' || 
    filters.searchQuery.trim() !== '';

  // 17. Database actions
  const handleSelectDatabase = useCallback((dbId: string | 'all') => {
    LocalStorageManager.saveActiveDatabaseId(dbId);
    setFilters(prev => ({ ...prev, database_id: dbId }));
    const savedIndex = LocalStorageManager.getLastQuestionIndex(dbId);
    setCurrentIndex(savedIndex);
  }, []);

  const handleAddDatabase = useCallback((
    newDb: { name: string; filename?: string; databaseId?: string; questions: Question[] }, 
    activateImmediately: boolean
  ) => {
    const { updatedDatabases, newDatabaseId } = LocalStorageManager.addDatabase(newDb, databases);
    setDatabases(updatedDatabases);
    if (activateImmediately) {
      LocalStorageManager.saveActiveDatabaseId(newDatabaseId);
      setFilters(prev => ({ ...prev, database_id: newDatabaseId }));
    }
    setCurrentIndex(0);
  }, [databases]);

  const handleRenameDatabase = useCallback((id: string, newName: string) => {
    const updated = LocalStorageManager.renameDatabase(id, newName, databases);
    setDatabases(updated);
  }, [databases]);

  const handleDeleteDatabase = useCallback((id: string) => {
    deleteDatabaseMedia(id).catch(() => {});
    const updated = LocalStorageManager.deleteDatabase(id, databases);
    setDatabases(updated);
    if (filters.database_id === id) {
      LocalStorageManager.saveActiveDatabaseId('all');
      setFilters(prev => ({ ...prev, database_id: 'all' }));
    }
    setCurrentIndex(0);
  }, [databases, filters.database_id]);

  const handleRestoreDefaultDatabases = useCallback(async () => {
    setIsLoadingDefaultBanks(true);
    setDefaultBanksError(null);
    try {
      await Promise.all(
        databases.map((db) => deleteDatabaseMedia(db.id).catch(() => {}))
      );

      const importedBanks = await loadDefaultZipQuestionBanks();
      let nextDatabases: QuestionDatabase[] = [];
      let initialActiveDatabaseId: string | 'all' = 'all';

      for (const bank of importedBanks) {
        const { updatedDatabases, newDatabaseId } = LocalStorageManager.addDatabase(
          {
            name: bank.name,
            filename: bank.filename,
            databaseId: bank.databaseId,
            questions: bank.questions,
            isDefault: true,
          },
          nextDatabases
        );
        nextDatabases = updatedDatabases;
        if (bank.isInitialActive) {
          initialActiveDatabaseId = newDatabaseId;
        }
      }

      if (initialActiveDatabaseId === 'all' && nextDatabases.length > 0) {
        initialActiveDatabaseId = nextDatabases[nextDatabases.length - 1].id;
      }

      LocalStorageManager.saveActiveDatabaseId(initialActiveDatabaseId);
      setDatabases(nextDatabases);
      setFilters(prev => ({ ...prev, database_id: initialActiveDatabaseId }));
      setCurrentIndex(0);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Não foi possível restaurar os bancos padrão.';
      setDefaultBanksError(message);
      throw err;
    } finally {
      setIsLoadingDefaultBanks(false);
    }
  }, [databases]);

  // 18. Simulado and SRS view helpers
  const handleRecordSimuladoResult = useCallback((result: SimuladoResult) => {
    LocalStorageManager.saveSimulado(result);
    for (const [qidStr, ans] of Object.entries(result.answers) as [string, { selected: string; correct: string; is_correct: boolean }][]) {
      if (!ans.selected) continue;
      const qid = Number(qidStr);
      const twinIds = twinMap.get(qid) || [qid];
      const record: UserAnswerRecord = {
        question_id: qid,
        selected_letter: ans.selected,
        is_correct: ans.is_correct,
        timestamp: Date.now(),
        time_spent_seconds: Math.round(result.time_spent_seconds / Math.max(1, result.total_questions)),
        mode: 'simulado',
      };
      LocalStorageManager.saveAnswer(record, twinIds);
    }
    setAnswers(LocalStorageManager.getAnswers());
    const updatedStats = LocalStorageManager.addXP(
      result.correct_count * 20, 
      result.score_percentage >= 70, 
      'Simulados'
    );
    setStats(updatedStats);
  }, [twinMap]);

  const handleSaveSRSFromView = useCallback((item: SRSItem) => {
    const twinIds = twinMap.get(item.question_id) || [item.question_id];
    const updated = LocalStorageManager.saveSRSItem(item, twinIds);
    setSRSItems(updated);
  }, [twinMap]);

  const handleRecordSRSAnswer = useCallback((record: UserAnswerRecord) => {
    const twinIds = twinMap.get(record.question_id) || [record.question_id];
    const updated = LocalStorageManager.saveAnswer(record, twinIds);
    setAnswers(updated);
    const isCorrect = record.is_correct;
    const q = questions.find(item => item.sequence_id === record.question_id);
    if (q) {
      const updatedStats = LocalStorageManager.addXP(isCorrect ? 20 : 5, isCorrect, q.metadata.subject);
      setStats(updatedStats);
    }
  }, [twinMap, questions]);

  const reloadStudyProgress = useCallback(() => {
    setAnswers(LocalStorageManager.getAnswers());
    setSRSItems(LocalStorageManager.getSRSItems());
    setBookmarks(LocalStorageManager.getBookmarks());
    setStrikes(LocalStorageManager.getOptionStrikes());
    setStats(LocalStorageManager.getStatistics());
    setUnansweredTimes(LocalStorageManager.getUnansweredTimes());
    setCurrentIndex(LocalStorageManager.getLastQuestionIndex(filters.database_id));
  }, [filters.database_id]);

  const handleResetAllProgress = useCallback(() => {
    LocalStorageManager.resetAllProgress();
    setAnswers({});
    setSRSItems({});
    setBookmarks({});
    setStrikes({});
    setStats({ ...defaultStatistics, subject_stats: {} });
    setUnansweredTimes({});
  }, []);

  const handleUpdateElapsedSeconds = useCallback((sequenceId: number, secs: number) => {
    setUnansweredTimes(prev => {
      if (prev[sequenceId] === secs) return prev;
      LocalStorageManager.saveUnansweredTime(sequenceId, secs);
      return { ...prev, [sequenceId]: secs };
    });
  }, []);

  const handleUpdateDailyGoalXP = useCallback((newGoal: number) => {
    const updated = LocalStorageManager.setDailyGoalXP(newGoal);
    setStats(updated);
  }, []);

  return {
    databases,
    setDatabases,
    isLoadingDefaultBanks,
    defaultBanksError,
    handleRetryDefaultBanks: bootstrapDefaultBanks,
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
    matchedIndices,
    filteredQuestions,
    currentQuestion,
    subjectCounts,
    statusCounts,
    errorCount,
    srsDueCount,
    activePoolQuestions,
    totalPoolUniqueQuestions,
    hasActiveFilters,
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
    reloadStudyProgress,
    handleUpdateElapsedSeconds,
    handleUpdateDailyGoalXP,
  };
}
