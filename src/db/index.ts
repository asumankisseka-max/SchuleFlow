import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

type PostgresClient = ReturnType<typeof postgres>;

declare global {
  var _postgresClient: PostgresClient | undefined;
}

function resolveConnectionUrl(): string {
  const directUrl = process.env.DATABASE_URL?.trim();
  if (directUrl) {
    return directUrl;
  }

  const host = process.env.SQL_HOST?.trim();
  const user = process.env.SQL_USER?.trim();
  const password = process.env.SQL_PASSWORD?.trim();
  const database = process.env.SQL_DB_NAME?.trim();

  if (host && user && database) {
    const encodedUser = encodeURIComponent(user);
    const encodedPass = password ? `:${encodeURIComponent(password)}` : '';
    if (host.startsWith('/')) {
      return `postgres://${encodedUser}${encodedPass}@localhost/${encodeURIComponent(database)}?host=${encodeURIComponent(host)}`;
    }
    return `postgres://${encodedUser}${encodedPass}@${host}/${encodeURIComponent(database)}`;
  }

  throw new Error('DATABASE_URL must be set to connect to PostgreSQL / Supabase.');
}

export const createClient = (): PostgresClient => {
  if (!global._postgresClient) {
    const connectionString = resolveConnectionUrl();
    const isLocal =
      connectionString.includes('localhost') ||
      connectionString.includes('127.0.0.1') ||
      connectionString.includes('host=/');

    global._postgresClient = postgres(connectionString, {
      prepare: false,
      max: 10,
      connect_timeout: 15,
      ssl: isLocal ? false : 'require',
    });
  }
  return global._postgresClient;
};

const client = createClient();

export const db = drizzle(client, { schema });
