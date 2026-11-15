import React, { useState, useEffect } from 'react';
import { 
  User, 
  X, 
  ShieldCheck, 
  Check, 
  Download, 
  Target, 
  HardDrive, 
  Flame, 
  Plus, 
  RefreshCw, 
  Trash2,
  Lock,
  AlertCircle,
  Loader2,
  ArrowLeftRight,
  Pencil
} from 'lucide-react';
import { UserAccount, UserStatistics, SRSItem, UserBookmark, QuestionDatabase } from '../types/question';
import { LocalStorageManager } from '../lib/storage';
import { checkStorageMetrics, requestPersistentStorage, StorageMetricsInfo } from '../lib/storageMetrics';
import { ConfirmModal } from './ConfirmModal';
import { HorizontalTabCarousel, HorizontalTabItem } from './ui/HorizontalTabCarousel';
import { hasAnyAIKey } from '../lib/aiOrchestrator';
import { 
  auth,
  signInWithGoogleReal,
  signOutReal,
  syncUserDataToFirestore,
  loadUserDataFromFirestore,
  syncDatabasesToFirestore,
  loadDatabasesFromFirestore,
  mergeCloudDatabasesWithLocal,
  loadEncryptedKeysFromFirestore,
  getFriendlyAuthErrorMessage
} from '../lib/firebase';

interface UserAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: UserAccount;
  onUpdateAccount: (updated: UserAccount) => void;
  stats: UserStatistics;
  onNavigateToMetrics?: () => void;
  onDatabasesUpdated?: (databases: QuestionDatabase[]) => void;
  onOpenBYOKModal?: () => void;
  onProfileChanged?: () => void;
}

const AVATAR_OPTIONS = ['🎯', '⚖️', '👮', '💼', '🩺', '📚', '🚀', '🦁', '🦉', '⚡'];

type UserAccountTabId = 'profile' | 'storage' | 'profiles';
const ACCOUNT_TAB_IDS: UserAccountTabId[] = ['profile', 'storage', 'profiles'];

export const UserAccountModal: React.FC<UserAccountModalProps> = ({
  isOpen,
  onClose,
  account,
  onUpdateAccount,
  stats,
  onNavigateToMetrics,
  onDatabasesUpdated,
  onOpenBYOKModal,
  onProfileChanged,
}) => {
  const [activeTab, setActiveTab] = useState<UserAccountTabId>('profile');
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [syncSuccessNotice, setSyncSuccessNotice] = useState<string | null>(null);

  // Storage telemetry
  const [storageInfo, setStorageInfo] = useState<StorageMetricsInfo | null>(null);
  const [isPersisting, setIsPersisting] = useState(false);
  const [persistSuccessMsg, setPersistSuccessMsg] = useState<string | null>(null);

  // Multi-profile & inline accordion edit state
  const [profiles, setProfiles] = useState<UserAccount[]>([]);
  const [newProfileName, setNewProfileName] = useState('');
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [profileToDelete, setProfileToDelete] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAvatar, setEditAvatar] = useState('🎯');
  const [editTargetExam, setEditTargetExam] = useState('');
  const [editTargetRole, setEditTargetRole] = useState('');
  const [editDailyGoalQuestions, setEditDailyGoalQuestions] = useState(30);
  const [editExperienceLevel, setEditExperienceLevel] = useState<UserAccount['experienceLevel']>('intermediario');
  const [editErrors, setEditErrors] = useState<{ name?: string; email?: string }>({});

  useEffect(() => {
    if (isOpen) {
      setProfiles(LocalStorageManager.getUserProfiles());
      setEditingProfileId(null);
      setEditErrors({});
      setAuthError(null);
      setSyncSuccessNotice(null);

      checkStorageMetrics().then((info) => {
        setStorageInfo(info);
      });
    }
  }, [isOpen, account]);

  if (!isOpen) return null;

  const populateEditFields = (target: UserAccount) => {
    setEditName(target.name);
    setEditEmail(target.email || '');
    setEditAvatar(target.avatar);
    setEditTargetExam(target.targetExam || '');
    setEditTargetRole(target.targetRole || '');
    setEditDailyGoalQuestions(target.dailyGoalQuestions);
    setEditExperienceLevel(target.experienceLevel);
    setEditErrors({});
  };

  const handleToggleEditAccordion = (prof: UserAccount) => {
    if (editingProfileId === prof.id) {
      setEditingProfileId(null);
      setEditErrors({});
    } else {
      populateEditFields(prof);
      setEditingProfileId(prof.id);
    }
  };

  const handleDiscardEdit = (prof: UserAccount) => {
    populateEditFields(prof);
    setEditingProfileId(null);
  };

  const handleSaveEditedAccount = (prof: UserAccount) => {
    const newErrors: { name?: string; email?: string } = {};
    const trimmedName = editName.trim();
    const trimmedEmail = editEmail.trim();

    if (!trimmedName) {
      newErrors.name = 'Por favor, informe seu nome ou identificação.';
    }

    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      newErrors.email = 'Por favor, insira um endereço de e-mail válido (ex: seu.email@exemplo.com).';
    }

    if (Object.keys(newErrors).length > 0) {
      setEditErrors(newErrors);
      return;
    }

    setEditErrors({});

    const updatedProfile: UserAccount = {
      ...prof,
      name: trimmedName || 'Estudante',
      email: trimmedEmail,
      avatar: editAvatar,
      targetExam: editTargetExam.trim(),
      targetRole: editTargetRole.trim(),
      dailyGoalQuestions: editDailyGoalQuestions,
      experienceLevel: editExperienceLevel,
    };

    const { savedAccount, profiles: updatedProfiles, isActiveProfile } =
      LocalStorageManager.updateUserProfile(updatedProfile);

    setProfiles(updatedProfiles);
    setEditingProfileId(null);

    if (isActiveProfile) {
      onUpdateAccount(savedAccount);

      // If cloud sync is active on this active account, update Firestore
      if (savedAccount.provider === 'google' && auth.currentUser) {
        syncUserDataToFirestore(auth.currentUser, savedAccount, {
          stats: LocalStorageManager.getStatistics(),
          srsItems: LocalStorageManager.getSRSItems(),
          answers: LocalStorageManager.getAnswers(),
          bookmarks: LocalStorageManager.getBookmarks(),
        }).catch((err) => {
          console.warn('Silent Firestore sync error on save profile:', err);
        });
      }
    }
  };

  const handleGoogleConnect = async () => {
    setIsGoogleLoading(true);
    setAuthError(null);
    setSyncSuccessNotice(null);

    try {
      const user = await signInWithGoogleReal();

      // Real identity returned by Google Authentication
      const googleName = user.displayName || account.name || 'Estudante';
      const googleEmail = user.email || '';
      const googleAvatar = user.photoURL || account.avatar || '🎯';

      // Verify if existing cloud data is stored in Firestore for this user
      let cloudData = null;
      try {
        cloudData = await loadUserDataFromFirestore(user.uid);
      } catch (loadErr) {
        console.warn('Could not read existing cloud data from Firestore:', loadErr);
      }

      // Merge and prepare real user account
      const updated: UserAccount = {
        ...account,
        id: user.uid,
        name: cloudData?.account?.name || googleName,
        email: googleEmail,
        avatar: cloudData?.account?.avatar || googleAvatar,
        targetExam: cloudData?.account?.targetExam || account.targetExam,
        targetRole: cloudData?.account?.targetRole || account.targetRole,
        dailyGoalQuestions: cloudData?.account?.dailyGoalQuestions || account.dailyGoalQuestions,
        experienceLevel: (cloudData?.account?.experienceLevel as any) || account.experienceLevel,
        provider: 'google',
        isCloudSyncEnabled: true,
        lastLoginAt: new Date().toISOString(),
      };

      // Preserve local profile progress when upgrading a local profile to Google
      if (account.provider !== 'google' && account.id !== user.uid) {
        LocalStorageManager.copyProfileProgressIfEmpty(account.id, user.uid);
      }

      // Save active Google account first so subsequent writes target user.uid's scoped keys
      const saved = LocalStorageManager.saveUserAccount(updated);

      // If cloud progress exists (e.g. from previous device), restore stats & study progress
      if (cloudData) {
        if (cloudData.stats) {
          LocalStorageManager.saveStatistics(cloudData.stats as UserStatistics);
        }
        if (cloudData.srsItems) {
          for (const item of Object.values(cloudData.srsItems)) {
            if (item && typeof item === 'object') {
              LocalStorageManager.saveSRSItem(item as SRSItem);
            }
          }
        }
        if (cloudData.bookmarks) {
          for (const bm of Object.values(cloudData.bookmarks)) {
            if (bm && typeof bm === 'object' && 'question_id' in bm) {
              const bookmark = bm as UserBookmark;
              LocalStorageManager.updateBookmarkNote(bookmark.question_id, bookmark.note || '');
            }
          }
        }
      }

      onUpdateAccount(saved);
      setProfiles(LocalStorageManager.getUserProfiles());
      onProfileChanged?.();

      // Perform immediate real synchronization of profile & progress to Firestore
      const syncResult = await syncUserDataToFirestore(user, saved, {
        stats: LocalStorageManager.getStatistics(),
        srsItems: LocalStorageManager.getSRSItems(),
        answers: LocalStorageManager.getAnswers(),
        bookmarks: LocalStorageManager.getBookmarks(),
      });

      // Load, merge, and sync Question Databases with Firestore
      try {
        const cloudDbs = await loadDatabasesFromFirestore(user.uid);
        const localDbs = LocalStorageManager.getDatabases();
        const mergedDbs = mergeCloudDatabasesWithLocal(localDbs, cloudDbs);
        LocalStorageManager.saveDatabases(mergedDbs);
        if (onDatabasesUpdated) {
          onDatabasesUpdated(mergedDbs);
        }
        await syncDatabasesToFirestore(user.uid, mergedDbs);
      } catch (dbSyncErr) {
        console.warn('Could not sync question databases on Google connect:', dbSyncErr);
      }

      // If no local AI keys exist, check if user has an encrypted vault in Firestore
      if (!hasAnyAIKey() && onOpenBYOKModal) {
        try {
          const vault = await loadEncryptedKeysFromFirestore(user.uid);
          if (vault) {
            onClose();
            onOpenBYOKModal();
            return;
          }
        } catch {
          // Ignore vault check error
        }
      }

      const syncTime = new Date(syncResult.lastSyncedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      setSyncSuccessNotice(`Conta Google conectada com sucesso! Bancos e progresso sincronizados às ${syncTime}.`);
      setTimeout(() => setSyncSuccessNotice(null), 4000);
    } catch (err: unknown) {
      console.error('Google Sign-In Error:', err);
      const friendlyMsg = getFriendlyAuthErrorMessage(err);
      setAuthError(friendlyMsg);
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleGoogleDisconnect = async () => {
    setIsGoogleLoading(true);
    setAuthError(null);
    setSyncSuccessNotice(null);

    try {
      // Real signOut from Firebase Auth
      await signOutReal();

      const updated: UserAccount = {
        ...account,
        provider: 'local',
        isCloudSyncEnabled: false,
      };
      const saved = LocalStorageManager.saveUserAccount(updated);
      onUpdateAccount(saved);
      setProfiles(LocalStorageManager.getUserProfiles());
      setSyncSuccessNotice('Sessão do Google encerrada com sucesso. Seus dados continuam salvos localmente neste dispositivo.');
      setTimeout(() => setSyncSuccessNotice(null), 4000);
    } catch (err: unknown) {
      console.error('Sign-Out Error:', err);
      setAuthError('Falha ao desconectar da Conta Google. Tente novamente.');
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleManualSync = async () => {
    if (!auth.currentUser || account.provider !== 'google') return;
    setIsSyncingCloud(true);
    setAuthError(null);

    try {
      const syncResult = await syncUserDataToFirestore(auth.currentUser, account, {
        stats: LocalStorageManager.getStatistics(),
        srsItems: LocalStorageManager.getSRSItems(),
        answers: LocalStorageManager.getAnswers(),
        bookmarks: LocalStorageManager.getBookmarks(),
      });

      const cloudDbs = await loadDatabasesFromFirestore(auth.currentUser.uid);
      const localDbs = LocalStorageManager.getDatabases();
      const mergedDbs = mergeCloudDatabasesWithLocal(localDbs, cloudDbs);
      LocalStorageManager.saveDatabases(mergedDbs);
      if (onDatabasesUpdated) {
        onDatabasesUpdated(mergedDbs);
      }
      await syncDatabasesToFirestore(auth.currentUser.uid, mergedDbs);

      const syncTime = new Date(syncResult.lastSyncedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      setSyncSuccessNotice(`Sincronização de progresso e bancos (${mergedDbs.length}) concluída às ${syncTime}!`);
      setTimeout(() => setSyncSuccessNotice(null), 4000);
    } catch (err: unknown) {
      console.error('Manual Cloud Sync Error:', err);
      setAuthError('Falha na sincronização com a nuvem. Verifique sua conexão com a internet.');
    } finally {
      setIsSyncingCloud(false);
    }
  };

  const handleRequestPersistence = async () => {
    setIsPersisting(true);
    const granted = await requestPersistentStorage();
    setIsPersisting(false);
    if (granted) {
      setPersistSuccessMsg('Armazenamento blindado com sucesso! Seus dados não serão removidos pelo navegador.');
      const info = await checkStorageMetrics();
      setStorageInfo(info);
    } else {
      setPersistSuccessMsg('O navegador manteve o modo padrão de armazenamento sob demanda.');
    }
    setTimeout(() => setPersistSuccessMsg(null), 4000);
  };

  const handleCreateNewProfile = () => {
    if (!newProfileName.trim()) return;
    const newAccount: UserAccount = {
      id: `profile_${Date.now()}`,
      name: newProfileName.trim(),
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
    const saved = LocalStorageManager.saveUserAccount(newAccount);
    onUpdateAccount(saved);
    setProfiles(LocalStorageManager.getUserProfiles());
    setNewProfileName('');
    setIsCreatingProfile(false);
    setEditingProfileId(null);
    setEditErrors({});
    onProfileChanged?.();
  };

  const handleSwitchProfile = (profileId: string) => {
    const switched = LocalStorageManager.switchUserProfile(profileId);
    onUpdateAccount(switched);
    setEditingProfileId(null);
    setEditErrors({});
    onProfileChanged?.();
  };

  const handleDeleteProfile = (profileId: string) => {
    if (profiles.length <= 1) return;
    setProfileToDelete(profileId);
  };

  const confirmDeleteProfile = () => {
    if (!profileToDelete) return;
    const remaining = LocalStorageManager.deleteUserProfile(profileToDelete);
    setProfiles(remaining);
    if (editingProfileId === profileToDelete) {
      setEditingProfileId(null);
      setEditErrors({});
    }
    const current = LocalStorageManager.getUserAccount();
    onUpdateAccount(current);
    if (current.id !== account.id) {
      onProfileChanged?.();
    }
    setProfileToDelete(null);
  };

  const handleExportAccountData = (targetAccount: UserAccount) => {
    const profileStats = LocalStorageManager.getStatistics(targetAccount.id);
    const backupObj = {
      version: '2.0',
      account: targetAccount,
      statistics: profileStats,
      exportedAt: new Date().toISOString(),
      platform: 'Silenon',
    };
    const blob = new Blob([JSON.stringify(backupObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `perfil_estudo_${targetAccount.name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-canvas/80 backdrop-blur-xs">
      <div 
        className="w-full max-w-2xl max-h-[90vh] max-h-[90dvh] flex flex-col rounded-2xl border border-border shadow-2xl overflow-hidden bg-surface theme-surface"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl bg-accent-subtle border border-accent/30 shrink-0 overflow-hidden">
              {account.avatar?.startsWith('http') ? (
                <img 
                  src={account.avatar} 
                  alt={account.name} 
                  className="w-full h-full object-cover rounded-xl avatar-icon" 
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="avatar-icon emoji-filter" data-emoji="true">{account.avatar}</span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-primary theme-text-primary">
                  {account.name}
                </h2>
                {account.provider === 'google' ? (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-success-bg text-success border border-success-border flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" />
                    <span>Conta Google</span>
                  </span>
                ) : (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface-subtle text-muted border border-border">
                    Perfil Local
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-primary transition-colors cursor-pointer"
            title="Fechar (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation & Horizontal Swipe Carousel */}
        <HorizontalTabCarousel<UserAccountTabId>
          activeIndex={Math.max(0, ACCOUNT_TAB_IDS.indexOf(activeTab))}
          onChange={(idx) => setActiveTab(ACCOUNT_TAB_IDS[idx] ?? 'profile')}
          indicatorVariant="underline"
          enableContentSwipe={true}
          autoHeight={true}
          measureDeps={[
            isOpen,
            profiles.length,
            editingProfileId,
            isCreatingProfile,
            storageInfo,
            authError,
            syncSuccessNotice,
            persistSuccessMsg,
          ]}
          className="flex-1 min-h-0"
          slideClassName="p-5"
          ariaLabel="Seções da conta"
          tabs={[
            {
              id: 'profile',
              label: 'Perfil e Metas',
              icon: <User className="w-3.5 h-3.5 shrink-0" />,
              content: (
            <div className="space-y-4">
              {/* Account Quick Stats Bar (Clickable navigation to Metrics) */}
              <button
                type="button"
                id="btn-account-stats-to-metrics"
                onClick={() => {
                  if (onNavigateToMetrics) {
                    onClose();
                    onNavigateToMetrics();
                  }
                }}
                className="w-full grid grid-cols-4 gap-2 p-3 rounded-xl border border-border theme-card-subtle text-center hover:border-accent transition-all cursor-pointer group"
                title="Clique para abrir o painel de Métricas e Estatísticas"
              >
                <div>
                  <div className="text-[10px] text-muted uppercase font-semibold group-hover:text-primary transition-colors">Resolvidas</div>
                  <div className="text-base font-bold text-primary theme-text-primary">
                    {stats.total_answered}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted uppercase font-semibold group-hover:text-success transition-colors">Acertos</div>
                  <div className="text-base font-bold text-success">
                    {stats.total_correct}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted uppercase font-semibold group-hover:text-warning transition-colors">Ofensiva</div>
                  <div className="text-base font-bold text-warning flex items-center justify-center gap-0.5">
                    <Flame className="w-3.5 h-3.5 fill-warning text-warning" />
                    <span>{stats.streak_days}d</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted uppercase font-semibold group-hover:text-accent transition-colors">XP Total</div>
                  <div className="text-base font-bold text-accent">
                    {stats.xp_points}
                  </div>
                </div>
              </button>

              {/* Google Account Connection Banner */}
              <div className="space-y-2.5">
                {account.provider === 'google' ? (
                  <div className="p-4 rounded-xl border border-border theme-card">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-surface-subtle border border-border flex items-center justify-center text-sm font-bold text-secondary shrink-0">
                          {isGoogleLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin text-accent" />
                          ) : (
                            <span>G</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-primary theme-text-primary">
                              Conta Google Conectada
                            </span>
                            <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-success-bg text-success border border-success-border flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3" />
                              <span>Sincronia Ativa</span>
                            </span>
                          </div>
                          <div className="text-[11px] text-muted theme-text-muted truncate">
                            {`${account.email || 'Autenticado'} • Progresso e provas salvos na nuvem`}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={handleManualSync}
                          disabled={isSyncingCloud || isGoogleLoading}
                          className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface-subtle hover:bg-surface-hover text-secondary transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                          title="Sincronizar progresso com a nuvem agora"
                        >
                          <RefreshCw className={`w-3 h-3 ${isSyncingCloud ? 'animate-spin text-accent' : ''}`} />
                          <span>{isSyncingCloud ? 'Sincronizando...' : 'Sincronizar'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleGoogleDisconnect}
                          disabled={isGoogleLoading}
                          className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-border text-secondary hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {isGoogleLoading ? 'Aguarde...' : 'Desconectar'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleGoogleConnect}
                    disabled={isGoogleLoading}
                    className="w-full p-4 rounded-xl border border-border theme-card hover:bg-surface-hover transition-colors cursor-pointer flex items-center justify-between gap-3 text-left disabled:opacity-50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-surface-subtle border border-border flex items-center justify-center text-sm font-bold text-accent shrink-0">
                        {isGoogleLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin text-accent" />
                        ) : (
                          <span>G</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-primary theme-text-primary">
                          {isGoogleLoading ? 'Conectando...' : 'Entrar com Google'}
                        </div>
                        <div className="text-[11px] text-muted theme-text-muted truncate">
                          Entre para sincronizar entre dispositivos
                        </div>
                      </div>
                    </div>

                    <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-surface-subtle text-muted border border-border shrink-0">
                      Backup na Nuvem
                    </span>
                  </button>
                )}

                {/* Error Banner */}
                {authError && (
                  <div className="p-3 rounded-lg border border-danger/40 bg-danger/10 text-xs text-danger flex items-start gap-2 animate-in fade-in">
                    <AlertCircle className="w-4 h-4 shrink-0 text-danger mt-0.5" />
                    <div className="space-y-0.5">
                      <span className="font-semibold block">Falha na Autenticação</span>
                      <span>{authError}</span>
                    </div>
                  </div>
                )}

                {/* Success Banner */}
                {syncSuccessNotice && (
                  <div className="p-3 rounded-lg border border-accent/40 bg-accent-subtle text-xs text-accent flex items-start gap-2 animate-in fade-in">
                    <Check className="w-4 h-4 shrink-0 text-accent mt-0.5" />
                    <span>{syncSuccessNotice}</span>
                  </div>
                )}
              </div>
            </div>
              ),
            },
            {
              id: 'storage',
              label: 'Armazenamento e Limites',
              icon: <HardDrive className="w-3.5 h-3.5 shrink-0" />,
              content: (
            <div className="space-y-4">
              {/* Storage Telemetry Meter */}
              <div className="p-4 rounded-xl border border-border theme-card space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-accent" />
                    <span className="text-xs font-bold text-primary theme-text-primary">
                      Uso de Armazenamento
                    </span>
                  </div>
                  <span className="text-xs font-mono font-semibold text-secondary theme-text-secondary">
                    {storageInfo ? `${storageInfo.usageFormatted} / ${storageInfo.quotaFormatted}` : 'Calculando...'}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full h-2 rounded-full bg-surface-subtle border border-border overflow-hidden">
                  <div 
                    className="h-full bg-accent rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(1, storageInfo?.percentUsed || 0)}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-muted theme-text-muted">
                  <span>Provas, respostas e revisões salvas no aparelho</span>
                  <span>{storageInfo?.percentUsed ?? 0}% utilizado</span>
                </div>
              </div>

              {/* Persistence Lock Status */}
              <div className="p-4 rounded-xl border border-border theme-card space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-bold text-primary theme-text-primary">
                      <Lock className="w-3.5 h-3.5 text-warning" />
                      <span>Progresso protegido no aparelho</span>
                    </div>
                    <p className="text-xs text-muted theme-text-muted mt-0.5 leading-relaxed">
                      Seus dados estão protegidos contra limpeza automática do navegador.
                    </p>
                  </div>
                  {!storageInfo?.isPersisted && (
                    <button
                      type="button"
                      onClick={handleRequestPersistence}
                      disabled={isPersisting}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-warning hover:opacity-90 text-warning-contrast shrink-0 transition-colors cursor-pointer shadow-xs"
                    >
                      {isPersisting ? 'Protegendo...' : 'Proteger Dados'}
                    </button>
                  )}
                </div>
                {persistSuccessMsg && (
                  <div className="text-xs font-semibold text-success flex items-center gap-1 pt-1">
                    <Check className="w-3.5 h-3.5" />
                    <span>{persistSuccessMsg}</span>
                  </div>
                )}
              </div>
            </div>
              ),
            },
            {
              id: 'profiles',
              label: `Contas (${profiles.length})`,
              icon: <Target className="w-3.5 h-3.5 shrink-0" />,
              content: (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-primary theme-text-primary">
                    Gerenciar Contas
                  </h3>
                  <p className="text-xs text-muted theme-text-muted">
                    Crie múltiplas contas para organizar seus estudos por matérias, simulados ou metas.
                  </p>
                </div>
                {!isCreatingProfile && (
                  <button
                    type="button"
                    onClick={() => setIsCreatingProfile(true)}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-lg theme-btn-accent transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Novo Perfil</span>
                  </button>
                )}
              </div>

              {isCreatingProfile && (
                <div className="p-3 rounded-xl border border-accent/30 bg-accent-subtle space-y-2">
                  <label className="block text-xs font-semibold text-accent">
                    Nome do Novo Perfil
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newProfileName}
                      onChange={(e) => setNewProfileName(e.target.value)}
                      placeholder="Ex: Foco ENEM, Matemática, Revisão Final"
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg theme-input focus:outline-hidden focus:border-accent"
                    />
                    <button
                      type="button"
                      onClick={handleCreateNewProfile}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg theme-btn-accent transition-colors cursor-pointer"
                    >
                      Criar
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCreatingProfile(false)}
                      className="px-2.5 py-1.5 text-xs rounded-lg border border-border bg-surface hover:bg-surface-hover text-secondary transition-colors cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {/* Profiles List */}
              <div className="space-y-2">
                {profiles.map((prof) => {
                  const isActive = prof.id === account.id;
                  const isEditing = editingProfileId === prof.id;
                  return (
                    <div
                      key={prof.id}
                      className={`p-3 rounded-xl border transition-all ${
                        isActive
                          ? 'border-accent bg-accent-subtle shadow-xs'
                          : 'theme-card hover:border-accent'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg bg-surface-subtle border border-border shrink-0 overflow-hidden">
                            {prof.avatar?.startsWith('http') ? (
                              <img 
                                src={prof.avatar} 
                                alt={prof.name} 
                                className="w-full h-full object-cover rounded-lg avatar-icon" 
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <span className="avatar-icon emoji-filter" data-emoji="true">{prof.avatar}</span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-primary theme-text-primary truncate">
                                {prof.name}
                              </span>
                              {isActive && (
                                <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-accent text-accent-contrast shrink-0">
                                  Ativo
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-muted theme-text-muted block truncate">
                              {prof.targetExam ? `${prof.targetExam} • ` : ''}Meta: {prof.dailyGoalQuestions}q/dia
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {!isActive && (
                            <button
                              type="button"
                              onClick={() => handleSwitchProfile(prof.id)}
                              className="p-1.5 rounded-lg theme-text-muted text-secondary hover:text-primary hover:bg-surface-hover transition-colors cursor-pointer"
                              title="Alternar conta"
                              aria-label="Alternar conta"
                            >
                              <ArrowLeftRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleExportAccountData(prof)}
                            className="p-1.5 rounded-lg theme-text-muted text-secondary hover:text-primary hover:bg-surface-hover transition-colors cursor-pointer"
                            title="Baixar backup da conta"
                            aria-label="Baixar backup da conta"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleEditAccordion(prof)}
                            className={`p-1.5 rounded-lg theme-text-muted text-secondary hover:text-primary hover:bg-surface-hover transition-colors cursor-pointer ${
                              isEditing ? 'bg-surface-hover text-primary' : ''
                            }`}
                            title={isEditing ? 'Fechar edição' : 'Editar conta'}
                            aria-label={isEditing ? 'Fechar edição' : 'Editar conta'}
                            aria-expanded={isEditing}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {profiles.length > 1 && !isActive && (
                            <button
                              type="button"
                              onClick={() => handleDeleteProfile(prof.id)}
                              className="p-1.5 rounded-lg theme-text-muted text-secondary hover:text-primary hover:bg-surface-hover transition-colors cursor-pointer"
                              title="Excluir conta"
                              aria-label="Excluir conta"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {isEditing && (
                        <div className="mt-3 pt-3 border-t border-border space-y-4 animate-in fade-in duration-150">
                          {/* Avatar Selector */}
                          <div>
                            <label className="block text-xs font-semibold text-secondary theme-text-secondary mb-1.5">
                              Avatar da conta
                            </label>
                            <div className="flex flex-wrap gap-2">
                              {AVATAR_OPTIONS.map((icon) => (
                                <button
                                  key={icon}
                                  type="button"
                                  onClick={() => setEditAvatar(icon)}
                                  className={`w-9 h-9 rounded-xl text-lg flex items-center justify-center border transition-all cursor-pointer ${
                                    editAvatar === icon
                                      ? 'border-accent bg-accent-subtle scale-110 shadow-xs'
                                      : 'border-border hover:border-accent theme-card'
                                  }`}
                                >
                                  <span className="avatar-icon emoji-filter" data-emoji="true">{icon}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Profile Inputs */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-secondary theme-text-secondary mb-1">
                                Nome / Apelido *
                              </label>
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => {
                                  setEditName(e.target.value);
                                  if (editErrors.name) {
                                    setEditErrors(prev => ({ ...prev, name: undefined }));
                                  }
                                }}
                                placeholder="Seu nome ou identificação"
                                className={`w-full px-3 py-2 text-sm rounded-lg theme-input focus:outline-hidden ${
                                  editErrors.name ? 'border-danger focus:border-danger' : 'focus:border-accent'
                                }`}
                              />
                              {editErrors.name && (
                                <div className="mt-1.5 text-xs text-danger flex items-center gap-1.5" role="alert">
                                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-danger" />
                                  <span>{editErrors.name}</span>
                                </div>
                              )}
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-secondary theme-text-secondary mb-1">
                                E-mail
                              </label>
                              <input
                                type="text"
                                value={editEmail}
                                onChange={(e) => {
                                  setEditEmail(e.target.value);
                                  if (editErrors.email) {
                                    setEditErrors(prev => ({ ...prev, email: undefined }));
                                  }
                                }}
                                placeholder="seu.email@exemplo.com"
                                className={`w-full px-3 py-2 text-sm rounded-lg theme-input focus:outline-hidden ${
                                  editErrors.email ? 'border-danger focus:border-danger' : 'focus:border-accent'
                                }`}
                              />
                              {editErrors.email && (
                                <div className="mt-1.5 text-xs text-danger flex items-center gap-1.5" role="alert">
                                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-danger" />
                                  <span>{editErrors.email}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Target Exam & Role */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-secondary theme-text-secondary mb-1">
                                Área / Foco de Estudo
                              </label>
                              <input
                                type="text"
                                value={editTargetExam}
                                onChange={(e) => setEditTargetExam(e.target.value)}
                                placeholder="Ex: ENEM / Medicina"
                                className="w-full px-3 py-2 text-sm rounded-lg theme-input focus:outline-hidden focus:border-accent"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-secondary theme-text-secondary mb-1">
                                Meta de Conhecimento / Módulo
                              </label>
                              <input
                                type="text"
                                value={editTargetRole}
                                onChange={(e) => setEditTargetRole(e.target.value)}
                                placeholder="Ex: Ciências da Natureza e Matemática"
                                className="w-full px-3 py-2 text-sm rounded-lg theme-input focus:outline-hidden focus:border-accent"
                              />
                            </div>
                          </div>

                          {/* Daily Goal & Level */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-secondary theme-text-secondary mb-1">
                                Meta Diária de Questões
                              </label>
                              <select
                                value={editDailyGoalQuestions}
                                onChange={(e) => setEditDailyGoalQuestions(Number(e.target.value))}
                                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface text-primary focus:outline-hidden focus:border-accent cursor-pointer"
                              >
                                <option value={15}>15 questões / dia (Ritmo Leve)</option>
                                <option value={30}>30 questões / dia (Ritmo Constante)</option>
                                <option value={50}>50 questões / dia (Foco Intenso)</option>
                                <option value={80}>80 questões / dia (Aprofundamento)</option>
                                <option value={100}>100+ questões / dia (Modo Imersivo)</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-secondary theme-text-secondary mb-1">
                                Nível de Experiência
                              </label>
                              <select
                                value={editExperienceLevel}
                                onChange={(e) => setEditExperienceLevel(e.target.value as UserAccount['experienceLevel'])}
                                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface text-primary focus:outline-hidden focus:border-accent cursor-pointer"
                              >
                                <option value="iniciante">Iniciante (Primeiros passos)</option>
                                <option value="intermediario">Intermediário (Base consolidada)</option>
                                <option value="avancado">Avançado (Alto índice de acertos)</option>
                                <option value="faixa_preta">Domínio Pleno / Especialista</option>
                              </select>
                            </div>
                          </div>

                          {/* Accordion Footer */}
                          <div className="flex items-center justify-between pt-1">
                            <button
                              type="button"
                              onClick={() => handleDiscardEdit(prof)}
                              className="px-3 py-2 text-xs font-medium rounded-lg theme-btn-secondary transition-colors cursor-pointer"
                            >
                              Descartar alterações
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveEditedAccount(prof)}
                              className="px-4 py-2 text-xs font-semibold rounded-lg theme-btn-accent transition-colors cursor-pointer shadow-xs"
                            >
                              Salvar Alterações
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
              ),
            },
          ] satisfies HorizontalTabItem<UserAccountTabId>[]}
        />
      </div>

      <ConfirmModal
        isOpen={!!profileToDelete}
        title="Excluir Perfil de Estudos"
        message="Tem certeza que deseja excluir este perfil de estudos? Os dados locais deste perfil serão removidos permanentemente."
        confirmLabel="Excluir Perfil"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={confirmDeleteProfile}
        onCancel={() => setProfileToDelete(null)}
      />
    </div>
  );
};
