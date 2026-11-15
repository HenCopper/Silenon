import { Question, QuestionDatabase, SRSItem, UserAnswerRecord, UserBookmark, SimuladoResult, UserStatistics, ThemeMode, UserAccount } from '../types/question';
import { getTodayDateString } from './srsEngine';
import { normalizeQuestionToSchemaV2 } from './schemaV2Migrator';

const STORAGE_KEYS = {
  DATABASES: 'memoriz_databases_v2',
  ACTIVE_DB: 'memoriz_active_db_v2',
  ANSWERS: 'memoriz_answers_v1',
  SRS: 'memoriz_srs_v1',
  BOOKMARKS: 'memoriz_bookmarks_v1',
  SIMULADOS: 'memoriz_simulados_v1',
  STATS: 'memoriz_stats_v1',
  CUSTOM_BANK: 'memoriz_custom_bank_v1',
  PREFS: 'memoriz_prefs_v1',
  STRIKES: 'memoriz_option_strikes_v1',
  USER_ACCOUNT: 'memoriz_user_account_v1',
  USER_PROFILES: 'memoriz_user_profiles_v1',
  LAST_QUESTION: 'memoriz_last_question_index_v1',
  UNANSWERED_TIMES: 'memoriz_unanswered_times_v1',
};

export interface UserPreferences {
  theme: ThemeMode;
  readerFontSize: number;
  readerFontFamily: 'sans' | 'serif';
  autoShowReasoning: boolean;
  soundEffects: boolean;
}

export const defaultPreferences: UserPreferences = {
  theme: 'light',
  readerFontSize: 16,
  readerFontFamily: 'serif',
  autoShowReasoning: false,
  soundEffects: true,
};

export const defaultStatistics: UserStatistics = {
  total_answered: 0,
  total_correct: 0,
  total_wrong: 0,
  streak_days: 1,
  last_study_date: getTodayDateString(),
  xp_points: 0,
  daily_goal_xp: 50,
  today_xp: 0,
  subject_stats: {},
};

export const defaultUserAccount: UserAccount = {
  id: 'user_main',
  name: 'Estudante',
  email: '',
  avatar: '🎯',
  targetExam: '',
  targetRole: '',
  dailyGoalQuestions: 30,
  experienceLevel: 'intermediario',
  createdAt: new Date().toISOString(),
  lastLoginAt: new Date().toISOString(),
  isCloudSyncEnabled: false,
  provider: 'local',
};

export class LocalStorageManager {
  private static getLegacyOwnerProfileId(): string {
    try {
      const profilesData = localStorage.getItem(STORAGE_KEYS.USER_PROFILES);
      if (profilesData) {
        const parsed = JSON.parse(profilesData);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const initialLocal = parsed.find(
            (p) => p?.id === 'user_main' || p?.id === 'local_default_user'
          );
          if (initialLocal?.id) return initialLocal.id;
          if (parsed[0]?.id && typeof parsed[0].id === 'string') {
            return parsed[0].id;
          }
        }
      }
      const accountData = localStorage.getItem(STORAGE_KEYS.USER_ACCOUNT);
      if (accountData) {
        const parsedAccount = JSON.parse(accountData);
        if (parsedAccount?.id && typeof parsedAccount.id === 'string') {
          return parsedAccount.id;
        }
      }
    } catch {
      // ignore
    }
    return defaultUserAccount.id;
  }

  private static getActiveProfileId(): string {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.USER_ACCOUNT);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed?.id && typeof parsed.id === 'string' && parsed.id.trim()) {
          return parsed.id;
        }
      }
    } catch {
      // ignore
    }
    return defaultUserAccount.id;
  }

  private static ensureLegacyProgressMigrated(explicitOwnerProfileId?: string): void {
    try {
      const targetProfileId = explicitOwnerProfileId || this.getLegacyOwnerProfileId();
      const legacyBaseKeys = [
        STORAGE_KEYS.ANSWERS,
        STORAGE_KEYS.SRS,
        STORAGE_KEYS.BOOKMARKS,
        STORAGE_KEYS.SIMULADOS,
        STORAGE_KEYS.STATS,
        STORAGE_KEYS.STRIKES,
        STORAGE_KEYS.UNANSWERED_TIMES,
      ];

      for (const baseKey of legacyBaseKeys) {
        const legacyVal = localStorage.getItem(baseKey);
        if (legacyVal !== null) {
          const scopedKey = `${baseKey}_${targetProfileId}`;
          if (localStorage.getItem(scopedKey) === null) {
            localStorage.setItem(scopedKey, legacyVal);
          }
          localStorage.removeItem(baseKey);
        }
      }

      const lastQuestionPrefix = `${STORAGE_KEYS.LAST_QUESTION}_`;
      const knownProfileIds = new Set<string>([
        targetProfileId,
        defaultUserAccount.id,
        'local_default_user',
        this.getActiveProfileId(),
      ]);

      try {
        const profilesData = localStorage.getItem(STORAGE_KEYS.USER_PROFILES);
        if (profilesData) {
          const parsed = JSON.parse(profilesData);
          if (Array.isArray(parsed)) {
            for (const p of parsed) {
              if (p?.id && typeof p.id === 'string') {
                knownProfileIds.add(p.id);
              }
            }
          }
        }
      } catch {
        // ignore
      }

      const matchingKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(lastQuestionPrefix)) {
          matchingKeys.push(key);
        }
      }

      for (const key of matchingKeys) {
        const suffix = key.slice(lastQuestionPrefix.length);
        let alreadyScoped = false;
        for (const pid of knownProfileIds) {
          if (suffix.startsWith(`${pid}_`)) {
            alreadyScoped = true;
            break;
          }
        }
        if (alreadyScoped) continue;

        const val = localStorage.getItem(key);
        if (val !== null) {
          const targetKey = `${lastQuestionPrefix}${targetProfileId}_${suffix}`;
          if (localStorage.getItem(targetKey) === null) {
            localStorage.setItem(targetKey, val);
          }
          localStorage.removeItem(key);
        }
      }
    } catch (e) {
      console.warn('Error migrating legacy progress keys', e);
    }
  }

  private static getProfileProgressKey(baseKey: string): string {
    this.ensureLegacyProgressMigrated();
    return `${baseKey}_${this.getActiveProfileId()}`;
  }

  private static getLastQuestionKey(databaseId: string = 'all'): string {
    this.ensureLegacyProgressMigrated();
    return `${STORAGE_KEYS.LAST_QUESTION}_${this.getActiveProfileId()}_${databaseId}`;
  }

  static copyProfileProgressIfEmpty(fromProfileId: string, toProfileId: string): void {
    if (!fromProfileId || !toProfileId || fromProfileId === toProfileId) return;
    try {
      this.ensureLegacyProgressMigrated(fromProfileId);
      const simpleKeys = [
        STORAGE_KEYS.ANSWERS,
        STORAGE_KEYS.SRS,
        STORAGE_KEYS.BOOKMARKS,
        STORAGE_KEYS.SIMULADOS,
        STORAGE_KEYS.STATS,
        STORAGE_KEYS.STRIKES,
        STORAGE_KEYS.UNANSWERED_TIMES,
      ];
      for (const baseKey of simpleKeys) {
        const sourceKey = `${baseKey}_${fromProfileId}`;
        const destKey = `${baseKey}_${toProfileId}`;
        const sourceVal = localStorage.getItem(sourceKey);
        if (sourceVal !== null && localStorage.getItem(destKey) === null) {
          localStorage.setItem(destKey, sourceVal);
        }
      }

      const sourcePrefix = `${STORAGE_KEYS.LAST_QUESTION}_${fromProfileId}_`;
      const destPrefix = `${STORAGE_KEYS.LAST_QUESTION}_${toProfileId}_`;
      const keysToCopy: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(sourcePrefix)) {
          keysToCopy.push(key);
        }
      }
      for (const sourceKey of keysToCopy) {
        const dbSuffix = sourceKey.slice(sourcePrefix.length);
        const destKey = `${destPrefix}${dbSuffix}`;
        const val = localStorage.getItem(sourceKey);
        if (val !== null && localStorage.getItem(destKey) === null) {
          localStorage.setItem(destKey, val);
        }
      }
    } catch (e) {
      console.warn('Error copying profile progress', e);
    }
  }

  // Answers History
  static getAnswers(): Record<number, UserAnswerRecord[]> {
    try {
      const data = localStorage.getItem(this.getProfileProgressKey(STORAGE_KEYS.ANSWERS));
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  static saveAnswer(record: UserAnswerRecord, twinQuestionIds?: number[]): Record<number, UserAnswerRecord[]> {
    const answers = this.getAnswers();
    const ids = twinQuestionIds && twinQuestionIds.length > 0 ? twinQuestionIds : [record.question_id];

    for (const qid of ids) {
      if (!answers[qid]) {
        answers[qid] = [];
      }
      answers[qid].push({
        ...record,
        question_id: qid,
      });
    }

    try {
      localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.ANSWERS), JSON.stringify(answers));
    } catch (e) {
      console.warn('LocalStorage save error', e);
    }
    return answers;
  }

  // SRS Items
  static getSRSItems(): Record<number, SRSItem> {
    try {
      const data = localStorage.getItem(this.getProfileProgressKey(STORAGE_KEYS.SRS));
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  static saveSRSItem(item: SRSItem, twinQuestionIds?: number[]): Record<number, SRSItem> {
    const items = this.getSRSItems();
    const ids = twinQuestionIds && twinQuestionIds.length > 0 ? twinQuestionIds : [item.question_id];

    for (const qid of ids) {
      items[qid] = {
        ...item,
        question_id: qid,
      };
    }

    try {
      localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.SRS), JSON.stringify(items));
    } catch (e) {
      console.warn('LocalStorage save error', e);
    }
    return items;
  }

  // Bookmarks
  static getBookmarks(): Record<number, UserBookmark> {
    try {
      const data = localStorage.getItem(this.getProfileProgressKey(STORAGE_KEYS.BOOKMARKS));
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  static toggleBookmark(questionId: number, note = '', tags: string[] = [], twinQuestionIds?: number[]): Record<number, UserBookmark> {
    const bookmarks = this.getBookmarks();
    const isCurrentlyBookmarked = !!bookmarks[questionId];
    const ids = twinQuestionIds && twinQuestionIds.length > 0 ? twinQuestionIds : [questionId];

    for (const qid of ids) {
      if (isCurrentlyBookmarked) {
        delete bookmarks[qid];
      } else {
        bookmarks[qid] = {
          question_id: qid,
          note,
          tags,
          created_at: Date.now(),
        };
      }
    }

    try {
      localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.BOOKMARKS), JSON.stringify(bookmarks));
    } catch (e) {
      console.warn('LocalStorage save error', e);
    }
    return bookmarks;
  }

  static updateBookmarkNote(questionId: number, note: string, twinQuestionIds?: number[]): Record<number, UserBookmark> {
    const bookmarks = this.getBookmarks();
    const ids = twinQuestionIds && twinQuestionIds.length > 0 ? twinQuestionIds : [questionId];

    for (const qid of ids) {
      if (!bookmarks[qid]) {
        bookmarks[qid] = {
          question_id: qid,
          note,
          tags: [],
          created_at: Date.now(),
        };
      } else {
        bookmarks[qid].note = note;
      }
    }

    try {
      localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.BOOKMARKS), JSON.stringify(bookmarks));
    } catch (e) {
      console.warn('LocalStorage save error', e);
    }
    return bookmarks;
  }

  // Option strikethroughs (temporary/persistent)
  static getOptionStrikes(): Record<number, string[]> {
    try {
      const data = localStorage.getItem(this.getProfileProgressKey(STORAGE_KEYS.STRIKES));
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  static toggleOptionStrike(questionId: number, letter: string, twinQuestionIds?: number[]): Record<number, string[]> {
    const strikes = this.getOptionStrikes();
    const current = strikes[questionId] || [];
    const shouldRemove = current.includes(letter);
    const newLetters = shouldRemove ? current.filter(l => l !== letter) : [...current, letter];

    const ids = twinQuestionIds && twinQuestionIds.length > 0 ? twinQuestionIds : [questionId];
    for (const qid of ids) {
      strikes[qid] = [...newLetters];
    }

    try {
      localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.STRIKES), JSON.stringify(strikes));
    } catch (e) {
      console.warn('LocalStorage save error', e);
    }
    return strikes;
  }

  static setOptionStrikes(questionId: number, letters: string[], twinQuestionIds?: number[]): Record<number, string[]> {
    const strikes = this.getOptionStrikes();
    const ids = twinQuestionIds && twinQuestionIds.length > 0 ? twinQuestionIds : [questionId];
    for (const qid of ids) {
      strikes[qid] = [...letters];
    }

    try {
      localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.STRIKES), JSON.stringify(strikes));
    } catch (e) {
      console.warn('LocalStorage save error', e);
    }
    return strikes;
  }

  // User Statistics & XP
  static getStatistics(profileId?: string): UserStatistics {
    try {
      let statsKey: string;
      if (profileId) {
        this.ensureLegacyProgressMigrated();
        statsKey = `${STORAGE_KEYS.STATS}_${profileId}`;
      } else {
        statsKey = this.getProfileProgressKey(STORAGE_KEYS.STATS);
      }
      const data = localStorage.getItem(statsKey);
      if (!data) {
        return {
          ...defaultStatistics,
          last_study_date: getTodayDateString(),
          subject_stats: {},
        };
      }
      const stats: UserStatistics = JSON.parse(data);
      
      // Ensure daily_goal_xp and today_xp have valid numbers
      if (!stats.daily_goal_xp || stats.daily_goal_xp <= 0) {
        stats.daily_goal_xp = 50;
      }
      if (typeof stats.today_xp !== 'number') {
        stats.today_xp = stats.xp_points || 0;
      }
      if (!stats.subject_stats || typeof stats.subject_stats !== 'object') {
        stats.subject_stats = {};
      }

      // Check day rollover for streak
      const today = getTodayDateString();
      if (stats.last_study_date !== today) {
        const lastDate = new Date(stats.last_study_date);
        const currDate = new Date(today);
        const diffDays = Math.round((currDate.getTime() - lastDate.getTime()) / (1000 * 3600 * 24));
        
        if (diffDays === 1) {
          // Continuous streak
        } else if (diffDays > 1) {
          // Streak broken
          stats.streak_days = 1;
        }
        stats.today_xp = 0;
      } else {
        // If today is the study date and today_xp is 0 while xp_points > 0, heal it
        if (stats.today_xp === 0 && stats.xp_points > 0) {
          stats.today_xp = stats.xp_points;
        }
      }
      return stats;
    } catch {
      return {
        ...defaultStatistics,
        last_study_date: getTodayDateString(),
        subject_stats: {},
      };
    }
  }

  static saveStatistics(stats: UserStatistics): UserStatistics {
    try {
      localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.STATS), JSON.stringify(stats));
    } catch (e) {
      console.warn('LocalStorage save error', e);
    }
    return stats;
  }

  static setDailyGoalXP(goal: number): UserStatistics {
    const stats = this.getStatistics();
    stats.daily_goal_xp = Math.max(10, Math.min(500, goal));
    try {
      localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.STATS), JSON.stringify(stats));
    } catch (e) {
      console.warn('LocalStorage save error', e);
    }
    return stats;
  }

  static addXP(points: number, isCorrect: boolean, subject: string): UserStatistics {
    const stats = this.getStatistics();
    const today = getTodayDateString();
    
    stats.last_study_date = today;
    stats.total_answered += 1;
    if (isCorrect) stats.total_correct += 1;
    else stats.total_wrong += 1;

    stats.xp_points += points;
    stats.today_xp += points;

    if (!stats.subject_stats[subject]) {
      stats.subject_stats[subject] = { total: 0, correct: 0 };
    }
    stats.subject_stats[subject].total += 1;
    if (isCorrect) stats.subject_stats[subject].correct += 1;

    try {
      localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.STATS), JSON.stringify(stats));
    } catch (e) {
      console.warn('LocalStorage save error', e);
    }
    return stats;
  }

  // Preferences
  static getPreferences(): UserPreferences {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PREFS);
      if (!data) return defaultPreferences;
      const parsed = JSON.parse(data);
      let theme: ThemeMode = parsed.theme || defaultPreferences.theme;
      if ((theme as any) === 'sepia') theme = 'reading';
      if ((theme as any) === 'amber') theme = 'night';
      return { ...defaultPreferences, ...parsed, theme };
    } catch {
      return defaultPreferences;
    }
  }

  static savePreferences(prefs: Partial<UserPreferences>) {
    try {
      const current = this.getPreferences();
      const updated = { ...current, ...prefs };
      localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify(updated));
      return updated;
    } catch (e) {
      console.warn('LocalStorage save error', e);
    }
  }

  // Multiple Question Databases Management
  static getDatabases(defaultQuestions: Question[] = []): QuestionDatabase[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.DATABASES);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }

      // Check legacy custom bank
      const legacyCustom = this.getCustomBank();
      if (legacyCustom && legacyCustom.length > 0) {
        const legacyDb: QuestionDatabase = {
          id: 'custom_legacy',
          name: 'Principal',
          questions: legacyCustom.map(q => ({
            ...q,
            database_id: 'custom_legacy',
            database_name: 'Principal',
          })),
          created_at: Date.now(),
          is_default: true,
        };
        const initialList = [legacyDb];
        this.saveDatabases(initialList);
        return initialList;
      }

      // Initialize with default bank only when explicit default questions exist
      if (!defaultQuestions || defaultQuestions.length === 0) {
        return [];
      }

      const defaultDb: QuestionDatabase = {
        id: 'default_main',
        name: 'Principal',
        questions: defaultQuestions.map(q => ({
          ...q,
          database_id: 'default_main',
          database_name: 'Principal',
        })),
        created_at: Date.now(),
        is_default: true,
      };
      const initialList = [defaultDb];
      this.saveDatabases(initialList);
      return initialList;
    } catch {
      return [];
    }
  }

  static saveDatabases(databases: QuestionDatabase[]) {
    try {
      localStorage.setItem(STORAGE_KEYS.DATABASES, JSON.stringify(databases));
    } catch (e) {
      console.warn('LocalStorage save error', e);
    }
  }

  /**
   * Adds a new database and re-indexes questions with collision-free sequence_ids
   */
  static addDatabase(
    newDb: { name: string; filename?: string; databaseId?: string; questions: Question[]; isDefault?: boolean },
    existingDatabases: QuestionDatabase[]
  ): { updatedDatabases: QuestionDatabase[]; newDatabaseId: string } {
    // 1. Calculate max sequence_id across existing questions AND existing stored answer/SRS records
    let maxId = 0;
    for (const db of existingDatabases) {
      for (const q of db.questions) {
        if (q.sequence_id > maxId) maxId = q.sequence_id;
      }
    }
    const existingAnswers = this.getAnswers();
    for (const qidStr of Object.keys(existingAnswers)) {
      const qid = Number(qidStr);
      if (!isNaN(qid) && qid > maxId) maxId = qid;
    }
    const existingSRS = this.getSRSItems();
    for (const qidStr of Object.keys(existingSRS)) {
      const qid = Number(qidStr);
      if (!isNaN(qid) && qid > maxId) maxId = qid;
    }

    const dbId = newDb.databaseId || `db_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    
    // 2. Normalize to Schema v2 and assign unique sequence_ids and database tags
    const normalizedQuestions: Question[] = newDb.questions.map((q) => {
      maxId++;
      const v2q = normalizeQuestionToSchemaV2(q, maxId);
      return {
        ...v2q,
        sequence_id: maxId,
        database_id: dbId,
        database_name: newDb.name,
      };
    });

    const createdDatabase: QuestionDatabase = {
      id: dbId,
      name: newDb.name,
      filename: newDb.filename,
      questions: normalizedQuestions,
      created_at: Date.now(),
      is_default: Boolean(newDb.isDefault),
    };

    const updated = [...existingDatabases, createdDatabase];
    this.saveDatabases(updated);
    return { updatedDatabases: updated, newDatabaseId: dbId };
  }

  static getActiveDatabaseId(): string | 'all' {
    try {
      const value = localStorage.getItem(STORAGE_KEYS.ACTIVE_DB);
      return value && value.trim() ? value : 'all';
    } catch {
      return 'all';
    }
  }

  static saveActiveDatabaseId(databaseId: string | 'all'): void {
    try {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_DB, databaseId);
    } catch (e) {
      console.warn('LocalStorage save error', e);
    }
  }

  static renameDatabase(
    id: string,
    newName: string,
    existingDatabases: QuestionDatabase[]
  ): QuestionDatabase[] {
    const updated = existingDatabases.map(db => {
      if (db.id === id) {
        return {
          ...db,
          name: newName,
          questions: db.questions.map(q => ({
            ...q,
            database_name: newName,
          })),
        };
      }
      return db;
    });
    this.saveDatabases(updated);
    return updated;
  }

  static deleteDatabase(
    id: string,
    existingDatabases: QuestionDatabase[]
  ): QuestionDatabase[] {
    const filtered = existingDatabases.filter(db => db.id !== id);
    this.saveDatabases(filtered);
    return filtered;
  }

  static getAllQuestions(databases: QuestionDatabase[]): Question[] {
    return databases.flatMap(db => db.questions);
  }

  // Custom Bank (Legacy compatibility)
  static getCustomBank(): Question[] | null {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CUSTOM_BANK);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  static saveCustomBank(questions: Question[]) {
    try {
      localStorage.setItem(STORAGE_KEYS.CUSTOM_BANK, JSON.stringify(questions));
    } catch (e) {
      console.warn('LocalStorage save error', e);
    }
  }

  // Simulados
  static getSimulados(): SimuladoResult[] {
    try {
      const data = localStorage.getItem(this.getProfileProgressKey(STORAGE_KEYS.SIMULADOS));
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static saveSimulado(result: SimuladoResult) {
    const list = this.getSimulados();
    list.unshift(result);
    try {
      localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.SIMULADOS), JSON.stringify(list));
    } catch (e) {
      console.warn('LocalStorage save error', e);
    }
    return list;
  }

  // Full System Export & Import (100% Offline Disk Portability)
  static exportFullBackup(databases: QuestionDatabase[], questions: Question[]): string {
    const backup = {
      app: 'Silenon',
      version: '1.0.2',
      exported_at: new Date().toISOString(),
      databases: databases,
      question_bank: questions,
      answers: this.getAnswers(),
      srs_items: this.getSRSItems(),
      bookmarks: this.getBookmarks(),
      statistics: this.getStatistics(),
      simulados: this.getSimulados(),
      preferences: this.getPreferences(),
    };
    return JSON.stringify(backup, null, 2);
  }

  static importFullBackup(jsonString: string): { 
    success: boolean; 
    message: string; 
    databases?: QuestionDatabase[];
    questions?: Question[];
  } {
    try {
      const data = JSON.parse(jsonString);
      if (data.databases && Array.isArray(data.databases) && data.databases.length > 0) {
        this.saveDatabases(data.databases);
        if (data.answers) localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.ANSWERS), JSON.stringify(data.answers));
        if (data.srs_items) localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.SRS), JSON.stringify(data.srs_items));
        if (data.bookmarks) localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.BOOKMARKS), JSON.stringify(data.bookmarks));
        if (data.statistics) localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.STATS), JSON.stringify(data.statistics));
        if (data.simulados) localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.SIMULADOS), JSON.stringify(data.simulados));
        if (data.preferences) localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify(data.preferences));

        const allQ = this.getAllQuestions(data.databases);
        return {
          success: true,
          message: `Backup restaurado com sucesso! ${data.databases.length} bancos e ${allQ.length} questões carregadas.`,
          databases: data.databases,
          questions: allQ,
        };
      } else if (data.question_bank && Array.isArray(data.question_bank)) {
        if (data.answers) localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.ANSWERS), JSON.stringify(data.answers));
        if (data.srs_items) localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.SRS), JSON.stringify(data.srs_items));
        if (data.bookmarks) localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.BOOKMARKS), JSON.stringify(data.bookmarks));
        if (data.statistics) localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.STATS), JSON.stringify(data.statistics));
        if (data.simulados) localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.SIMULADOS), JSON.stringify(data.simulados));
        if (data.preferences) localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify(data.preferences));
        
        const singleDb: QuestionDatabase = {
          id: 'imported_backup',
          name: 'Backup Importado',
          questions: data.question_bank.map((q: any) => ({
            ...q,
            database_id: 'imported_backup',
            database_name: 'Backup Importado',
          })),
          created_at: Date.now(),
        };
        this.saveDatabases([singleDb]);

        return {
          success: true,
          message: `Backup restaurado com sucesso! ${data.question_bank.length} questões carregadas.`,
          databases: [singleDb],
          questions: singleDb.questions,
        };
      } else if (Array.isArray(data)) {
        const singleDb: QuestionDatabase = {
          id: `db_${Date.now()}`,
          name: 'Banco Importado',
          questions: data.map((q: any, i: number) => ({
            ...q,
            sequence_id: q.sequence_id || i + 1,
            database_id: `db_${Date.now()}`,
            database_name: 'Banco Importado',
          })),
          created_at: Date.now(),
        };
        return {
          success: true,
          message: `Banco com ${data.length} questões importado com sucesso!`,
          databases: [singleDb],
          questions: singleDb.questions,
        };
      }
      return { success: false, message: 'Estrutura JSON inválida. Certifique-se de que contenha o nó question_bank ou databases.' };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, message: 'Falha ao processar arquivo JSON: ' + errorMsg };
    }
  }

  static resetAllProgress(): void {
    localStorage.removeItem(this.getProfileProgressKey(STORAGE_KEYS.ANSWERS));
    localStorage.removeItem(this.getProfileProgressKey(STORAGE_KEYS.SRS));
    localStorage.removeItem(this.getProfileProgressKey(STORAGE_KEYS.BOOKMARKS));
    localStorage.removeItem(this.getProfileProgressKey(STORAGE_KEYS.STATS));
    localStorage.removeItem(this.getProfileProgressKey(STORAGE_KEYS.SIMULADOS));
    localStorage.removeItem(this.getProfileProgressKey(STORAGE_KEYS.STRIKES));
    localStorage.removeItem(this.getProfileProgressKey(STORAGE_KEYS.UNANSWERED_TIMES));
  }

  // User Account & Multi-Profile System
  static getUserAccount(): UserAccount {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.USER_ACCOUNT);
      if (data) {
        const parsed = JSON.parse(data);
        const merged: UserAccount = { ...defaultUserAccount, ...parsed };
        if (merged.targetExam === 'Objetivo de Estudo') merged.targetExam = '';
        if (merged.targetRole === 'Domínio Geral') merged.targetRole = '';
        return merged;
      }
    } catch (e) {
      console.warn('Error reading user account', e);
    }
    return { ...defaultUserAccount };
  }

  static saveUserAccount(account: UserAccount): UserAccount {
    try {
      // Migrate any legacy unsuffixed progress to the initial profile BEFORE switching active account
      this.ensureLegacyProgressMigrated();

      // Read existing profiles BEFORE writing USER_ACCOUNT so the previous profile is preserved
      const profiles = this.getUserProfiles();

      const updated = {
        ...account,
        lastLoginAt: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEYS.USER_ACCOUNT, JSON.stringify(updated));

      // Also ensure this account is updated in profiles list
      const existingIdx = profiles.findIndex(p => p.id === updated.id);
      if (existingIdx >= 0) {
        profiles[existingIdx] = updated;
      } else {
        profiles.push(updated);
      }
      localStorage.setItem(STORAGE_KEYS.USER_PROFILES, JSON.stringify(profiles));

      return updated;
    } catch (e) {
      console.warn('Error saving user account', e);
      return account;
    }
  }

  static updateUserProfile(account: UserAccount): {
    savedAccount: UserAccount;
    profiles: UserAccount[];
    isActiveProfile: boolean;
  } {
    try {
      this.ensureLegacyProgressMigrated();
      const profiles = this.getUserProfiles();
      const activeAccount = this.getUserAccount();
      const isActiveProfile = account.id === activeAccount.id;

      const updated: UserAccount = {
        ...account,
        lastLoginAt: isActiveProfile ? new Date().toISOString() : account.lastLoginAt,
      };

      const existingIdx = profiles.findIndex(p => p.id === updated.id);
      if (existingIdx >= 0) {
        profiles[existingIdx] = updated;
      } else {
        profiles.push(updated);
      }
      localStorage.setItem(STORAGE_KEYS.USER_PROFILES, JSON.stringify(profiles));

      if (isActiveProfile) {
        localStorage.setItem(STORAGE_KEYS.USER_ACCOUNT, JSON.stringify(updated));
      }

      return {
        savedAccount: updated,
        profiles,
        isActiveProfile,
      };
    } catch (e) {
      console.warn('Error updating user profile', e);
      return {
        savedAccount: account,
        profiles: this.getUserProfiles(),
        isActiveProfile: false,
      };
    }
  }

  static getUserProfiles(): UserAccount[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.USER_PROFILES);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    const current = this.getUserAccount();
    return [current];
  }

  static switchUserProfile(profileId: string): UserAccount {
    this.ensureLegacyProgressMigrated();
    const profiles = this.getUserProfiles();
    const target = profiles.find(p => p.id === profileId);
    if (target) {
      localStorage.setItem(STORAGE_KEYS.USER_ACCOUNT, JSON.stringify(target));
      return target;
    }
    return this.getUserAccount();
  }

  static clearProfileProgress(profileId: string): void {
    try {
      const simpleKeys = [
        STORAGE_KEYS.ANSWERS,
        STORAGE_KEYS.SRS,
        STORAGE_KEYS.BOOKMARKS,
        STORAGE_KEYS.SIMULADOS,
        STORAGE_KEYS.STATS,
        STORAGE_KEYS.STRIKES,
        STORAGE_KEYS.UNANSWERED_TIMES,
      ];
      for (const baseKey of simpleKeys) {
        localStorage.removeItem(`${baseKey}_${profileId}`);
      }
      localStorage.removeItem(`silenon_loading_tips_stock_v1_${profileId}`);
      localStorage.removeItem(`silenon_loading_tips_meta_v1_${profileId}`);

      const lastQuestionPrefix = `${STORAGE_KEYS.LAST_QUESTION}_${profileId}_`;
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(lastQuestionPrefix)) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        localStorage.removeItem(key);
      }
    } catch (e) {
      console.warn('Error clearing profile progress', e);
    }
  }

  static deleteUserProfile(profileId: string): UserAccount[] {
    let profiles = this.getUserProfiles();
    if (profiles.length <= 1) return profiles; // cannot delete sole profile

    profiles = profiles.filter(p => p.id !== profileId);
    localStorage.setItem(STORAGE_KEYS.USER_PROFILES, JSON.stringify(profiles));

    // Remove isolated progress keys for the deleted profile
    this.clearProfileProgress(profileId);

    // If active profile was deleted, switch to the first remaining
    const current = this.getUserAccount();
    if (current.id === profileId) {
      this.switchUserProfile(profiles[0].id);
    }
    return profiles;
  }

  static getLastQuestionIndex(databaseId: string = 'all'): number {
    try {
      const raw = localStorage.getItem(this.getLastQuestionKey(databaseId));
      const idx = raw !== null ? Number(raw) : 0;
      return !isNaN(idx) && idx >= 0 ? idx : 0;
    } catch {
      return 0;
    }
  }

  static saveLastQuestionIndex(databaseId: string = 'all', index: number): void {
    try {
      localStorage.setItem(this.getLastQuestionKey(databaseId), String(index));
    } catch (e) {
      console.warn('Erro ao salvar índice da questão', e);
    }
  }

  static getUnansweredTimes(): Record<number, number> {
    try {
      const data = localStorage.getItem(this.getProfileProgressKey(STORAGE_KEYS.UNANSWERED_TIMES));
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  static saveUnansweredTime(questionId: number, seconds: number): void {
    try {
      const times = this.getUnansweredTimes();
      times[questionId] = seconds;
      localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.UNANSWERED_TIMES), JSON.stringify(times));
    } catch (e) {
      console.warn('Erro ao salvar tempo da questão', e);
    }
  }

  static clearUnansweredTime(questionId: number): void {
    try {
      const times = this.getUnansweredTimes();
      if (times[questionId] !== undefined) {
        delete times[questionId];
        localStorage.setItem(this.getProfileProgressKey(STORAGE_KEYS.UNANSWERED_TIMES), JSON.stringify(times));
      }
    } catch (e) {
      console.warn('Erro ao limpar tempo da questão', e);
    }
  }
}
