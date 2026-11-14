import type JSZip from 'jszip';
import { Question, QuestionMedia, QuestionOption, AssociatedContext } from '../types/question';
import { buildIdbMediaUrl, normalizeMediaPath, saveMediaBlobsBatch } from './mediaBlobStorage';
import { normalizeQuestionToSchemaV2 } from './schemaV2Migrator';

const yieldToMainThread = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export interface ImportedZipBankResult {
  name: string;
  filename: string;
  databaseId: string;
  questions: Question[];
}

interface ZipManifest {
  title?: string;
  name?: string;
  defaults?: {
    exam_board?: string;
    institution?: string;
    exam_name?: string;
    year?: number | string;
    role?: string;
    language?: string;
    subject?: string;
  };
}

const MIME_BY_EXT: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

function getFileExtension(path: string): string {
  const clean = path.split('?')[0].split('#')[0];
  const dotIdx = clean.lastIndexOf('.');
  return dotIdx >= 0 ? clean.slice(dotIdx + 1).toLowerCase() : '';
}

function inferMediaTypeFromPath(path: string, explicitType?: string): QuestionMedia['type'] {
  if (explicitType && typeof explicitType === 'string') {
    const t = explicitType.toLowerCase().trim();
    if (t === 'imagem' || t === 'figura' || t === 'image' || t === 'foto') return 'image';
    if (t === 'tabela' || t === 'table' || t === 'table_image') return 'table_image';
    if (t === 'grafico' || t === 'gráfico' || t === 'chart') return 'chart';
    if (t === 'audio' || t === 'áudio') return 'audio';
    if (t === 'video' || t === 'vídeo') return 'video';
    if (t === 'svg') return 'svg';
    return explicitType;
  }
  const ext = getFileExtension(path);
  if (ext === 'svg') return 'svg';
  if (ext === 'mp3' || ext === 'ogg' || ext === 'wav') return 'audio';
  if (ext === 'mp4' || ext === 'webm') return 'video';
  return 'image';
}

function resolveZipRelativePath(baseDir: string, targetPath: string, availablePaths: Set<string>): string {
  const raw = String(targetPath || '').trim();
  if (!raw || /^(https?:|data:|blob:|idb-media:)/i.test(raw)) {
    return raw;
  }

  const normalizedTarget = normalizeMediaPath(raw);
  if (availablePaths.has(normalizedTarget)) {
    return normalizedTarget;
  }

  // Resolve relative to baseDir (e.g. "questoes/001")
  const combined = baseDir ? `${baseDir}/${raw}` : raw;
  const segments = combined.replace(/\\/g, '/').split('/');
  const resolvedSegments: string[] = [];
  for (const seg of segments) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      resolvedSegments.pop();
    } else {
      resolvedSegments.push(seg);
    }
  }
  const resolved = resolvedSegments.join('/');
  if (availablePaths.has(resolved)) {
    return resolved;
  }

  // Fallback: match by filename inside the same folder or anywhere in zip
  const fileNameOnly = normalizedTarget.split('/').pop() || normalizedTarget;
  if (baseDir) {
    const candidateInBase = `${baseDir}/${fileNameOnly}`;
    if (availablePaths.has(candidateInBase)) {
      return candidateInBase;
    }
  }
  for (const p of availablePaths) {
    if (p.endsWith(`/${fileNameOnly}`) || p === fileNameOnly) {
      return p;
    }
  }

  return resolved || normalizedTarget;
}

function toIdbUrlIfLocal(
  databaseId: string,
  baseDir: string,
  rawUrl: string | undefined,
  availablePaths: Set<string>
): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (/^(https?:|data:|blob:|idb-media:)/i.test(trimmed)) {
    return trimmed;
  }
  const resolvedPath = resolveZipRelativePath(baseDir, trimmed, availablePaths);
  return buildIdbMediaUrl(databaseId, resolvedPath);
}

function parseMediaArray(
  rawMedia: any,
  databaseId: string,
  baseDir: string,
  availablePaths: Set<string>
): QuestionMedia[] {
  if (!rawMedia) return [];
  const list = Array.isArray(rawMedia) ? rawMedia : [rawMedia];
  const result: QuestionMedia[] = [];

  for (const item of list) {
    if (!item) continue;
    if (typeof item === 'string') {
      const url = toIdbUrlIfLocal(databaseId, baseDir, item, availablePaths);
      if (url) {
        result.push({
          type: inferMediaTypeFromPath(item),
          url,
          alt_text: '',
        });
      }
    } else if (typeof item === 'object') {
      const rawUrl = item.url || item.arquivo || item.path || item.src || item.file || '';
      const url = toIdbUrlIfLocal(databaseId, baseDir, rawUrl, availablePaths);
      if (!url) continue;
      const itemSource = String(item.source || item.fonte || '').trim();
      result.push({
        type: inferMediaTypeFromPath(rawUrl, item.type || item.tipo),
        url,
        alt_text: String(item.alt_text || item.alt || item.legenda || item.caption || item.descricao || ''),
        ...(itemSource ? { source: itemSource } : {}),
      });
    }
  }

  return result;
}

function mapPortugueseQuestaoJsonToQuestion(
  raw: any,
  seqIndex: number,
  folderPath: string,
  manifestDefaults: ZipManifest['defaults'],
  databaseId: string,
  availablePaths: Set<string>
): Question {
  const num = Number(raw.numero ?? raw.sequence_id ?? raw.id ?? seqIndex);
  const sequence_id = Number.isFinite(num) && num > 0 ? num : seqIndex;
  const reference_code = String(
    raw.codigo || raw.code || raw.metadata?.reference_code || `Q-${String(sequence_id).padStart(3, '0')}`
  ).trim();

  const subject = String(
    raw.materia || raw.disciplina || raw.subject || raw.metadata?.subject || manifestDefaults?.subject || 'Conhecimentos Gerais'
  ).trim();

  const rawTopics = Array.isArray(raw.topicos)
    ? raw.topicos
    : Array.isArray(raw.topics)
      ? raw.topics
      : Array.isArray(raw.metadata?.topics)
        ? raw.metadata.topics
        : typeof raw.topicos === 'string'
          ? [raw.topicos]
          : [];

  const topics = rawTopics.map((t: any) => String(t).trim()).filter(Boolean);

  // Associated context (contexto / associated_context / textos_base)
  let associated_context: AssociatedContext = {
    has_associated_context: false,
    title: '',
    source: '',
    content: '',
  };

  const rawContext = raw.contexto ?? raw.associated_context ?? raw.textos_base;
  if (rawContext) {
    if (typeof rawContext === 'string') {
      const content = rawContext.trim();
      associated_context = {
        has_associated_context: content.length > 0,
        title: '',
        source: '',
        content,
      };
    } else if (Array.isArray(rawContext)) {
      const titles: string[] = [];
      const sources: string[] = [];
      const contents: string[] = [];
      for (const item of rawContext) {
        if (!item) continue;
        if (typeof item === 'string') {
          if (item.trim()) contents.push(item.trim());
        } else if (typeof item === 'object') {
          if (item.titulo || item.title) titles.push(String(item.titulo || item.title).trim());
          if (item.fonte || item.source) sources.push(String(item.fonte || item.source).trim());
          if (item.texto || item.content) contents.push(String(item.texto || item.content).trim());
        }
      }
      const joinedContent = contents.join('\n\n');
      associated_context = {
        has_associated_context: Boolean(joinedContent || titles.length > 0),
        title: titles.join(' / '),
        source: sources.join(' / '),
        content: joinedContent,
      };
    } else if (typeof rawContext === 'object') {
      const content = String(rawContext.texto ?? rawContext.content ?? '').trim();
      const title = String(rawContext.titulo ?? rawContext.title ?? '').trim();
      const source = String(rawContext.fonte ?? rawContext.source ?? '').trim();
      associated_context = {
        has_associated_context: Boolean(rawContext.has_associated_context || content || title),
        title,
        source,
        content,
      };
    }
  }

  // Stem media
  const media = parseMediaArray(
    raw.midia ?? raw.midias ?? raw.media ?? raw.imagens,
    databaseId,
    folderPath,
    availablePaths
  );

  // Also check if context had media attached
  if (rawContext && typeof rawContext === 'object' && !Array.isArray(rawContext) && rawContext.midia) {
    const ctxMedia = parseMediaArray(rawContext.midia, databaseId, folderPath, availablePaths);
    media.push(...ctxMedia);
  }

  // Map top-level bibliographic source (raw.fonte || raw.source)
  const topLevelSource = String(raw.fonte ?? raw.source ?? '').trim();
  if (topLevelSource) {
    if (!associated_context.source) {
      associated_context.source = topLevelSource;
    }
    if (media.length > 0 && !media[media.length - 1].source) {
      media[media.length - 1].source = topLevelSource;
    }
  } else if (associated_context.source && media.length > 0 && !media[media.length - 1].source) {
    media[media.length - 1].source = associated_context.source;
  }

  // Options (alternativas / options)
  const rawOptions = Array.isArray(raw.alternativas)
    ? raw.alternativas
    : Array.isArray(raw.options)
      ? raw.options
      : [];

  const gabaritoUpper = String(
    raw.gabarito ?? raw.resolucao?.gabarito ?? raw.resolution?.deduced_answer ?? raw.correct_answer ?? ''
  )
    .trim()
    .toUpperCase();

  const options: QuestionOption[] = rawOptions.map((opt: any, idx: number) => {
    const letter = String(opt.letra || opt.letter || String.fromCharCode(65 + idx))
      .trim()
      .toUpperCase();
    const text = String(opt.texto ?? opt.text ?? '').trim();
    const optMediaList = parseMediaArray(
      opt.midia ?? opt.media ?? opt.imagem ?? opt.media_url,
      databaseId,
      folderPath,
      availablePaths
    );
    const media_url =
      typeof opt.media_url === 'string' && opt.media_url.trim()
        ? toIdbUrlIfLocal(databaseId, folderPath, opt.media_url, availablePaths)
        : optMediaList[0]?.url || undefined;

    const is_correct =
      typeof opt.is_correct === 'boolean'
        ? opt.is_correct
        : typeof opt.correta === 'boolean'
          ? opt.correta
          : gabaritoUpper
            ? letter === gabaritoUpper
            : false;

    const why_wrong_or_right = String(
      opt.comentario ?? opt.why_wrong_or_right ?? opt.rationale ?? ''
    ).trim();

    const distractor_type = String(
      opt.distractor_type ?? opt.tipo_distrator ?? ''
    ).trim();

    const optionObj: QuestionOption = {
      letter,
      text,
      is_correct,
      why_wrong_or_right,
      ...(distractor_type ? { distractor_type } : {}),
    };

    if (media_url) {
      optionObj.media_url = media_url;
    }
    if (optMediaList.length > 0) {
      optionObj.media = optMediaList;
    }

    return optionObj;
  });

  // Resolution (resolucao / resolution)
  const rawRes = raw.resolucao ?? raw.resolution;
  const deduced_answer =
    gabaritoUpper || options.find((o) => o.is_correct)?.letter || 'A';

  const resMedia = rawRes
    ? parseMediaArray(
        rawRes.midia ?? rawRes.media ?? rawRes.imagens,
        databaseId,
        folderPath,
        availablePaths
      )
    : [];

  let cot_reasoning = '';
  const rawSteps = rawRes?.passo_a_passo ?? rawRes?.cot_reasoning ?? rawRes?.raciocinio;
  if (Array.isArray(rawSteps)) {
    cot_reasoning = rawSteps
      .map((s: any, i: number) =>
        typeof s === 'string'
          ? `${i + 1}. ${s}`
          : `${s.step || s.passo || i + 1}. ${s.description || s.descricao || s.texto || ''}`
      )
      .join('\n');
  } else if (typeof rawSteps === 'string') {
    cot_reasoning = rawSteps;
  }

  const pedagogical_explanation = String(
    rawRes?.comentario ??
      rawRes?.pedagogical_explanation ??
      rawRes?.resumo ??
      rawRes?.summary ??
      'Resolução fundamentada da questão.'
  );

  const is_annulled = Boolean(raw.anulada_inep || raw.anulada || raw.is_annulled);

  const stemText =
    typeof raw.enunciado === 'string'
      ? raw.enunciado
      : typeof raw.stem?.full_text === 'string'
        ? raw.stem.full_text
        : typeof raw.question_stem === 'string'
          ? raw.question_stem
          : '';

  const rawMeta = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
  const rawTri = rawMeta.tri ?? raw.tri;
  const parsedTri =
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

  const rawHabilidade = rawMeta.habilidade_inep ?? raw.habilidade_inep;
  const rawCoItem = rawMeta.co_item ?? raw.co_item;
  const rawInItemAban = rawMeta.in_item_aban ?? raw.in_item_aban;
  const rawTxMotivoAban = rawMeta.tx_motivo_aban !== undefined ? rawMeta.tx_motivo_aban : raw.tx_motivo_aban;
  const rawDifficultyStr =
    typeof rawMeta.difficulty === 'string'
      ? rawMeta.difficulty
      : typeof raw.difficulty === 'string'
        ? raw.difficulty
        : typeof raw.dificuldade === 'string'
          ? raw.dificuldade
          : undefined;
  const rawDifficultyLevel =
    rawMeta.difficulty_level !== undefined
      ? rawMeta.difficulty_level
      : raw.difficulty_level !== undefined
        ? raw.difficulty_level
        : raw.nivel_dificuldade;

  const rawQuestion: Partial<Question> = {
    sequence_id,
    is_annulled: is_annulled ? true : undefined,
    metadata: {
      reference_code,
      subject,
      topics,
      tags: Array.isArray(raw.tags || raw.metadata?.tags) ? (raw.tags || raw.metadata.tags) : [],
      exam_board: String(raw.banca ?? raw.metadata?.exam_board ?? manifestDefaults?.exam_board ?? 'Geral'),
      institution: String(raw.instituicao ?? raw.metadata?.institution ?? manifestDefaults?.institution ?? 'Fonte / Origem'),
      exam_name: String(raw.prova ?? raw.metadata?.exam_name ?? manifestDefaults?.exam_name ?? 'Estudo Geral'),
      year: Number(raw.ano ?? raw.metadata?.year ?? manifestDefaults?.year ?? new Date().getFullYear()),
      role: String(raw.cargo ?? raw.metadata?.role ?? manifestDefaults?.role ?? 'Geral'),
      language: String(raw.idioma ?? raw.metadata?.language ?? manifestDefaults?.language ?? 'pt-BR'),
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
      ...(typeof rawDifficultyStr === 'string' && rawDifficultyStr.trim()
        ? { difficulty: rawDifficultyStr.trim() }
        : {}),
      ...(rawDifficultyLevel !== undefined
        ? {
            difficulty_level:
              typeof rawDifficultyLevel === 'number' && Number.isFinite(rawDifficultyLevel)
                ? rawDifficultyLevel
                : null,
          }
        : {}),
      ...(parsedTri ? { tri: parsedTri } : {}),
    },
    associated_context,
    stem: {
      full_text: stemText,
    },
    media: media.length > 0 ? media : undefined,
    options,
    resolution: {
      cot_reasoning,
      deduced_answer,
      pedagogical_explanation,
      ...(resMedia.length > 0 ? { media: resMedia } : {}),
    },
  };

  return normalizeQuestionToSchemaV2(rawQuestion, sequence_id);
}

function rewriteRootQuestionBankMedia(
  rawQ: any,
  seqIndex: number,
  databaseId: string,
  availablePaths: Set<string>
): Question {
  const cloned = { ...rawQ };

  if (Array.isArray(cloned.media) || cloned.midia) {
    cloned.media = parseMediaArray(cloned.media ?? cloned.midia, databaseId, '', availablePaths);
  }

  const rootSource = String(cloned.fonte ?? cloned.source ?? '').trim();
  if (rootSource) {
    cloned.associated_context = {
      has_associated_context: Boolean(cloned.associated_context?.has_associated_context),
      title: String(cloned.associated_context?.title ?? ''),
      source: String(cloned.associated_context?.source || rootSource),
      content: String(cloned.associated_context?.content ?? ''),
    };
    if (Array.isArray(cloned.media) && cloned.media.length > 0 && !cloned.media[cloned.media.length - 1].source) {
      cloned.media[cloned.media.length - 1].source = rootSource;
    }
  }

  if (Array.isArray(cloned.options)) {
    cloned.options = cloned.options.map((opt: any) => {
      const nextOpt = { ...opt };
      if (typeof nextOpt.media_url === 'string' && nextOpt.media_url.trim()) {
        nextOpt.media_url = toIdbUrlIfLocal(databaseId, '', nextOpt.media_url, availablePaths);
      }
      if (Array.isArray(nextOpt.media) || nextOpt.midia) {
        nextOpt.media = parseMediaArray(
          nextOpt.media ?? nextOpt.midia,
          databaseId,
          '',
          availablePaths
        );
        if (!nextOpt.media_url && nextOpt.media.length > 0) {
          nextOpt.media_url = nextOpt.media[0].url;
        }
      }
      return nextOpt;
    });
  }

  if (cloned.resolution && typeof cloned.resolution === 'object') {
    const nextRes = { ...cloned.resolution };
    if (Array.isArray(nextRes.media) || nextRes.midia) {
      nextRes.media = parseMediaArray(
        nextRes.media ?? nextRes.midia,
        databaseId,
        '',
        availablePaths
      );
    }
    cloned.resolution = nextRes;
  }

  if (cloned.anulada_inep || cloned.anulada || cloned.is_annulled) {
    cloned.is_annulled = true;
  }

  return normalizeQuestionToSchemaV2(cloned, seqIndex);
}

export async function importQuestionBankFromZip(file: File): Promise<ImportedZipBankResult> {
  const JSZipModule = await import('jszip');
  const JSZipConstructor = JSZipModule.default || JSZipModule;
  const zip = await JSZipConstructor.loadAsync(file);
  const databaseId = `zip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Map non-directory zip entries ignoring common root wrapper folder if present
  const rawEntryKeys = Object.keys(zip.files).filter((k) => {
    const f = zip.files[k];
    if (f.dir) return false;
    if (k.startsWith('__MACOSX/') || k.includes('/._') || k.endsWith('.DS_Store')) return false;
    return true;
  });

  // Detect if all files share a single top-level directory prefix (e.g., "enem_2025/manifest.json")
  let commonRootPrefix = '';
  if (rawEntryKeys.length > 0) {
    const firstParts = rawEntryKeys.map((k) => k.split('/'));
    if (firstParts.every((parts) => parts.length > 1 && parts[0] === firstParts[0][0])) {
      const candidateRoot = firstParts[0][0];
      if (candidateRoot !== 'questoes' && candidateRoot !== 'compartilhados') {
        commonRootPrefix = `${candidateRoot}/`;
      }
    }
  }

  const relativeToZipObject = new Map<string, JSZip.JSZipObject>();
  const availablePaths = new Set<string>();

  for (const key of rawEntryKeys) {
    const relPath = normalizeMediaPath(
      commonRootPrefix && key.startsWith(commonRootPrefix)
        ? key.slice(commonRootPrefix.length)
        : key
    );
    if (!relPath) continue;
    relativeToZipObject.set(relPath, zip.files[key]);
    availablePaths.add(relPath);
  }

  // 1. Read manifest.json if available
  let manifest: ZipManifest = {};
  const manifestObj = relativeToZipObject.get('manifest.json');
  if (manifestObj) {
    try {
      const text = await manifestObj.async('string');
      manifest = JSON.parse(text);
    } catch (e) {
      console.warn('[zipBankImporter] Aviso ao ler manifest.json:', e);
    }
  }

  // 2. Extract and store all media blobs in IndexedDB
  const mediaEntries: Array<{ path: string; blob: Blob; mimeType: string }> = [];
  let mediaProcessedCount = 0;
  for (const [relPath, zipObj] of relativeToZipObject.entries()) {
    const ext = getFileExtension(relPath);
    const mimeType = MIME_BY_EXT[ext];
    if (!mimeType) continue;

    mediaProcessedCount++;
    if (mediaProcessedCount % 15 === 0) {
      await yieldToMainThread();
    }

    const rawBlob = await zipObj.async('blob');
    const typedBlob = rawBlob.type === mimeType ? rawBlob : new Blob([rawBlob], { type: mimeType });
    mediaEntries.push({
      path: relPath,
      blob: typedBlob,
      mimeType,
    });
  }

  if (mediaEntries.length > 0) {
    await saveMediaBlobsBatch(databaseId, mediaEntries);
  }

  // 3. Locate question definitions
  // Canonical Folder Mode: questoes/*/questao.json
  const folderQuestionEntries = Array.from(relativeToZipObject.entries())
    .filter(([relPath]) => /^questoes\/[^/]+\/questao\.json$/i.test(relPath))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  const questions: Question[] = [];

  if (folderQuestionEntries.length > 0) {
    for (let i = 0; i < folderQuestionEntries.length; i++) {
      if (i > 0 && i % 15 === 0) {
        await yieldToMainThread();
      }
      const [relPath, zipObj] = folderQuestionEntries[i];
      const folderPath = relPath.slice(0, relPath.lastIndexOf('/'));
      try {
        const jsonText = await zipObj.async('string');
        const rawQuestao = JSON.parse(jsonText);
        if (
          rawQuestao &&
          (rawQuestao.anulada_inep === true ||
            rawQuestao.anulada === true ||
            rawQuestao.is_annulled === true)
        ) {
          continue;
        }
        const mapped = mapPortugueseQuestaoJsonToQuestion(
          rawQuestao,
          questions.length + 1,
          folderPath,
          manifest.defaults,
          databaseId,
          availablePaths
        );
        questions.push(mapped);
      } catch (err) {
        console.warn(`[zipBankImporter] Erro ao processar ${relPath}:`, err);
      }
    }
  } else {
    // Shortcut Mode: root question_bank.json (or any .json containing question_bank/questions)
    const rootBankObj =
      relativeToZipObject.get('question_bank.json') ||
      Array.from(relativeToZipObject.entries()).find(
        ([relPath]) => relPath.toLowerCase().endsWith('.json') && relPath.toLowerCase() !== 'manifest.json'
      )?.[1];

    if (rootBankObj) {
      const jsonText = await rootBankObj.async('string');
      const parsed = JSON.parse(jsonText);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.question_bank)
          ? parsed.question_bank
          : Array.isArray(parsed?.questions)
            ? parsed.questions
            : Array.isArray(parsed?.questoes)
              ? parsed.questoes
              : [];

      const validRawList = list.filter(
        (rawQ: any) =>
          rawQ &&
          rawQ.anulada_inep !== true &&
          rawQ.anulada !== true &&
          rawQ.is_annulled !== true
      );

      for (let idx = 0; idx < validRawList.length; idx++) {
        if (idx > 0 && idx % 15 === 0) {
          await yieldToMainThread();
        }
        const rawQ = validRawList[idx];
        if (rawQ && (rawQ.enunciado !== undefined || rawQ.alternativas !== undefined)) {
          questions.push(
            mapPortugueseQuestaoJsonToQuestion(
              rawQ,
              idx + 1,
              '',
              manifest.defaults,
              databaseId,
              availablePaths
            )
          );
        } else {
          questions.push(rewriteRootQuestionBankMedia(rawQ, idx + 1, databaseId, availablePaths));
        }
      }
    }
  }

  if (questions.length === 0) {
    throw new Error(
      'Nenhuma questão válida encontrada no pacote .zip (esperado questoes/*/questao.json ou question_bank.json).'
    );
  }

  const fallbackName = file.name.replace(/\.(zip|json)$/i, '');
  const name = String(manifest.title || manifest.name || fallbackName).trim() || fallbackName;

  return {
    name,
    filename: file.name,
    databaseId,
    questions,
  };
}
