import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const sqlHost = process.env.SQL_HOST?.trim();
const sqlDbName = process.env.SQL_DB_NAME?.trim();
const sqlAdminUser = process.env.SQL_ADMIN_USER?.trim();
const sqlAdminPassword = process.env.SQL_ADMIN_PASSWORD?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

const dbCredentials =
  sqlHost && sqlDbName && sqlAdminUser && sqlAdminPassword
    ? {
        host: sqlHost,
        user: sqlAdminUser,
        password: sqlAdminPassword,
        database: sqlDbName,
        ssl: false as const,
      }
    : databaseUrl
      ? { url: databaseUrl }
      : null;

if (!dbCredentials) {
  throw new Error('DATABASE_URL or SQL_HOST/SQL_ADMIN_USER/SQL_DB_NAME must be set.');
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials,
  verbose: true,
});
