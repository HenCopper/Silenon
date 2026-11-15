import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  signOut, 
  GoogleAuthProvider,
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  deleteDoc,
  getDocFromServer 
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  UserAccount,
  UserStatistics,
  SRSItem,
  UserAnswerRecord,
  UserBookmark,
  QuestionDatabase,
  Question,
} from '../types/question';
import { EncryptedVaultBlob } from './cryptoVault';

// 1. Initialize Firebase App and Services
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

/* CRITICAL: The app will break without firebaseConfig.firestoreDatabaseId */
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export { onAuthStateChanged };
export type { FirebaseUser };

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

// 2. Validate Connection to Firestore on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is offline or database is provisioning.');
    }
  }
}
testConnection();

// 3. Error Handling adhering to the ABAC / Firestore specification
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// 4. Map Firebase Auth Errors to User-Friendly Portuguese Messages
export function getFriendlyAuthErrorMessage(error: unknown): string {
  if (!error) return 'Erro desconhecido durante a autenticação.';
  
  const errCode = (error as { code?: string })?.code || '';
  const errMsg = error instanceof Error ? error.message : String(error);

  switch (errCode) {
    case 'auth/popup-closed-by-user':
      return 'O login foi cancelado antes de ser concluído. Você pode tentar novamente a qualquer momento.';
    case 'auth/popup-blocked':
      return 'A janela de autenticação foi bloqueada pelo navegador. Permita popups para este site para fazer login com o Google.';
    case 'auth/cancelled-popup-request':
      return 'A solicitação de login anterior foi cancelada.';
    case 'auth/network-request-failed':
      return 'Falha de conexão com a internet. Verifique sua rede e tente novamente.';
    case 'auth/account-exists-with-different-credential':
      return 'Já existe uma conta associada a este e-mail com outro método de login.';
    case 'auth/user-disabled':
      return 'Esta conta de usuário foi desativada pelo administrador.';
    case 'auth/operation-not-allowed':
      return 'O login com Google não está habilitado no projeto de autenticação.';
    case 'auth/unauthorized-domain':
      return 'O domínio atual não está autorizado para autenticação no Firebase. Configure o domínio no Console do Firebase.';
    default:
      if (errMsg.toLowerCase().includes('network') || errMsg.toLowerCase().includes('offline')) {
        return 'Falha de conexão com a internet. Verifique sua rede e tente novamente.';
      }
      return `Falha ao autenticar com o Google (${errCode || errMsg}). Tente novamente.`;
  }
}

// 5. Firebase Auth Helpers
export async function signInWithGoogleReal(): Promise<FirebaseUser> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutReal(): Promise<void> {
  await signOut(auth);
}

// 6. Firestore Synchronization Helpers
export interface SyncedCloudData {
  account: Partial<UserAccount>;
  stats?: UserStatistics;
  srsItems?: Record<number, SRSItem>;
  answers?: Record<number, UserAnswerRecord[]>;
  bookmarks?: Record<number, UserBookmark>;
  lastSyncedAt?: string;
}

/**
 * Saves or updates the user profile and study progress in Firestore
 */
export async function syncUserDataToFirestore(
  user: FirebaseUser,
  currentAccount: UserAccount,
  studyData?: {
    stats?: UserStatistics;
    srsItems?: Record<number, SRSItem>;
    answers?: Record<number, UserAnswerRecord[]>;
    bookmarks?: Record<number, UserBookmark>;
  }
): Promise<{ success: boolean; lastSyncedAt: string }> {
  const userId = user.uid;
  const userDocPath = `users/${userId}`;
  const syncDocPath = `users/${userId}/sync/progress`;
  const timestamp = new Date().toISOString();

  // 1. Prepare profile payload conforming strictly to UserProfile schema in blueprint
  const userProfilePayload = {
    userId,
    name: (user.displayName || currentAccount.name || 'Estudante').slice(0, 100),
    email: (user.email || currentAccount.email || '').slice(0, 150),
    avatar: (user.photoURL || currentAccount.avatar || '🎯').slice(0, 500),
    targetExam: (currentAccount.targetExam || '').slice(0, 100),
    targetRole: (currentAccount.targetRole || '').slice(0, 100),
    dailyGoalQuestions: Math.max(1, Math.min(1000, currentAccount.dailyGoalQuestions || 30)),
    experienceLevel: currentAccount.experienceLevel || 'intermediario',
    isCloudSyncEnabled: true,
    provider: 'google',
    createdAt: currentAccount.createdAt || timestamp,
    updatedAt: timestamp,
  };

  try {
    await setDoc(doc(db, 'users', userId), userProfilePayload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userDocPath);
  }

  // 2. Save study data progress to subcollection if provided
  if (studyData) {
    const syncPayload = {
      userId,
      stats: studyData.stats || null,
      srsItemsJson: studyData.srsItems ? JSON.stringify(studyData.srsItems) : '{}',
      answersJson: studyData.answers ? JSON.stringify(studyData.answers) : '{}',
      bookmarksJson: studyData.bookmarks ? JSON.stringify(studyData.bookmarks) : '{}',
      lastSyncedAt: timestamp,
    };

    try {
      await setDoc(doc(db, 'users', userId, 'sync', 'progress'), syncPayload, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, syncDocPath);
    }
  }

  return { success: true, lastSyncedAt: timestamp };
}

/**
 * Loads cloud data from Firestore for the given user ID
 */
export async function loadUserDataFromFirestore(userId: string): Promise<SyncedCloudData | null> {
  const userDocPath = `users/${userId}`;
  const syncDocPath = `users/${userId}/sync/progress`;

  let profileData: Partial<UserAccount> | null = null;
  let syncData: any = null;

  try {
    const profileSnap = await getDoc(doc(db, 'users', userId));
    if (profileSnap.exists()) {
      profileData = profileSnap.data() as Partial<UserAccount>;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userDocPath);
  }

  try {
    const syncSnap = await getDoc(doc(db, 'users', userId, 'sync', 'progress'));
    if (syncSnap.exists()) {
      syncData = syncSnap.data();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, syncDocPath);
  }

  if (!profileData && !syncData) {
    return null;
  }

  let srsItems: Record<number, SRSItem> | undefined;
  let answers: Record<number, UserAnswerRecord[]> | undefined;
  let bookmarks: Record<number, UserBookmark> | undefined;

  if (syncData?.srsItemsJson) {
    try {
      srsItems = JSON.parse(syncData.srsItemsJson);
    } catch {
      // ignore
    }
  }
  if (syncData?.answersJson) {
    try {
      answers = JSON.parse(syncData.answersJson);
    } catch {
      // ignore
    }
  }
  if (syncData?.bookmarksJson) {
    try {
      bookmarks = JSON.parse(syncData.bookmarksJson);
    } catch {
      // ignore
    }
  }

  return {
    account: profileData || {},
    stats: syncData?.stats || undefined,
    srsItems,
    answers,
    bookmarks,
    lastSyncedAt: syncData?.lastSyncedAt || profileData?.lastLoginAt,
  };
}

// 7. Question Databases Cloud Synchronization (Chunked <= 650,000 chars per Firestore doc)
const MAX_DB_CHUNK_CHARS = 650_000;
const MAX_INLINE_DATA_URI_LENGTH = 2048;

export function toFirestoreSafeId(rawId: string): string {
  const cleaned = String(rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80);
  return cleaned || 'db_default';
}

function stripHeavyInlineDataUrlsFromQuestion(q: Question): Question {
  const isHeavyDataUri = (url?: string) =>
    typeof url === 'string' && url.startsWith('data:') && url.length > MAX_INLINE_DATA_URI_LENGTH;

  const cleanMedia = Array.isArray(q.media)
    ? q.media.filter((m) => m && !isHeavyDataUri(m.url))
    : q.media;

  const cleanOptions = Array.isArray(q.options)
    ? q.options.map((opt) => {
        const nextOpt = { ...opt };
        if (isHeavyDataUri(nextOpt.media_url)) {
          delete nextOpt.media_url;
        }
        if (Array.isArray(nextOpt.media)) {
          nextOpt.media = nextOpt.media.filter((m) => m && !isHeavyDataUri(m.url));
        }
        return nextOpt;
      })
    : q.options;

  const cleanResolution = q.resolution
    ? {
        ...q.resolution,
        ...(Array.isArray(q.resolution.media)
          ? {
              media: q.resolution.media.filter((m) => m && !isHeavyDataUri(m.url)),
            }
          : {}),
      }
    : q.resolution;

  return {
    ...q,
    ...(cleanMedia !== undefined ? { media: cleanMedia } : {}),
    options: cleanOptions,
    resolution: cleanResolution,
  };
}

export async function syncDatabasesToFirestore(
  userId: string,
  databases: QuestionDatabase[]
): Promise<{ lastSyncedAt: string; syncedCount: number }> {
  if (!userId) {
    throw new Error('Usuário não autenticado para sincronizar bancos.');
  }

  const timestamp = new Date().toISOString();
  const indexDocPath = `users/${userId}/sync/databases_index`;

  // Read previous index to clean up stale chunk documents if needed
  let previousChunkCounts: Record<string, number> = {};
  let previousDatabaseIds: string[] = [];
  try {
    const prevSnap = await getDoc(doc(db, 'users', userId, 'sync', 'databases_index'));
    if (prevSnap.exists()) {
      const prevData = prevSnap.data();
      if (Array.isArray(prevData?.databaseIds)) {
        previousDatabaseIds = prevData.databaseIds.filter((id: unknown) => typeof id === 'string');
      }
      if (prevData?.chunkCounts && typeof prevData.chunkCounts === 'object') {
        previousChunkCounts = prevData.chunkCounts as Record<string, number>;
      }
    }
  } catch {
    // Non-fatal if index doesn't exist yet
  }

  const databaseIds: string[] = [];
  const chunkCounts: Record<string, number> = {};
  const usedSafeIds = new Set<string>();

  for (const database of databases) {
    if (!database || !Array.isArray(database.questions)) continue;

    let safeId = toFirestoreSafeId(database.id);
    if (usedSafeIds.has(safeId)) {
      safeId = `${safeId.slice(0, 70)}_${usedSafeIds.size + 1}`;
    }
    usedSafeIds.add(safeId);

    const sanitizedDb: QuestionDatabase = {
      ...database,
      questions: database.questions.map(stripHeavyInlineDataUrlsFromQuestion),
    };

    const serialized = JSON.stringify(sanitizedDb);
    const totalChunks = Math.max(1, Math.ceil(serialized.length / MAX_DB_CHUNK_CHARS));

    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
      const chunkPayload = serialized.slice(
        chunkIdx * MAX_DB_CHUNK_CHARS,
        (chunkIdx + 1) * MAX_DB_CHUNK_CHARS
      );
      const chunkDocId = `db_${safeId}_${chunkIdx}`;
      const chunkDocPath = `users/${userId}/sync/${chunkDocId}`;

      try {
        await setDoc(doc(db, 'users', userId, 'sync', chunkDocId), {
          userId,
          lastSyncedAt: timestamp,
          dbId: database.id,
          safeId,
          chunkIndex: chunkIdx,
          totalChunks,
          payload: chunkPayload,
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, chunkDocPath);
      }
    }

    databaseIds.push(safeId);
    chunkCounts[safeId] = totalChunks;
  }

  // Save databases_index document
  try {
    await setDoc(doc(db, 'users', userId, 'sync', 'databases_index'), {
      userId,
      lastSyncedAt: timestamp,
      databaseIds,
      chunkCounts,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, indexDocPath);
  }

  // Clean up removed database chunks or extra chunks from shrunken databases
  for (const prevSafeId of previousDatabaseIds) {
    const prevCount = Number(previousChunkCounts[prevSafeId]) || 1;
    const currentCount = usedSafeIds.has(prevSafeId) ? chunkCounts[prevSafeId] || 0 : 0;
    for (let idx = currentCount; idx < prevCount; idx++) {
      const staleDocId = `db_${prevSafeId}_${idx}`;
      try {
        await deleteDoc(doc(db, 'users', userId, 'sync', staleDocId));
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  return { lastSyncedAt: timestamp, syncedCount: databaseIds.length };
}

export async function loadDatabasesFromFirestore(userId: string): Promise<QuestionDatabase[]> {
  if (!userId) return [];

  const indexDocPath = `users/${userId}/sync/databases_index`;
  let indexData: any = null;

  try {
    const indexSnap = await getDoc(doc(db, 'users', userId, 'sync', 'databases_index'));
    if (!indexSnap.exists()) {
      return [];
    }
    indexData = indexSnap.data();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, indexDocPath);
  }

  const safeIds: string[] = Array.isArray(indexData?.databaseIds)
    ? indexData.databaseIds.filter((id: unknown) => typeof id === 'string' && id.length > 0)
    : [];

  if (safeIds.length === 0) {
    return [];
  }

  const loadedDatabases: QuestionDatabase[] = [];

  for (const safeId of safeIds) {
    const cleanSafeId = toFirestoreSafeId(safeId);
    const firstChunkId = `db_${cleanSafeId}_0`;
    const firstChunkPath = `users/${userId}/sync/${firstChunkId}`;

    let firstChunkData: any = null;
    try {
      const firstSnap = await getDoc(doc(db, 'users', userId, 'sync', firstChunkId));
      if (!firstSnap.exists()) continue;
      firstChunkData = firstSnap.data();
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, firstChunkPath);
    }

    const totalChunks = Math.max(
      1,
      Number(firstChunkData?.totalChunks || indexData?.chunkCounts?.[cleanSafeId] || 1)
    );
    const chunks: string[] = [String(firstChunkData?.payload || '')];

    for (let chunkIdx = 1; chunkIdx < totalChunks; chunkIdx++) {
      const chunkDocId = `db_${cleanSafeId}_${chunkIdx}`;
      const chunkDocPath = `users/${userId}/sync/${chunkDocId}`;
      try {
        const snap = await getDoc(doc(db, 'users', userId, 'sync', chunkDocId));
        if (snap.exists()) {
          chunks.push(String(snap.data()?.payload || ''));
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, chunkDocPath);
      }
    }

    try {
      const fullJson = chunks.join('');
      const parsed = JSON.parse(fullJson) as QuestionDatabase;
      if (parsed && typeof parsed.id === 'string' && Array.isArray(parsed.questions)) {
        loadedDatabases.push(parsed);
      }
    } catch (err) {
      console.warn(`[Firebase] Falha ao reconstruir banco ${cleanSafeId}:`, err);
    }
  }

  return loadedDatabases;
}

export function mergeCloudDatabasesWithLocal(
  localDatabases: QuestionDatabase[],
  cloudDatabases: QuestionDatabase[]
): QuestionDatabase[] {
  if (!Array.isArray(cloudDatabases) || cloudDatabases.length === 0) {
    return localDatabases;
  }

  const merged = [...localDatabases];
  const byId = new Map<string, number>();
  const byNormalizedSignature = new Map<string, number>();

  merged.forEach((dbItem, index) => {
    byId.set(dbItem.id, index);
    const sig = `${(dbItem.name || '').trim().toLowerCase()}::${dbItem.questions?.length || 0}`;
    byNormalizedSignature.set(sig, index);
  });

  for (const cloudDb of cloudDatabases) {
    if (!cloudDb || !Array.isArray(cloudDb.questions) || cloudDb.questions.length === 0) continue;

    const existingIdxById = byId.get(cloudDb.id);
    if (existingIdxById !== undefined) {
      // Keep default_main questions intact if local already has it, but update custom DB if cloud has more questions or newer name
      const existing = merged[existingIdxById];
      if (!existing.is_default && cloudDb.questions.length >= existing.questions.length) {
        merged[existingIdxById] = cloudDb;
      }
      continue;
    }

    const sig = `${(cloudDb.name || '').trim().toLowerCase()}::${cloudDb.questions.length}`;
    if (byNormalizedSignature.has(sig)) {
      continue;
    }

    byId.set(cloudDb.id, merged.length);
    byNormalizedSignature.set(sig, merged.length);
    merged.push(cloudDb);
  }

  return merged;
}

// 8. Encrypted AI Keys Vault in Firestore (users/{userId}/sync/encrypted_keys)
export interface EncryptedKeysCloudPayload extends EncryptedVaultBlob {
  userId: string;
  lastSyncedAt: string;
}

export async function saveEncryptedKeysToFirestore(
  userId: string,
  vault: EncryptedVaultBlob
): Promise<{ lastSyncedAt: string }> {
  if (!userId) {
    throw new Error('Conecte sua Conta Google antes de salvar o cofre na nuvem.');
  }

  const docPath = `users/${userId}/sync/encrypted_keys`;
  const lastSyncedAt = new Date().toISOString();

  const payload: EncryptedKeysCloudPayload = {
    userId,
    lastSyncedAt,
    saltB64: vault.saltB64,
    ivB64: vault.ivB64,
    cipherB64: vault.cipherB64,
  };

  try {
    await setDoc(doc(db, 'users', userId, 'sync', 'encrypted_keys'), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docPath);
  }

  return { lastSyncedAt };
}

export async function loadEncryptedKeysFromFirestore(
  userId: string
): Promise<EncryptedKeysCloudPayload | null> {
  if (!userId) return null;

  const docPath = `users/${userId}/sync/encrypted_keys`;
  try {
    const snap = await getDoc(doc(db, 'users', userId, 'sync', 'encrypted_keys'));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (
      typeof data?.saltB64 === 'string' &&
      typeof data?.ivB64 === 'string' &&
      typeof data?.cipherB64 === 'string'
    ) {
      return {
        userId: String(data.userId || userId),
        lastSyncedAt: String(data.lastSyncedAt || ''),
        saltB64: data.saltB64,
        ivB64: data.ivB64,
        cipherB64: data.cipherB64,
      };
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, docPath);
  }
}
