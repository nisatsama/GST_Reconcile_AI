import fs from 'node:fs';
import path from 'node:path';
import type { AuditLog } from '../../src/shared/types.ts';
import { createDemoSeedData, type StoreData } from '../seed/demoData.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'gst-reconcile-store.json');

let memoryStore: StoreData | null = null;

function persistToDisk(data: StoreData): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${STORE_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpFile, STORE_FILE);
  } catch (err) {
    console.warn('Could not persist store to disk, continuing in memory:', err);
  }
}

export function getStore(): StoreData {
  if (memoryStore) return memoryStore;
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as StoreData;
      if (parsed && parsed.workspace && Array.isArray(parsed.clients)) {
        memoryStore = parsed;
        return memoryStore;
      }
    }
  } catch (err) {
    console.warn('Failed to load persisted store file, regenerating demo seed:', err);
  }
  memoryStore = createDemoSeedData();
  persistToDisk(memoryStore);
  return memoryStore;
}

export function saveStore(updater?: (data: StoreData) => void): StoreData {
  const store = getStore();
  if (updater) {
    updater(store);
  }
  store.workspace.updatedAt = new Date().toISOString();
  persistToDisk(store);
  return store;
}

export function resetDemoStore(): StoreData {
  memoryStore = createDemoSeedData();
  persistToDisk(memoryStore);
  return memoryStore;
}

export function appendAuditLog(
  store: StoreData,
  entry: Omit<AuditLog, 'id' | 'createdAt'>
): AuditLog {
  const log: AuditLog = {
    ...entry,
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  store.auditLogs.unshift(log);
  return log;
}

export function assertClientOwnership(store: StoreData, clientId: string): boolean {
  return store.clients.some(
    (c) => c.id === clientId && c.workspaceId === store.workspace.id
  );
}
