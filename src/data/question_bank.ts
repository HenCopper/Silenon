import { QuestionBankRoot } from '../types/question';
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

let inFlightDefaultBanksPromise: Promise<LoadedDefaultZipBank[]> | null = null;

async function fetchAndImportDefaultZipBanks(): Promise<LoadedDefaultZipBank[]> {
  const importedBanks: LoadedDefaultZipBank[] = [];

  for (const spec of DEFAULT_ZIP_BANKS) {
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

export function loadDefaultZipQuestionBanks(): Promise<LoadedDefaultZipBank[]> {
  if (!inFlightDefaultBanksPromise) {
    inFlightDefaultBanksPromise = fetchAndImportDefaultZipBanks().finally(() => {
      inFlightDefaultBanksPromise = null;
    });
  }
  return inFlightDefaultBanksPromise;
}
