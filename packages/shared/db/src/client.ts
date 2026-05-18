/**
 * Singleton PrismaClient for the whole monorepo.
 *
 * Why singleton: PrismaClient opens a connection pool, and a fresh
 * client per import would exhaust the SQLite/Postgres connection limit
 * almost immediately. The instance is cached on `globalThis` so
 * hot-reload tools (node --watch, vitest, bun --watch) do not
 * accumulate clients across reloads.
 *
 * The cached symbol is namespaced (`__strongTowerPrismaClient__`) so
 * other libraries that also cache a Prisma client on `globalThis`
 * (a common pattern) cannot collide with ours.
 */

import { PrismaClient } from '../prisma-client/index.js';

const CACHE_KEY = '__strongTowerPrismaClient__';

type GlobalWithPrisma = typeof globalThis & {
  [CACHE_KEY]?: PrismaClient;
};

const g = globalThis as GlobalWithPrisma;

export const prisma: PrismaClient =
  g[CACHE_KEY] ??
  new PrismaClient({
    log:
      process.env['NODE_ENV'] === 'production'
        ? ['error', 'warn']
        : ['error', 'warn'],
  });

if (process.env['NODE_ENV'] !== 'production') {
  g[CACHE_KEY] = prisma;
}

/**
 * Explicitly disconnect the singleton. Tests call this in teardown so
 * the process exits cleanly; long-running services normally let the
 * connection pool close on process exit.
 */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  if (g[CACHE_KEY] === prisma) {
    delete g[CACHE_KEY];
  }
}

export type { PrismaClient };
