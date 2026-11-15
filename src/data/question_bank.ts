import { QuestionBankRoot, QuestionDatabase } from '../types/question';
import { importQuestionBankFromZip, ImportedZipBankResult } from '../lib/zipBankImporter';

export const initialQuestionBank: QuestionBankRoot = {
  schema_version: '2.0',
  title: 'Silenon',
  question_bank: [],
};

export interface DefaultZipBankSpec {
  url: string;
  filename: string;
  isInitialActive: boolean;
}

export interface LoadedDefaultZipBank extends ImportedZipBankResult {
  isInitialActive: boolean;
}

export const DEFAULT_ZIP_BANKS: DefaultZipBankSpec[] = [
  {
    url: '/banks/ENEM_2023_Dia2_Caderno6_Cinza.zip',
    filename: 'ENEM_2023_Dia2_Caderno6_Cinza.zip',
    isInitialActive: false,
  },
  {
    url: '/banks/ENEM_2024_Dia2_Caderno7_Azul.zip',
    filename: 'ENEM_2024_Dia2_Caderno7_Azul.zip',
    isInitialActive: false,
  },
  {
    url: '/banks/ENEM_2025_Dia2_Caderno8_Verde.zip',
    filename: 'ENEM_2025_Dia2_Caderno8_Verde.zip',
    isInitialActive: true,
  },
];

export function isDefaultBankPresent(
  databases: QuestionDatabase[],
  spec: DefaultZipBankSpec
): boolean {
  const targetFilename = spec.filename.trim().toLowerCase();
  const targetStem = targetFilename.replace(/\.zip$/i, '');
  const yearMatch = spec.filename.match(/\b(20\d{2})\b/);
  const targetYear = yearMatch ? Number(yearMatch[1]) : null;

  return databases.some((db) => {
    if (!db) return false;
    if (typeof db.filename === 'string' && db.filename.trim().toLowerCase() === targetFilename) {
      return true;
    }

    const dbNameLower = String(db.name || '').trim().toLowerCase();
    if (dbNameLower === targetStem) {
      return true;
    }

    if (db.is_default && targetYear !== null) {
      if (dbNameLower.includes('enem') && dbNameLower.includes(String(targetYear))) {
        return true;
      }
      const firstQMeta = db.questions?.[0]?.metadata;
      if (
        firstQMeta?.year === targetYear &&
        String(firstQMeta?.exam_name || '').toLowerCase().includes('enem')
      ) {
        return true;
      }
    }

    return false;
  });
}

export function getMissingDefaultZipBanks(
  databases: QuestionDatabase[]
): DefaultZipBankSpec[] {
  return DEFAULT_ZIP_BANKS.filter((spec) => !isDefaultBankPresent(databases, spec));
}

const inFlightBanksPromises = new Map<string, Promise<LoadedDefaultZipBank[]>>();

async function fetchAndImportDefaultZipBanks(
  specs: DefaultZipBankSpec[]
): Promise<LoadedDefaultZipBank[]> {
  const importedBanks: LoadedDefaultZipBank[] = [];

  for (const spec of specs) {
    const response = await fetch(spec.url);
    if (!response.ok) {
      throw new Error(
        `Falha ao baixar banco padrão ${spec.filename} (HTTP ${response.status}).`
      );
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.toLowerCase().includes('text/html')) {
      throw new Error(
        `Resposta inválida ao carregar ${spec.filename}: conteúdo HTML retornado em vez de arquivo .zip.`
      );
    }

    const blob = await response.blob();
    const file = new File([blob], spec.filename, {
      type: blob.type || 'application/zip',
    });

    const imported = await importQuestionBankFromZip(file);
    importedBanks.push({
      ...imported,
      isInitialActive: spec.isInitialActive,
    });
  }

  return importedBanks;
}

export function loadDefaultZipQuestionBanks(
  specs: DefaultZipBankSpec[] = DEFAULT_ZIP_BANKS
): Promise<LoadedDefaultZipBank[]> {
  const targetSpecs = specs && specs.length > 0 ? specs : DEFAULT_ZIP_BANKS;
  const cacheKey = targetSpecs.map((s) => s.filename).join('|');
  let promise = inFlightBanksPromises.get(cacheKey);
  if (!promise) {
    promise = fetchAndImportDefaultZipBanks(targetSpecs).finally(() => {
      inFlightBanksPromises.delete(cacheKey);
    });
    inFlightBanksPromises.set(cacheKey, promise);
  }
  return promise;
}
