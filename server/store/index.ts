/**
 * Order storage. Three interchangeable back ends:
 *   blobs   Netlify Blobs — used automatically when deployed on Netlify
 *   file    JSON files in .data/orders — local development
 *   memory  in-process map — tests
 */
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ServerEnv } from '../env';
import type { OrderRecord } from '../types';

export interface OrderStore {
  kind: 'blobs' | 'file' | 'memory';
  /** Stores a new order. Resolves false when the id is already taken. */
  create(order: OrderRecord): Promise<boolean>;
  get(id: string): Promise<OrderRecord | null>;
  /**
   * Atomic read-modify-write. `mutate` gets a private copy and returns the
   * next version, or null to leave the order untouched. Resolves with the
   * order as stored after the call (or null if it does not exist).
   */
  update(id: string, mutate: (order: OrderRecord) => OrderRecord | null): Promise<OrderRecord | null>;
  list(limit?: number): Promise<OrderRecord[]>;
}

const clone = <T>(v: T): T => structuredClone(v);
const byNewest = (a: OrderRecord, b: OrderRecord): number => (a.createdAt < b.createdAt ? 1 : -1);

/* ------------------------------------------------------------------ memory */

export class MemoryStore implements OrderStore {
  kind = 'memory' as const;
  private map = new Map<string, OrderRecord>();

  async create(order: OrderRecord): Promise<boolean> {
    if (this.map.has(order.id)) return false;
    this.map.set(order.id, clone(order));
    return true;
  }
  async get(id: string): Promise<OrderRecord | null> {
    const o = this.map.get(id);
    return o ? clone(o) : null;
  }
  async update(id: string, mutate: (order: OrderRecord) => OrderRecord | null): Promise<OrderRecord | null> {
    const cur = this.map.get(id);
    if (!cur) return null;
    const next = mutate(clone(cur));
    if (next) this.map.set(id, clone(next));
    return clone(this.map.get(id)!);
  }
  async list(limit = 100): Promise<OrderRecord[]> {
    return [...this.map.values()].map(clone).sort(byNewest).slice(0, limit);
  }
}

/* -------------------------------------------------------------------- file */

/** One JSON file per order. Writes are serialised per order inside the process. */
export class FileStore implements OrderStore {
  kind = 'file' as const;
  private dir: string;
  private queues = new Map<string, Promise<unknown>>();

  constructor(dataDir: string) {
    this.dir = path.resolve(dataDir, 'orders');
  }

  private file(id: string): string {
    // ids are validated before they get here; keep the path safe regardless
    return path.join(this.dir, id.replace(/[^A-Za-z0-9-]/g, '') + '.json');
  }
  private async read(id: string): Promise<OrderRecord | null> {
    try {
      return JSON.parse(await readFile(this.file(id), 'utf8')) as OrderRecord;
    } catch {
      return null;
    }
  }
  private async write(order: OrderRecord, exclusive: boolean): Promise<boolean> {
    await mkdir(this.dir, { recursive: true });
    const file = this.file(order.id);
    const body = JSON.stringify(order, null, 2);
    if (exclusive) {
      try {
        await writeFile(file, body, { flag: 'wx' });
        return true;
      } catch {
        return false;
      }
    }
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, file);
    return true;
  }
  private lock<T>(id: string, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(id) ?? Promise.resolve();
    const run = prev.then(task, task);
    const tail = run.catch(() => undefined);
    this.queues.set(id, tail);
    void tail.then(() => {
      if (this.queues.get(id) === tail) this.queues.delete(id);
    });
    return run;
  }

  create(order: OrderRecord): Promise<boolean> {
    return this.lock(order.id, () => this.write(order, true));
  }
  get(id: string): Promise<OrderRecord | null> {
    return this.read(id);
  }
  update(id: string, mutate: (order: OrderRecord) => OrderRecord | null): Promise<OrderRecord | null> {
    return this.lock(id, async () => {
      const cur = await this.read(id);
      if (!cur) return null;
      const next = mutate(clone(cur));
      if (!next) return cur;
      await this.write(next, false);
      return next;
    });
  }
  async list(limit = 100): Promise<OrderRecord[]> {
    let names: string[] = [];
    try {
      names = (await readdir(this.dir)).filter(n => n.endsWith('.json'));
    } catch {
      return [];
    }
    const all = await Promise.all(names.map(n => this.read(n.replace(/\.json$/, ''))));
    return all.filter((o): o is OrderRecord => !!o).sort(byNewest).slice(0, limit);
  }
}

/* ------------------------------------------------------------------- blobs */

const BLOB_STORE = 'nightwntr-orders';

/** Netlify Blobs with strong consistency and compare-and-swap updates. */
export class BlobsStore implements OrderStore {
  kind = 'blobs' as const;

  private async store() {
    const { getStore } = await import('@netlify/blobs');
    return getStore({ name: BLOB_STORE, consistency: 'strong' });
  }

  async create(order: OrderRecord): Promise<boolean> {
    const s = await this.store();
    const res = await s.setJSON(order.id, order, { onlyIfNew: true });
    return res.modified;
  }
  async get(id: string): Promise<OrderRecord | null> {
    const s = await this.store();
    return (await s.get(id, { type: 'json' })) as OrderRecord | null;
  }
  async update(id: string, mutate: (order: OrderRecord) => OrderRecord | null): Promise<OrderRecord | null> {
    const s = await this.store();
    for (let attempt = 0; attempt < 6; attempt++) {
      const cur = await s.getWithMetadata(id, { type: 'json' });
      if (!cur || !cur.data) return null;
      const next = mutate(clone(cur.data as OrderRecord));
      if (!next) return cur.data as OrderRecord;
      if (!cur.etag) {
        await s.setJSON(id, next);
        return next;
      }
      const res = await s.setJSON(id, next, { onlyIfMatch: cur.etag });
      if (res.modified) return next;
      // someone else wrote in between: read again and re-apply
    }
    throw new Error(`could not update order ${id}: too many concurrent writes`);
  }
  async list(limit = 100): Promise<OrderRecord[]> {
    const s = await this.store();
    const { blobs } = await s.list();
    // keys start with NW-YYMMDD, so a reverse sort puts the newest days first
    const keys = blobs.map(b => b.key).sort().reverse().slice(0, limit);
    const all = await Promise.all(keys.map(k => s.get(k, { type: 'json' }) as Promise<OrderRecord | null>));
    return all.filter((o): o is OrderRecord => !!o).sort(byNewest);
  }
}

/* ----------------------------------------------------------------- factory */

let shared: { key: string; store: OrderStore } | null = null;

const onNetlify = (): boolean =>
  typeof (globalThis as { Netlify?: unknown }).Netlify !== 'undefined' || !!process.env.NETLIFY_BLOBS_CONTEXT || !!process.env.NETLIFY;

export function getOrderStore(env: ServerEnv): OrderStore {
  const kind = env.orderStore ?? (onNetlify() ? 'blobs' : 'file');
  const key = `${kind}:${env.dataDir}`;
  if (shared && shared.key === key) return shared.store;
  const store = kind === 'blobs' ? new BlobsStore() : kind === 'memory' ? new MemoryStore() : new FileStore(env.dataDir);
  shared = { key, store };
  return store;
}
