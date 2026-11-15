import { useState, useEffect, useRef } from 'react';
import { 
  UserAccount, 
  UserStatistics, 
  SRSItem, 
  UserAnswerRecord, 
  UserBookmark,
  QuestionDatabase
} from '../types/question';
import { LocalStorageManager } from '../lib/storage';
import { hasAnyAIKey } from '../lib/aiOrchestrator';
import { 
  auth, 
  onAuthStateChanged, 
  syncUserDataToFirestore,
  syncDatabasesToFirestore,
  loadDatabasesFromFirestore,
  mergeCloudDatabasesWithLocal,
  loadEncryptedKeysFromFirestore
} from '../lib/firebase';

interface SyncDataPayload {
  stats: UserStatistics;
  srsItems: Record<number, SRSItem>;
  answers: Record<number, UserAnswerRecord[]>;
  bookmarks: Record<number, UserBookmark>;
  databases?: QuestionDatabase[];
  onDatabasesRestored?: (databases: QuestionDatabase[]) => void;
  onEncryptedVaultDetected?: () => void;
}

export function useUserAccount(syncData?: SyncDataPayload) {
  const [userAccount, setUserAccount] = useState<UserAccount>(() => {
    return LocalStorageManager.getUserAccount();
  });

  const hydratedUidRef = useRef<string | null>(null);
  const callbacksRef = useRef<{
    onDatabasesRestored?: (databases: QuestionDatabase[]) => void;
    onEncryptedVaultDetected?: () => void;
  }>({});

  callbacksRef.current = {
    onDatabasesRestored: syncData?.onDatabasesRestored,
    onEncryptedVaultDetected: syncData?.onEncryptedVaultDetected,
  };

  // Firebase Auth state listener + initial cloud hydration for databases & encrypted keys vault
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUserAccount((prev) => {
          if (prev.provider !== 'google' || prev.id !== firebaseUser.uid || prev.email !== firebaseUser.email) {
            const updated: UserAccount = {
              ...prev,
              id: firebaseUser.uid,
              name: prev.name || firebaseUser.displayName || 'Estudante',
              email: firebaseUser.email || prev.email || '',
              avatar: prev.avatar || firebaseUser.photoURL || '🎯',
              provider: 'google',
              isCloudSyncEnabled: true,
              lastLoginAt: new Date().toISOString(),
            };
            LocalStorageManager.saveUserAccount(updated);
            return updated;
          }
          return prev;
        });

        if (hydratedUidRef.current !== firebaseUser.uid) {
          hydratedUidRef.current = firebaseUser.uid;

          // 1. Load & merge question banks from Firestore
          try {
            const cloudDbs = await loadDatabasesFromFirestore(firebaseUser.uid);
            if (cloudDbs.length > 0) {
              const localDbs = LocalStorageManager.getDatabases();
              const merged = mergeCloudDatabasesWithLocal(localDbs, cloudDbs);
              LocalStorageManager.saveDatabases(merged);
              callbacksRef.current.onDatabasesRestored?.(merged);
            }
          } catch (err) {
            console.warn('Could not load question databases from Firestore:', err);
          }

          // 2. If device has no local AI keys, check if an encrypted key vault exists in Firestore
          if (!hasAnyAIKey()) {
            try {
              const vault = await loadEncryptedKeysFromFirestore(firebaseUser.uid);
              if (vault) {
                callbacksRef.current.onEncryptedVaultDetected?.();
              }
            } catch (err) {
              console.warn('Could not check encrypted AI keys vault in Firestore:', err);
            }
          }
        }
      } else {
        hydratedUidRef.current = null;
      }
    });
    return () => unsubscribe();
  }, []);

  // Background debounce sync of study progress to Firestore when user is authenticated with Google
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!syncData) return;
    const { stats, srsItems, answers, bookmarks } = syncData;

    if (auth.currentUser && userAccount.provider === 'google' && userAccount.isCloudSyncEnabled) {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(() => {
        if (auth.currentUser) {
          syncUserDataToFirestore(auth.currentUser, userAccount, {
            stats,
            srsItems,
            answers,
            bookmarks,
          }).catch((err) => {
            console.warn('Background Firestore sync error:', err);
          });
        }
      }, 3000);
    }
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, [
    userAccount, 
    syncData?.stats, 
    syncData?.srsItems, 
    syncData?.answers, 
    syncData?.bookmarks
  ]);

  // Background debounce sync of question databases to Firestore when databases change
  const dbSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    const databases = syncData?.databases;
    if (!databases || databases.length === 0) return;

    if (auth.currentUser && userAccount.provider === 'google' && userAccount.isCloudSyncEnabled) {
      if (dbSyncTimeoutRef.current) clearTimeout(dbSyncTimeoutRef.current);
      dbSyncTimeoutRef.current = setTimeout(() => {
        if (auth.currentUser) {
          syncDatabasesToFirestore(auth.currentUser.uid, databases).catch((err) => {
            console.warn('Background Firestore databases sync error:', err);
          });
        }
      }, 2500);
    }
    return () => {
      if (dbSyncTimeoutRef.current) clearTimeout(dbSyncTimeoutRef.current);
    };
  }, [userAccount, syncData?.databases]);

  return {
    userAccount,
    setUserAccount,
  };
}
