import { Question, QuestionBankRoot } from '../types/question';
import { getQuestionContentHash } from './duplicateEngine';

export const SCHEMA_V2_VERSION = '1.0.2';

/**
 * Normalizes any question (legacy or v2) into strict compliance with
 * Memoriz Question Bank Schema v2 (version 1.0.2)
 */
export function normalizeQuestionToSchemaV2(raw: Partial<Question>, fallbackSeqId = 1): Question {
  const deduced = raw.resolution?.deduced_answer || raw.options?.find(o => o.is_correct)?.letter || 'A';
  
  // Format options with is_correct and why_wrong_or_right
  const normalizedOptions = (raw.options || []).map((opt) => {
    const isCorrect = typeof opt.is_correct === 'boolean'
      ? opt.is_correct
      : opt.letter?.toUpperCase() === deduced.toUpperCase();

    const whyWrongOrRight = opt.why_wrong_or_right || (
      isCorrect 
        ? 'Alternativa correta de acordo com a resolução e o gabarito oficial.'
        : `Alternativa incorreta. Não atende aos requisitos solicitados no enunciado.`
    );

    const distractorType = String(
      (opt as any).distractor_type ?? (opt as any).tipo_distrator ?? ''
    ).trim();

    return {
      letter: opt.letter || 'A',
      text: opt.text || '',
      is_correct: isCorrect,
      why_wrong_or_right: whyWrongOrRight,
      ...(distractorType ? { distractor_type: distractorType } : {}),
      ...(opt.media_url ? { media_url: opt.media_url } : {}),
      ...(Array.isArray(opt.media) && opt.media.length > 0 ? { media: opt.media } : {}),
    };
  });

  // Check format: multiple_choice, true_false_cespe, multiple_true_false_items
  let format = raw.question_format;
  if (!format) {
    if (normalizedOptions.length === 2 && (
      normalizedOptions[0]?.text?.toLowerCase().includes('certo') || 
      normalizedOptions[0]?.letter?.toUpperCase() === 'C'
    )) {
      format = 'true_false_cespe';
    } else {
      format = 'multiple_choice';
    }
  }

  const stem = {
    full_text: raw.stem?.full_text || (typeof raw.stem === 'string' ? raw.stem : ''),
  };

  const rawMeta: any = raw.metadata || {};
  const rawAny: any = raw;
  const topLevelSource = String(rawAny.fonte ?? rawAny.source ?? '').trim();

  const associatedContext = {
    has_associated_context: Boolean(raw.associated_context?.has_associated_context || (raw.associated_context?.content && raw.associated_context.content.trim().length > 0)),
    title: raw.associated_context?.title || '',
    source: raw.associated_context?.source || topLevelSource || '',
    content: raw.associated_context?.content || '',
  };

  const rawTri = rawMeta.tri ?? rawAny.tri;
  const normalizedTri =
    rawTri && typeof rawTri === 'object'
      ? {
          param_a: typeof rawTri.param_a === 'number' && Number.isFinite(rawTri.param_a) ? rawTri.param_a : null,
          param_b: typeof rawTri.param_b === 'number' && Number.isFinite(rawTri.param_b) ? rawTri.param_b : null,
          param_c: typeof rawTri.param_c === 'number' && Number.isFinite(rawTri.param_c) ? rawTri.param_c : null,
          level_1_to_10:
            typeof rawTri.level_1_to_10 === 'number' && Number.isFinite(rawTri.level_1_to_10)
              ? rawTri.level_1_to_10
              : null,
          difficulty_label: String(rawTri.difficulty_label ?? '').trim(),
        }
      : undefined;

  const rawHabilidade = rawMeta.habilidade_inep ?? rawAny.habilidade_inep;
  const rawCoItem = rawMeta.co_item ?? rawAny.co_item;
  const rawInItemAban = rawMeta.in_item_aban ?? rawAny.in_item_aban;
  const rawTxMotivoAban = rawMeta.tx_motivo_aban !== undefined ? rawMeta.tx_motivo_aban : rawAny.tx_motivo_aban;
  const rawMetaDifficulty =
    typeof rawMeta.difficulty === 'string'
      ? rawMeta.difficulty
      : typeof rawAny.difficulty === 'string'
        ? rawAny.difficulty
        : undefined;
  const rawDifficultyLevel =
    rawMeta.difficulty_level !== undefined ? rawMeta.difficulty_level : rawAny.difficulty_level;

  const metadata: Question['metadata'] = {
    reference_code: raw.metadata?.reference_code || `MEM-${raw.sequence_id || fallbackSeqId}`,
    subject: raw.metadata?.subject || 'Conhecimentos Gerais',
    topics: Array.isArray(raw.metadata?.topics) ? raw.metadata.topics : [],
    tags: Array.isArray(raw.metadata?.tags) ? raw.metadata.tags : [],
    year: raw.metadata?.year || new Date().getFullYear(),
    exam_board: raw.metadata?.exam_board || 'Geral',
    institution: raw.metadata?.institution || 'Fonte / Origem',
    exam_name: raw.metadata?.exam_name || 'Estudo Geral',
    role: raw.metadata?.role || 'Geral',
    language: raw.metadata?.language || 'pt-BR',
    ...(typeof rawHabilidade === 'string' && rawHabilidade.trim()
      ? { habilidade_inep: rawHabilidade.trim() }
      : {}),
    ...(typeof rawCoItem === 'number' && Number.isFinite(rawCoItem) ? { co_item: rawCoItem } : {}),
    ...(typeof rawInItemAban === 'boolean'
      ? { in_item_aban: rawInItemAban }
      : typeof rawInItemAban === 'number'
        ? { in_item_aban: rawInItemAban === 1 }
        : {}),
    ...(rawTxMotivoAban !== undefined
      ? { tx_motivo_aban: rawTxMotivoAban === null ? null : String(rawTxMotivoAban).trim() || null }
      : {}),
    ...(typeof rawMetaDifficulty === 'string' && rawMetaDifficulty.trim()
      ? { difficulty: rawMetaDifficulty.trim() }
      : {}),
    ...(rawDifficultyLevel !== undefined
      ? {
          difficulty_level:
            typeof rawDifficultyLevel === 'number' && Number.isFinite(rawDifficultyLevel)
              ? rawDifficultyLevel
              : null,
        }
      : {}),
    ...(normalizedTri ? { tri: normalizedTri } : {}),
  };

  const resolution = {
    cot_reasoning: raw.resolution?.cot_reasoning || '',
    deduced_answer: deduced,
    pedagogical_explanation: raw.resolution?.pedagogical_explanation || 'Resolução fundamentada da questão.',
    ...(Array.isArray(raw.resolution?.media) && raw.resolution.media.length > 0 ? { media: raw.resolution.media } : {}),
  };

  const provenance = {
    source_type: raw.provenance?.source_type || 'literal_banca',
    generation_model: raw.provenance?.generation_model ?? null,
    human_reviewed: raw.provenance?.human_reviewed ?? true,
    reviewed_by: raw.provenance?.reviewed_by ?? null,
    reviewed_at: raw.provenance?.reviewed_at ?? null,
    external_reference_url: raw.provenance?.external_reference_url ?? null,
    licensing_note: raw.provenance?.licensing_note ?? null,
  };

  const difficulty = {
    estimated_level: typeof raw.difficulty?.estimated_level === 'number' ? raw.difficulty.estimated_level : 3,
    estimation_method: raw.difficulty?.estimation_method || 'not_estimated',
    observed_accuracy_rate: raw.difficulty?.observed_accuracy_rate ?? null,
    observed_sample_size: raw.difficulty?.observed_sample_size ?? null,
  };

  const normalizedMedia = Array.isArray(raw.media)
    ? raw.media.map((m: any, idx: number, arr: any[]) => {
        const itemSource = String(
          m?.source || m?.fonte || (idx === arr.length - 1 ? associatedContext.source : '') || ''
        ).trim();
        return {
          type: m?.type || 'image',
          url: m?.url || '',
          alt_text: m?.alt_text || '',
          ...(itemSource ? { source: itemSource } : {}),
        };
      })
    : undefined;

  const baseQuestion: Question = {
    sequence_id: typeof raw.sequence_id === 'number' ? raw.sequence_id : fallbackSeqId,
    content_hash: raw.content_hash || '',
    database_id: raw.database_id,
    database_name: raw.database_name,
    ...(raw.is_annulled ? { is_annulled: true } : {}),
    provenance,
    metadata,
    question_format: format,
    associated_context: associatedContext,
    stem,
    options: normalizedOptions,
    resolution,
    difficulty,
    estimated_time_seconds: typeof raw.estimated_time_seconds === 'number' ? raw.estimated_time_seconds : 180,
    media: normalizedMedia,
    revision_history: Array.isArray(raw.revision_history) ? raw.revision_history : undefined,
  };

  if (!baseQuestion.content_hash) {
    baseQuestion.content_hash = getQuestionContentHash(baseQuestion);
  }

  return baseQuestion;
}

/**
 * Normalizes an entire question bank payload, attaching schema_version: "1.0.2"
 */
export function normalizeQuestionBankToSchemaV2(questions: Question[]): QuestionBankRoot {
  const normalized = questions.map((q, idx) => normalizeQuestionToSchemaV2(q, idx + 1));
  return {
    schema_version: SCHEMA_V2_VERSION,
    title: 'Silenon Question Bank Schema v2',
    question_bank: normalized,
  };
}
