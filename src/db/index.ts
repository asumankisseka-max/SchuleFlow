import fs from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

type PostgresClient = ReturnType<typeof postgres>;
type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

declare global {
  var _postgresClient: PostgresClient | undefined;
  var _postgresUsingFallback: boolean | undefined;
  var _drizzleDbInstance: DrizzleDb | undefined;
}

function buildUrlClient(directUrl: string): PostgresClient {
  const isLocal =
    directUrl.includes('localhost') ||
    directUrl.includes('127.0.0.1') ||
    directUrl.includes('host=/');

  const poolMax = Math.max(10, Math.min(100, Number(process.env.DB_POOL_MAX) || 25));

  return postgres(directUrl, {
    prepare: false,
    max: poolMax,
    idle_timeout: 20,
    max_lifetime: 1800,
    connect_timeout: 10,
    ssl: isLocal ? false : 'require',
  });
}

function buildSqlHostClient(): PostgresClient | null {
  const host = process.env.SQL_HOST?.trim();
  const user = process.env.SQL_USER?.trim();
  const password = process.env.SQL_PASSWORD?.trim();
  const database = process.env.SQL_DB_NAME?.trim();

  if (!host || !user || !database) {
    return null;
  }

  const isLocalOrSocket =
    host.startsWith('/') || host === 'localhost' || host === '127.0.0.1';

  const poolMax = Math.max(10, Math.min(100, Number(process.env.DB_POOL_MAX) || 25));

  return postgres({
    host,
    user,
    password,
    database,
    prepare: false,
    max: poolMax,
    idle_timeout: 20,
    max_lifetime: 1800,
    connect_timeout: 10,
    ssl: isLocalOrSocket ? false : 'require',
  });
}

function hasAvailableSqlHost(): boolean {
  const host = process.env.SQL_HOST?.trim();
  const user = process.env.SQL_USER?.trim();
  const database = process.env.SQL_DB_NAME?.trim();
  if (!host || !user || !database) return false;
  if (host.startsWith('/')) {
    return fs.existsSync(host);
  }
  return true;
}

export const createClient = (): PostgresClient => {
  if (!global._postgresClient) {
    const directUrl = process.env.DATABASE_URL?.trim();

    if (directUrl) {
      global._postgresClient = buildUrlClient(directUrl);
      global._postgresUsingFallback = false;
    } else {
      const sqlHostClient = buildSqlHostClient();
      if (!sqlHostClient) {
        throw new Error('DATABASE_URL or SQL_HOST/SQL_USER/SQL_DB_NAME must be configured.');
      }
      global._postgresClient = sqlHostClient;
      global._postgresUsingFallback = true;
    }
  }
  return global._postgresClient;
};

const initialClient = createClient();
if (!global._drizzleDbInstance) {
  global._drizzleDbInstance = drizzle(initialClient, { schema });
}

export async function ensureReachableDbConnection(): Promise<void> {
  const activeClient = createClient();
  try {
    await activeClient.unsafe('SELECT 1');
  } catch (err: unknown) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code ?? '')
        : '';
    const isNetworkFailure = [
      'CONNECT_TIMEOUT',
      'ETIMEDOUT',
      'ENETUNREACH',
      'ECONNREFUSED',
      'ENOTFOUND',
      'EHOSTUNREACH',
      'EAI_AGAIN',
    ].includes(code);

    if (!global._postgresUsingFallback && isNetworkFailure && hasAvailableSqlHost()) {
      const fallbackClient = buildSqlHostClient();
      if (fallbackClient) {
        console.warn(
          `Primary DATABASE_URL unreachable (${code || 'network error'}); falling back to SQL_HOST.`
        );
        await activeClient.end({ timeout: 1 }).catch(() => undefined);
        global._postgresClient = fallbackClient;
        global._postgresUsingFallback = true;
        global._drizzleDbInstance = drizzle(fallbackClient, { schema });
        await fallbackClient.unsafe('SELECT 1');
        return;
      }
    }
    throw err;
  }
}

export const db: DrizzleDb = new Proxy({} as DrizzleDb, {
  get(_target, prop) {
    const instance = global._drizzleDbInstance!;
    const value = Reflect.get(instance as unknown as Record<PropertyKey, unknown>, prop, instance);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});

export async function closeDbPool(): Promise<void> {
  if (global._postgresClient) {
    await global._postgresClient.end({ timeout: 2 }).catch(() => undefined);
    global._postgresClient = undefined;
    global._drizzleDbInstance = undefined;
  }
}
