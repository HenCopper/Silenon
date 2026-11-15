import { Question, UserAnswerRecord } from '../types/question';
import { CURATED_LOADING_TIPS, DEFAULT_FALLBACK_LOADING_TIP } from '../data/loadingTips';
import { generateMicroTipsBatch, getAIKeys } from './aiOrchestrator';

export const NEXT_LOADING_TIP_KEY = 'silenon_next_loading_tip';
const STOCK_KEY_PREFIX = 'silenon_loading_tips_stock_v1_';
const META_KEY_PREFIX = 'silenon_loading_tips_meta_v1_';

const MAX_VIEWS_PER_TIP = 3;
const REPLENISH_UNSEEN_THRESHOLD = 8;
const REPLENISH_BATCH_SIZE = 8;
const MAX_AI_STOCK_SIZE = 72;
const REPLENISH_COOLDOWN_MS = 45_000;

export type LoadingTipSource = 'curated' | 'ai';

export interface LoadingTipItem {
  id: string;
  text: string;
  tags: string[];
  source: LoadingTipSource;
  views: number;
}

interface NextLoadingTipPayload {
  id: string;
  text: string;
  profileId: string;
}

interface ReplenishMeta {
  lastAttemptAt: number;
  lastErrorSignature: string;
}

const sessionConsumedTipByProfile = new Set<string>();
const inFlightReplenishByProfile = new Set<string>();

function normalizeTag(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTipTextForDedup(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getStockStorageKey(profileId: string): string {
  return `${STOCK_KEY_PREFIX}${profileId || 'user_main'}`;
}

function getMetaStorageKey(profileId: string): string {
  return `${META_KEY_PREFIX}${profileId || 'user_main'}`;
}

function readMeta(profileId: string): ReplenishMeta {
  try {
    const raw = localStorage.getItem(getMetaStorageKey(profileId));
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        lastAttemptAt: typeof parsed?.lastAttemptAt === 'number' ? parsed.lastAttemptAt : 0,
        lastErrorSignature: typeof parsed?.lastErrorSignature === 'string' ? parsed.lastErrorSignature : '',
      };
    }
  } catch {
    // ignore
  }
  return { lastAttemptAt: 0, lastErrorSignature: '' };
}

function writeMeta(profileId: string, meta: ReplenishMeta): void {
  try {
    localStorage.setItem(getMetaStorageKey(profileId), JSON.stringify(meta));
  } catch {
    // ignore
  }
}

export function getLoadingTipsStock(profileId: string): LoadingTipItem[] {
  const key = getStockStorageKey(profileId);
  let stored: LoadingTipItem[] = [];
  let hadValidArray = false;

  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        hadValidArray = true;
        stored = parsed
          .filter(
            (item) =>
              item &&
              typeof item.id === 'string' &&
              typeof item.text === 'string' &&
              item.text.trim().length > 0
          )
          .map((item) => ({
            id: item.id,
            text: item.text.trim(),
            tags: Array.isArray(item.tags)
              ? item.tags.map((t: unknown) => String(t || '').trim()).filter(Boolean)
              : [],
            source: item.source === 'ai' ? 'ai' : 'curated',
            views: typeof item.views === 'number' && Number.isFinite(item.views) && item.views >= 0 ? item.views : 0,
          }));
      }
    }
  } catch {
    stored = [];
  }

  const existingIds = new Set(stored.map((item) => item.id));
  let mutated = !hadValidArray;

  for (const curated of CURATED_LOADING_TIPS) {
    if (!existingIds.has(curated.id)) {
      stored.push({
        id: curated.id,
        text: curated.text,
        tags: [...curated.tags],
        source: 'curated',
        views: 0,
      });
      mutated = true;
    }
  }

  if (mutated) {
    saveLoadingTipsStock(profileId, stored);
  }

  return stored;
}

export function saveLoadingTipsStock(profileId: string, stock: LoadingTipItem[]): void {
  try {
    localStorage.setItem(getStockStorageKey(profileId), JSON.stringify(stock));
  } catch (err) {
    console.warn('[LoadingTips] Failed to save tip stock:', err);
  }
}

export function clearProfileLoadingTips(profileId: string): void {
  try {
    localStorage.removeItem(getStockStorageKey(profileId));
    localStorage.removeItem(getMetaStorageKey(profileId));
    const rawNext = localStorage.getItem(NEXT_LOADING_TIP_KEY);
    if (rawNext) {
      const parsed = JSON.parse(rawNext);
      if (parsed?.profileId === profileId) {
        localStorage.removeItem(NEXT_LOADING_TIP_KEY);
      }
    }
  } catch {
    // ignore
  }
}

function readNextLoadingTipPayload(): NextLoadingTipPayload | null {
  try {
    const raw = localStorage.getItem(NEXT_LOADING_TIP_KEY);
    if (!raw) return null;
    if (raw.trim().startsWith('{')) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.text === 'string' && parsed.text.trim()) {
        return {
          id: typeof parsed.id === 'string' ? parsed.id : '',
          text: parsed.text.trim(),
          profileId: typeof parsed.profileId === 'string' ? parsed.profileId : '',
        };
      }
    }
    return { id: '', text: raw.trim(), profileId: '' };
  } catch {
    return null;
  }
}

function writeNextLoadingTipPayload(payload: NextLoadingTipPayload): void {
  try {
    localStorage.setItem(NEXT_LOADING_TIP_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export interface TagExtractionResult {
  errorTags: string[];
  errorWeights: Map<string, number>;
  bankTags: string[];
  errorSignature: string;
}

export function collectErrorAndBankTags(
  questions: Question[],
  answers: Record<number, UserAnswerRecord[]>,
  activeDatabaseId: string | 'all' = 'all'
): TagExtractionResult {
  const questionById = new Map<number, Question>();
  for (const q of questions || []) {
    if (q && typeof q.sequence_id === 'number') {
      questionById.set(q.sequence_id, q);
    }
  }

  const wrongRecords: Array<{ q: Question; timestamp: number }> = [];
  for (const [qidStr, recordList] of Object.entries(answers || {})) {
    if (!Array.isArray(recordList) || recordList.length === 0) continue;
    const latest = recordList[recordList.length - 1];
    if (!latest || latest.is_correct) continue;
    const q = questionById.get(Number(qidStr));
    if (q) {
      wrongRecords.push({ q, timestamp: latest.timestamp || 0 });
    }
  }

  wrongRecords.sort((a, b) => b.timestamp - a.timestamp);
  const recentWrongs = wrongRecords.slice(0, 20);

  const errorWeights = new Map<string, number>();
  const rawErrorTagOrder: string[] = [];
  const rawTagLabel = new Map<string, string>();

  recentWrongs.forEach(({ q }, idx) => {
    const recencyWeight = idx < 5 ? 3 : idx < 12 ? 2 : 1;
    const subj = q.metadata?.subject?.trim();
    const topics = Array.isArray(q.metadata?.topics) ? q.metadata.topics : [];

    if (subj) {
      const norm = normalizeTag(subj);
      if (norm) {
        if (!errorWeights.has(norm)) rawErrorTagOrder.push(norm);
        errorWeights.set(norm, (errorWeights.get(norm) || 0) + recencyWeight * 1.5);
        if (!rawTagLabel.has(norm)) rawTagLabel.set(norm, subj);
      }
    }
    for (const topic of topics) {
      const clean = String(topic || '').trim();
      const norm = normalizeTag(clean);
      if (norm) {
        if (!errorWeights.has(norm)) rawErrorTagOrder.push(norm);
        errorWeights.set(norm, (errorWeights.get(norm) || 0) + recencyWeight * 2);
        if (!rawTagLabel.has(norm)) rawTagLabel.set(norm, clean);
      }
    }
  });

  const errorTags = rawErrorTagOrder
    .sort((a, b) => (errorWeights.get(b) || 0) - (errorWeights.get(a) || 0))
    .map((norm) => rawTagLabel.get(norm) || norm)
    .slice(0, 14);

  const bankPool =
    activeDatabaseId && activeDatabaseId !== 'all'
      ? (questions || []).filter((q) => (q.database_id || 'default_main') === activeDatabaseId)
      : questions || [];

  const bankFreq = new Map<string, number>();
  const bankLabel = new Map<string, string>();
  for (const q of bankPool) {
    const subj = q.metadata?.subject?.trim();
    if (subj) {
      const norm = normalizeTag(subj);
      if (norm) {
        bankFreq.set(norm, (bankFreq.get(norm) || 0) + 1);
        if (!bankLabel.has(norm)) bankLabel.set(norm, subj);
      }
    }
    for (const topic of q.metadata?.topics || []) {
      const clean = String(topic || '').trim();
      const norm = normalizeTag(clean);
      if (norm) {
        bankFreq.set(norm, (bankFreq.get(norm) || 0) + 1);
        if (!bankLabel.has(norm)) bankLabel.set(norm, clean);
      }
    }
  }

  const bankTags = Array.from(bankFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([norm]) => bankLabel.get(norm) || norm)
    .slice(0, 14);

  const errorSignature = recentWrongs
    .slice(0, 10)
    .map(({ q, timestamp }) => `${q.sequence_id}:${timestamp}`)
    .join('|');

  return {
    errorTags,
    errorWeights,
    bankTags,
    errorSignature,
  };
}

function scoreTipRelevance(
  tip: LoadingTipItem,
  errorWeights: Map<string, number>,
  bankTagsNormalized: Set<string>
): number {
  let score = 0;
  const tipTagsNorm = tip.tags.map(normalizeTag).filter(Boolean);

  for (const tTag of tipTagsNorm) {
    for (const [errTag, weight] of errorWeights.entries()) {
      if (tTag === errTag) {
        score += weight * 4;
      } else if (tTag.includes(errTag) || errTag.includes(tTag)) {
        score += weight * 2;
      }
    }
    if (bankTagsNormalized.has(tTag)) {
      score += 1.5;
    } else {
      for (const bTag of bankTagsNormalized) {
        if (tTag.includes(bTag) || bTag.includes(tTag)) {
          score += 0.8;
          break;
        }
      }
    }
  }

  if (tip.source === 'ai' && tip.views === 0) {
    score += 2;
  }

  return score;
}

function pickBestTipFromStock(
  stock: LoadingTipItem[],
  errorWeights: Map<string, number>,
  bankTags: string[],
  avoidId?: string
): { selected: LoadingTipItem; updatedStock: LoadingTipItem[] } {
  let workingStock = stock.map((item) => ({ ...item }));
  let eligible = workingStock.filter((item) => item.views < MAX_VIEWS_PER_TIP);

  // Reset views only after the entire stock reaches the limit (views >= 3)
  if (eligible.length === 0 && workingStock.length > 0) {
    workingStock = workingStock.map((item) => ({ ...item, views: 0 }));
    eligible = workingStock;
  }

  if (eligible.length === 0) {
    return {
      selected: {
        id: 'fallback_default',
        text: DEFAULT_FALLBACK_LOADING_TIP,
        tags: ['matemática', 'escala'],
        source: 'curated',
        views: 0,
      },
      updatedStock: workingStock,
    };
  }

  const unseen = eligible.filter((item) => item.views === 0);
  const pool = unseen.length > 0 ? unseen : eligible;

  const bankTagsNormalized = new Set(bankTags.map(normalizeTag).filter(Boolean));
  const minViewsInPool = Math.min(...pool.map((item) => item.views));
  const lowestViewPool = pool.filter((item) => item.views === minViewsInPool);

  const scored = lowestViewPool.map((item) => ({
    item,
    score:
      scoreTipRelevance(item, errorWeights, bankTagsNormalized) -
      (avoidId && item.id === avoidId && lowestViewPool.length > 1 ? 100 : 0),
  }));

  scored.sort((a, b) => b.score - a.score);
  const topScore = scored[0].score;
  const topTieBand = scored.filter((s) => s.score >= topScore - 0.5);
  const chosen = topTieBand[Math.floor(Math.random() * topTieBand.length)].item;

  return { selected: chosen, updatedStock: workingStock };
}

/**
 * Sincroniza a contabilização da dica exibida no carregamento atual e prepara
 * a próxima dica em `silenon_next_loading_tip` para o próximo boot offline.
 */
export function syncLoadingTipSession(params: {
  profileId: string;
  questions: Question[];
  answers: Record<number, UserAnswerRecord[]>;
  activeDatabaseId: string | 'all';
  consumeDisplayedTip?: boolean;
}): {
  unseenCount: number;
  errorTags: string[];
  bankTags: string[];
  errorSignature: string;
} {
  const profileId = params.profileId || 'user_main';
  let stock = getLoadingTipsStock(profileId);
  const staged = readNextLoadingTipPayload();
  let lastShownId = staged?.id || '';

  // Increment view count once per page load for the tip the user just saw during pre-mount
  if (params.consumeDisplayedTip && !sessionConsumedTipByProfile.has(profileId)) {
    sessionConsumedTipByProfile.add(profileId);
    if (staged?.id && (!staged.profileId || staged.profileId === profileId)) {
      const idx = stock.findIndex((item) => item.id === staged.id);
      if (idx >= 0) {
        stock[idx] = { ...stock[idx], views: stock[idx].views + 1 };
        saveLoadingTipsStock(profileId, stock);
      }
    }
  }

  const { errorTags, errorWeights, bankTags, errorSignature } = collectErrorAndBankTags(
    params.questions,
    params.answers,
    params.activeDatabaseId
  );

  const { selected, updatedStock } = pickBestTipFromStock(
    stock,
    errorWeights,
    bankTags,
    lastShownId
  );

  if (updatedStock !== stock) {
    saveLoadingTipsStock(profileId, updatedStock);
  }

  writeNextLoadingTipPayload({
    id: selected.id,
    text: selected.text,
    profileId,
  });

  const unseenCount = updatedStock.filter((item) => item.views === 0).length;

  return {
    unseenCount,
    errorTags,
    bankTags,
    errorSignature,
  };
}

function isClichéTip(text: string): boolean {
  const norm = normalizeTipTextForDedup(text);
  const banned = [
    'leia com atencao',
    'leia o enunciado com atencao',
    'revise o conteudo',
    'revise a materia',
    'mantenha a calma',
    'acredite em voce',
    'voce consegue',
    'faca muitas questoes',
    'gerencie seu tempo',
    'durma bem antes',
    'foque nos estudos',
    'elimine as alternativas absurdas',
  ];
  return banned.some((phrase) => norm.includes(phrase));
}

function isReasonableTipLength(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length >= 14 && words.length <= 46 && text.trim().length >= 65 && text.trim().length <= 320;
}

/**
 * Reabastece silenciosamente o estoque em segundo plano usando `openai/gpt-oss-120b`
 * (ou fallback `gemma-4-31b-it` caso a chave Groq não esteja configurada).
 */
export async function maybeReplenishLoadingTipsInBackground(params: {
  profileId: string;
  questions: Question[];
  answers: Record<number, UserAnswerRecord[]>;
  activeDatabaseId: string | 'all';
  triggerReason: 'startup' | 'new-error' | 'profile-switch';
}): Promise<void> {
  if (typeof window === 'undefined') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  const { groqApiKey, geminiApiKey } = getAIKeys();
  if (!groqApiKey.trim() && !geminiApiKey.trim()) return;

  const profileId = params.profileId || 'user_main';
  if (inFlightReplenishByProfile.has(profileId)) return;

  const stock = getLoadingTipsStock(profileId);
  const unseenCount = stock.filter((item) => item.views === 0).length;
  const { errorTags, errorWeights, bankTags, errorSignature } = collectErrorAndBankTags(
    params.questions,
    params.answers,
    params.activeDatabaseId
  );

  const meta = readMeta(profileId);
  const hasNewError =
    Boolean(errorSignature) && errorSignature !== meta.lastErrorSignature;
  const needsLowStockReplenish = unseenCount < REPLENISH_UNSEEN_THRESHOLD;

  if (!needsLowStockReplenish && !(params.triggerReason === 'new-error' && hasNewError)) {
    return;
  }

  if (Date.now() - meta.lastAttemptAt < REPLENISH_COOLDOWN_MS) {
    return;
  }

  const focusTags = (errorTags.length > 0 ? errorTags : bankTags).slice(0, 10);
  if (focusTags.length === 0) {
    focusTags.push('Matemática', 'Física', 'Química', 'Biologia', 'Linguagens');
  }

  inFlightReplenishByProfile.add(profileId);
  writeMeta(profileId, {
    lastAttemptAt: Date.now(),
    lastErrorSignature: errorSignature || meta.lastErrorSignature,
  });

  try {
    const existingSamples = stock.slice(-18).map((item) => item.text);
    const generated = await generateMicroTipsBatch({
      focusTags,
      existingTips: existingSamples,
      count: REPLENISH_BATCH_SIZE,
    });

    if (!generated || generated.length === 0) return;

    const latestStock = getLoadingTipsStock(profileId);
    const seenTexts = new Set(latestStock.map((item) => normalizeTipTextForDedup(item.text)));
    const added: LoadingTipItem[] = [];

    for (const candidate of generated) {
      const cleanText = String(candidate?.text || '').replace(/\s+/g, ' ').trim();
      if (!cleanText || !isReasonableTipLength(cleanText) || isClichéTip(cleanText)) {
        continue;
      }
      const dedupKey = normalizeTipTextForDedup(cleanText);
      if (!dedupKey || seenTexts.has(dedupKey)) {
        continue;
      }
      seenTexts.add(dedupKey);
      const cleanTags = Array.isArray(candidate?.tags)
        ? candidate.tags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 5)
        : [];
      added.push({
        id: `ai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        text: cleanText,
        tags: cleanTags.length > 0 ? cleanTags : focusTags.slice(0, 3),
        source: 'ai',
        views: 0,
      });
      if (added.length >= REPLENISH_BATCH_SIZE) break;
    }

    if (added.length === 0) return;

    let mergedStock = [...latestStock, ...added];

    // Keep AI tip stock bounded without deleting unseen or curated tips
    const aiTips = mergedStock.filter((item) => item.source === 'ai');
    if (aiTips.length > MAX_AI_STOCK_SIZE) {
      let toDrop = aiTips.length - MAX_AI_STOCK_SIZE;
      mergedStock = mergedStock.filter((item) => {
        if (item.source === 'ai' && item.views >= MAX_VIEWS_PER_TIP && toDrop > 0) {
          toDrop--;
          return false;
        }
        return true;
      });
    }

    saveLoadingTipsStock(profileId, mergedStock);

    // Stage one of the newly generated unseen tips for the next load
    const { selected } = pickBestTipFromStock(mergedStock, errorWeights, bankTags);
    writeNextLoadingTipPayload({
      id: selected.id,
      text: selected.text,
      profileId,
    });
  } catch (err) {
    console.warn('[LoadingTips] Silent background replenishment failed:', err);
  } finally {
    inFlightReplenishByProfile.delete(profileId);
  }
}
