/**
 * Pure Web Crypto API Vault for encrypting/decrypting AI API Keys (Gemini + Groq)
 * using a 4-digit numeric PIN (PBKDF2 SHA-256 100,000 iterations + AES-GCM 256-bit).
 * Zero plaintext keys ever leave the browser.
 */

export interface EncryptedVaultBlob {
  saltB64: string;
  ivB64: string;
  cipherB64: string;
}

export interface VaultAIKeys {
  geminiApiKey: string;
  groqApiKey: string;
}

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTE_LENGTH = 16;
const IV_BYTE_LENGTH = 12;

export function isValidFourDigitPin(pin: string): boolean {
  return /^\d{4}$/.test((pin || '').trim());
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesGcmKeyFromPin(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(pin.trim()),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptKeysWithPin(
  keys: VaultAIKeys,
  pin: string
): Promise<EncryptedVaultBlob> {
  const cleanPin = (pin || '').trim();
  if (!isValidFourDigitPin(cleanPin)) {
    throw new Error('O PIN deve conter exatamente 4 dígitos numéricos.');
  }

  const geminiApiKey = (keys.geminiApiKey || '').trim();
  const groqApiKey = (keys.groqApiKey || '').trim();
  if (!geminiApiKey || !groqApiKey) {
    throw new Error('As duas chaves (Gemini e Groq) são necessárias para criptografar o cofre.');
  }

  const salt = window.crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
  const iv = window.crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
  const aesKey = await deriveAesGcmKeyFromPin(cleanPin, salt);

  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(
    JSON.stringify({
      geminiApiKey,
      groqApiKey,
    })
  );

  const cipherBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
    },
    aesKey,
    plaintextBytes
  );

  return {
    saltB64: bytesToBase64(salt),
    ivB64: bytesToBase64(iv),
    cipherB64: bytesToBase64(new Uint8Array(cipherBuffer)),
  };
}

export async function decryptKeysWithPin(
  vault: EncryptedVaultBlob,
  pin: string
): Promise<VaultAIKeys> {
  const cleanPin = (pin || '').trim();
  if (!isValidFourDigitPin(cleanPin)) {
    throw new Error('Digite o PIN de 4 dígitos numéricos.');
  }

  if (!vault?.saltB64 || !vault?.ivB64 || !vault?.cipherB64) {
    throw new Error('Cofre criptografado inválido ou incompleto.');
  }

  try {
    const salt = base64ToBytes(vault.saltB64);
    const iv = base64ToBytes(vault.ivB64);
    const cipherBytes = base64ToBytes(vault.cipherB64);
    const aesKey = await deriveAesGcmKeyFromPin(cleanPin, salt);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as unknown as BufferSource,
      },
      aesKey,
      cipherBytes as unknown as BufferSource
    );

    const decoder = new TextDecoder();
    const parsed = JSON.parse(decoder.decode(decryptedBuffer));
    const geminiApiKey = typeof parsed?.geminiApiKey === 'string' ? parsed.geminiApiKey.trim() : '';
    const groqApiKey = typeof parsed?.groqApiKey === 'string' ? parsed.groqApiKey.trim() : '';

    if (!geminiApiKey || !groqApiKey) {
      throw new Error('Chaves descriptografadas estão vazias ou corrompidas.');
    }

    return { geminiApiKey, groqApiKey };
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('corrompidas')) {
      throw err;
    }
    throw new Error('PIN incorreto. Verifique os 4 dígitos e tente novamente.');
  }
}
