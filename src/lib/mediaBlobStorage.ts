const DB_NAME = 'memoriz_media_blobs_db';
const DB_VERSION = 1;
const STORE_NAME = 'media_blobs';

export interface StoredMediaBlobRecord {
  key: string; // `${databaseId}::${relativePath}`
  databaseId: string;
  path: string;
  blob: Blob;
  mimeType: string;
  createdAt: number;
}

export function normalizeMediaPath(rawPath: string): string {
  return String(rawPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/|\/)+/, '');
}

export function buildIdbMediaUrl(databaseId: string, relativePath: string): string {
  const cleanPath = normalizeMediaPath(relativePath);
  return `idb-media://${databaseId}/${cleanPath}`;
}

export function parseIdbMediaUrl(url: string): { databaseId: string; path: string } | null {
  if (!url || typeof url !== 'string' || !url.startsWith('idb-media://')) {
    return null;
  }
  const withoutScheme = url.slice('idb-media://'.length);
  const firstSlash = withoutScheme.indexOf('/');
  if (firstSlash <= 0) return null;
  const databaseId = withoutScheme.slice(0, firstSlash).trim();
  const path = normalizeMediaPath(withoutScheme.slice(firstSlash + 1));
  if (!databaseId || !path) return null;
  return { databaseId, path };
}

function openMediaDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB não suportado neste ambiente.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('by_databaseId', 'databaseId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao abrir IndexedDB de mídia.'));
  });
}

export async function saveMediaBlobsBatch(
  databaseId: string,
  entries: Array<{ path: string; blob: Blob; mimeType: string }>
): Promise<void> {
  if (!entries || entries.length === 0) return;
  try {
    const db = await openMediaDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const now = Date.now();

      for (const entry of entries) {
        const normalizedPath = normalizeMediaPath(entry.path);
        if (!normalizedPath) continue;
        const record: StoredMediaBlobRecord = {
          key: `${databaseId}::${normalizedPath}`,
          databaseId,
          path: normalizedPath,
          blob: entry.blob,
          mimeType: entry.mimeType || entry.blob.type || 'application/octet-stream',
          createdAt: now,
        };
        store.put(record);
      }

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error('Falha ao salvar lote de mídias no IndexedDB.'));
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error('Transação de salvamento de mídia abortada.'));
      };
    });
  } catch (err) {
    console.warn('[mediaBlobStorage] Erro ao salvar blobs de mídia:', err);
  }
}

export async function getMediaBlob(databaseId: string, path: string): Promise<Blob | null> {
  if (!databaseId || !path) return null;
  try {
    const db = await openMediaDB();
    const normalizedPath = normalizeMediaPath(path);
    const key = `${databaseId}::${normalizedPath}`;

    return await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);

      req.onsuccess = () => {
        const result = req.result as StoredMediaBlobRecord | undefined;
        db.close();
        if (result && result.blob instanceof Blob) {
          resolve(result.blob);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch (err) {
    console.warn('[mediaBlobStorage] Erro ao ler blob de mídia:', err);
    return null;
  }
}

export async function deleteDatabaseMedia(databaseId: string): Promise<void> {
  if (!databaseId) return;
  try {
    const db = await openMediaDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      if (store.indexNames.contains('by_databaseId')) {
        const index = store.index('by_databaseId');
        const range = IDBKeyRange.only(databaseId);
        const cursorReq = index.openKeyCursor(range);
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            store.delete(cursor.primaryKey);
            cursor.continue();
          }
        };
      } else {
        const cursorReq = store.openCursor();
        const prefix = `${databaseId}::`;
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
              cursor.delete();
            }
            cursor.continue();
          }
        };
      }

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        resolve();
      };
    });
  } catch (err) {
    console.warn('[mediaBlobStorage] Erro ao excluir mídias do banco:', err);
  }
}
