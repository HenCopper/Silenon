import { SocraticResponseType } from './aiOrchestrator';

export const QUESTION_CHATS_DB_NAME = 'memoriz_question_chats_db';
export const QUESTION_THREADS_STORE = 'question_threads';
const DB_VERSION = 1;

export interface QuestionChatInteraction {
  id: string;
  questionStemAndAnswer: string;
  studentTranscript: string;
  aiInternalReasoning: string;
  aiSpokenResponse: string;
  responseType: SocraticResponseType;
  tags: string[];
  blockingTags: string[];
  wasInterrupted?: boolean;
  createdAt: number;
  updatedAt: number;
  analyzed: boolean;
}

export interface QuestionChatThreadRecord {
  question_id: number;
  subject: string;
  tags: string[];
  blockingTags: string[];
  interactions: QuestionChatInteraction[];
  createdAt: number;
  updatedAt: number;
  analyzed: boolean;
}

function openQuestionChatsDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB não suportado neste ambiente.'));
      return;
    }

    const request = window.indexedDB.open(QUESTION_CHATS_DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(QUESTION_THREADS_STORE)) {
        const store = db.createObjectStore(QUESTION_THREADS_STORE, {
          keyPath: 'question_id',
        });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
        store.createIndex('analyzed', 'analyzed', { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error || new Error('Erro ao abrir IndexedDB de conversas da questão.'));
    };
  });
}

export async function getQuestionThread(questionId: number): Promise<QuestionChatThreadRecord | null> {
  try {
    const db = await openQuestionChatsDB();
    return await new Promise<QuestionChatThreadRecord | null>((resolve, reject) => {
      const tx = db.transaction(QUESTION_THREADS_STORE, 'readonly');
      const store = tx.objectStore(QUESTION_THREADS_STORE);
      const req = store.get(questionId);

      req.onsuccess = () => {
        resolve((req.result as QuestionChatThreadRecord) || null);
      };
      req.onerror = () => {
        reject(req.error);
      };
    });
  } catch (err) {
    console.warn('[QuestionChatStorage] Failed to read question thread:', err);
    return null;
  }
}

export async function saveQuestionInteraction(params: {
  questionId: number;
  subject: string;
  questionTags: string[];
  questionStemAndAnswer: string;
  studentTranscript: string;
  aiInternalReasoning: string;
  aiSpokenResponse: string;
  responseType: SocraticResponseType;
  blockingTags: string[];
  wasInterrupted?: boolean;
}): Promise<{ thread: QuestionChatThreadRecord; interaction: QuestionChatInteraction }> {
  const now = Date.now();
  const interactionId = `int_${params.questionId}_${now}_${Math.random().toString(36).slice(2, 7)}`;

  const newInteraction: QuestionChatInteraction = {
    id: interactionId,
    questionStemAndAnswer: params.questionStemAndAnswer,
    studentTranscript: params.studentTranscript,
    aiInternalReasoning: params.aiInternalReasoning,
    aiSpokenResponse: params.aiSpokenResponse,
    responseType: params.responseType,
    tags: params.questionTags,
    blockingTags: params.blockingTags,
    wasInterrupted: Boolean(params.wasInterrupted),
    createdAt: now,
    updatedAt: now,
    analyzed: false,
  };

  const existing = await getQuestionThread(params.questionId);
  const mergedBlockingTags = Array.from(
    new Set([...(existing?.blockingTags || []), ...params.blockingTags])
  );
  const mergedTags = Array.from(
    new Set([...(existing?.tags || []), ...params.questionTags])
  );

  const updatedThread: QuestionChatThreadRecord = {
    question_id: params.questionId,
    subject: params.subject,
    tags: mergedTags,
    blockingTags: mergedBlockingTags,
    interactions: [...(existing?.interactions || []), newInteraction],
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    analyzed: false,
  };

  try {
    const db = await openQuestionChatsDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(QUESTION_THREADS_STORE, 'readwrite');
      const store = tx.objectStore(QUESTION_THREADS_STORE);
      const req = store.put(updatedThread);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[QuestionChatStorage] Failed to save interaction:', err);
  }

  return { thread: updatedThread, interaction: newInteraction };
}

/**
 * Atualiza cirurgicamente a resposta falada (aiSpokenResponse) quando o aluno interrompe
 * o professor no meio da fala (barge-in), salvando no IndexedDB APENAS o que já foi emitido no alto-falante.
 */
export async function truncateInteractionSpokenResponse(
  questionId: number,
  interactionId: string,
  partialSpokenText: string
): Promise<QuestionChatThreadRecord | null> {
  try {
    const existing = await getQuestionThread(questionId);
    if (!existing) return null;

    const now = Date.now();
    const updatedInteractions = existing.interactions.map((item) => {
      if (item.id !== interactionId) return item;
      return {
        ...item,
        aiSpokenResponse: partialSpokenText,
        wasInterrupted: true,
        updatedAt: now,
      };
    });

    const updatedThread: QuestionChatThreadRecord = {
      ...existing,
      interactions: updatedInteractions,
      updatedAt: now,
      analyzed: false,
    };

    const db = await openQuestionChatsDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(QUESTION_THREADS_STORE, 'readwrite');
      const store = tx.objectStore(QUESTION_THREADS_STORE);
      const req = store.put(updatedThread);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    return updatedThread;
  } catch (err) {
    console.warn('[QuestionChatStorage] Failed to truncate spoken response:', err);
    return null;
  }
}

export async function clearQuestionThread(questionId: number): Promise<void> {
  try {
    const db = await openQuestionChatsDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(QUESTION_THREADS_STORE, 'readwrite');
      const store = tx.objectStore(QUESTION_THREADS_STORE);
      const req = store.delete(questionId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[QuestionChatStorage] Failed to clear question thread:', err);
  }
}

export async function getAllQuestionThreads(): Promise<QuestionChatThreadRecord[]> {
  try {
    const db = await openQuestionChatsDB();
    return await new Promise<QuestionChatThreadRecord[]>((resolve, reject) => {
      const tx = db.transaction(QUESTION_THREADS_STORE, 'readonly');
      const store = tx.objectStore(QUESTION_THREADS_STORE);
      const req = store.getAll();

      req.onsuccess = () => {
        const list = (req.result as QuestionChatThreadRecord[]) || [];
        list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[QuestionChatStorage] Failed to get all question threads:', err);
    return [];
  }
}

export async function getUnanalyzedQuestionThreads(): Promise<QuestionChatThreadRecord[]> {
  const all = await getAllQuestionThreads();
  return all.filter(
    (t) =>
      !t.analyzed ||
      (Array.isArray(t.interactions) && t.interactions.some((i) => !i.analyzed))
  );
}

export async function markQuestionThreadsAnalyzed(questionIds: number[]): Promise<void> {
  if (!questionIds || questionIds.length === 0) return;
  try {
    const db = await openQuestionChatsDB();
    const idSet = new Set(questionIds);

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(QUESTION_THREADS_STORE, 'readwrite');
      const store = tx.objectStore(QUESTION_THREADS_STORE);
      const getAllReq = store.getAll();

      getAllReq.onsuccess = () => {
        const records = (getAllReq.result as QuestionChatThreadRecord[]) || [];
        const now = Date.now();
        for (const rec of records) {
          if (idSet.has(rec.question_id)) {
            const updated: QuestionChatThreadRecord = {
              ...rec,
              analyzed: true,
              updatedAt: now,
              interactions: (rec.interactions || []).map((i) => ({
                ...i,
                analyzed: true,
              })),
            };
            store.put(updated);
          }
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[QuestionChatStorage] Failed to mark threads as analyzed:', err);
  }
}

