import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function resolveFirebaseProjectId(): string | undefined {
  const envProjectId =
    process.env.FIREBASE_PROJECT_ID?.trim() || process.env.VITE_FIREBASE_PROJECT_ID?.trim();
  if (envProjectId) {
    return envProjectId;
  }

  const candidates: Array<string | URL> = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
  ];
  if (typeof import.meta !== 'undefined' && import.meta.url) {
    candidates.unshift(new URL('../../firebase-applet-config.json', import.meta.url));
  }

  for (const candidate of candidates) {
    try {
      if (typeof candidate === 'string' && !existsSync(candidate)) continue;
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { projectId?: string };
      if (parsed.projectId) {
        return parsed.projectId;
      }
    } catch {
      // Ignore missing config file in serverless bundles using environment config
    }
  }

  return undefined;
}

if (!getApps().length) {
  const projectId = resolveFirebaseProjectId();
  initializeApp(projectId ? { projectId } : undefined);
}

export const adminAuth = getAuth();
