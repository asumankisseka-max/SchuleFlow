import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_BUCKET = 'schuleflow-media';
const MAX_MEDIA_BYTES = 3 * 1024 * 1024; // 3 MB

const MIME_EXT_MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

let ensuredBucketName: string | null = null;

function isAnonOrPublishableKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('sb_publishable_')) return true;
  if (trimmed.startsWith('sb_secret_')) return false;
  const parts = trimmed.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
        role?: string;
      };
      if (payload?.role && payload.role !== 'service_role' && payload.role !== 'supabase_admin') {
        return true;
      }
    } catch {
      // Unparseable JWT; let Supabase client validate
    }
  }
  return false;
}

function resolveSupabaseCredentials(): {
  url: string;
  key: string;
  bucket: string;
  hasServiceRole: boolean;
} | null {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
  ).trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anonKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();
  const key = serviceKey || anonKey;
  const bucket = (process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET).trim();

  if (!url || !key) return null;
  return {
    url,
    key,
    bucket,
    hasServiceRole: Boolean(serviceKey && !isAnonOrPublishableKey(serviceKey)),
  };
}

function getSupabaseAdminClient(): {
  client: SupabaseClient;
  bucket: string;
  hasServiceRole: boolean;
} | null {
  const creds = resolveSupabaseCredentials();
  if (!creds) return null;
  const client = createClient(creds.url, creds.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { client, bucket: creds.bucket, hasServiceRole: creds.hasServiceRole };
}

export function isSupabaseStorageConfigured(): {
  configured: boolean;
  bucket: string;
  urlOrigin?: string;
} {
  const creds = resolveSupabaseCredentials();
  if (!creds || !creds.hasServiceRole) {
    return {
      configured: false,
      bucket: (process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET).trim(),
    };
  }
  let urlOrigin: string | undefined;
  try {
    urlOrigin = new URL(creds.url).origin;
  } catch {
    urlOrigin = undefined;
  }
  return {
    configured: true,
    bucket: creds.bucket,
    urlOrigin,
  };
}

async function ensureBucketExists(client: SupabaseClient, bucket: string): Promise<void> {
  if (ensuredBucketName === bucket) return;
  const { data: buckets, error: listErr } = await client.storage.listBuckets();
  if (!listErr && Array.isArray(buckets) && buckets.some((b) => b.name === bucket)) {
    ensuredBucketName = bucket;
    return;
  }

  const { error: createErr } = await client.storage.createBucket(bucket, {
    public: true,
    fileSizeLimit: MAX_MEDIA_BYTES,
    allowedMimeTypes: Object.keys(MIME_EXT_MAP),
  });
  if (createErr && !createErr.message.toLowerCase().includes('already exists')) {
    // Non-fatal if bucket already exists or anon key lacks createBucket rights; upload will verify
    console.warn(`Supabase storage bucket check warning (${bucket}):`, createErr.message);
  } else {
    ensuredBucketName = bucket;
  }
}

export function parseBase64ImageDataUrl(dataUrl: string): {
  mimeType: string;
  ext: string;
  buffer: Buffer;
} {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error('Invalid image payload. Expected a base64-encoded PNG, JPEG, or WebP image.');
  }
  const mimeType = match[1].toLowerCase();
  const ext = MIME_EXT_MAP[mimeType];
  if (!ext) {
    throw new Error(`Unsupported image type "${mimeType}". Use PNG, JPEG, or WebP.`);
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) {
    throw new Error('Uploaded image file is empty.');
  }
  if (buffer.length > MAX_MEDIA_BYTES) {
    throw new Error('Image exceeds the 3 MB upload limit.');
  }
  return { mimeType, ext, buffer };
}

export function isInlineDataImageUrl(value: string | null | undefined): boolean {
  return Boolean(value && value.trim().startsWith('data:image/'));
}

export async function uploadMediaToSupabase(params: {
  schoolId: string;
  folder: 'logos' | 'students';
  entityId?: string;
  dataUrl: string;
  strictSupabase?: boolean;
  supabaseClientOverride?: SupabaseClient;
}): Promise<{
  url: string;
  storage: 'supabase' | 'inline';
  path?: string;
  warning?: string;
}> {
  const { schoolId, folder, entityId, dataUrl, strictSupabase = false, supabaseClientOverride } =
    params;

  // Already a remote URL (e.g., already stored in Supabase)
  if (!isInlineDataImageUrl(dataUrl)) {
    if (/^https?:\/\//i.test(dataUrl.trim())) {
      return { url: dataUrl.trim(), storage: 'supabase' };
    }
    throw new Error('Media value must be a valid image data URL or HTTPS URL.');
  }

  const trimmedDataUrl = dataUrl.trim();
  const parsed = parseBase64ImageDataUrl(trimmedDataUrl);
  const supa = supabaseClientOverride
    ? {
        client: supabaseClientOverride,
        bucket: (process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET).trim(),
        hasServiceRole: true,
      }
    : getSupabaseAdminClient();

  if (!supa || (!supa.hasServiceRole && !strictSupabase)) {
    return { url: trimmedDataUrl, storage: 'inline' };
  }

  if (!supa.hasServiceRole && strictSupabase) {
    throw new Error(
      'Supabase Storage requires SUPABASE_SERVICE_ROLE_KEY (secret service_role key, not the anon/publishable key) to bypass storage RLS policies.'
    );
  }

  const safeSchool = schoolId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeEntity = (entityId || `${folder}-${Date.now()}`)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
  const objectPath = `schools/${safeSchool}/${folder}/${safeEntity}-${Date.now()}.${parsed.ext}`;

  try {
    await ensureBucketExists(supa.client, supa.bucket);

    const { error: uploadErr } = await supa.client.storage
      .from(supa.bucket)
      .upload(objectPath, parsed.buffer, {
        contentType: parsed.mimeType,
        cacheControl: '31536000',
        upsert: true,
      });

    if (uploadErr) {
      const msg = uploadErr.message || 'Unknown storage error';
      const isRls = msg.toLowerCase().includes('row-level security');
      if (!strictSupabase) {
        console.warn(
          `Supabase Storage upload failed (${msg}); falling back to inline PostgreSQL media storage.`
        );
        return { url: trimmedDataUrl, storage: 'inline', warning: msg };
      }
      if (isRls) {
        throw new Error(
          'Supabase Storage upload blocked by Row-Level Security (RLS). Ensure SUPABASE_SERVICE_ROLE_KEY is set to the project service_role key (not anon/publishable).'
        );
      }
      throw new Error(`Supabase Storage upload failed: ${msg}`);
    }

    const { data: pubData } = supa.client.storage.from(supa.bucket).getPublicUrl(objectPath);
    if (!pubData?.publicUrl) {
      if (!strictSupabase) {
        return { url: trimmedDataUrl, storage: 'inline' };
      }
      throw new Error('Supabase Storage did not return a public URL for uploaded media.');
    }

    return {
      url: pubData.publicUrl,
      storage: 'supabase',
      path: objectPath,
    };
  } catch (err: unknown) {
    if (!strictSupabase) {
      const msg = err instanceof Error ? err.message : 'Supabase Storage unavailable';
      console.warn(
        `Supabase Storage exception (${msg}); falling back to inline PostgreSQL media storage.`
      );
      return { url: trimmedDataUrl, storage: 'inline', warning: msg };
    }
    throw err;
  }
}

export async function deleteMediaFromSupabaseByUrl(
  mediaUrl: string | null | undefined
): Promise<void> {
  if (!mediaUrl || isInlineDataImageUrl(mediaUrl)) return;
  const supa = getSupabaseAdminClient();
  if (!supa) return;

  const marker = `/storage/v1/object/public/${supa.bucket}/`;
  const idx = mediaUrl.indexOf(marker);
  if (idx === -1) return;

  const objectPath = decodeURIComponent(mediaUrl.slice(idx + marker.length).split('?')[0]);
  if (!objectPath) return;

  const { error } = await supa.client.storage.from(supa.bucket).remove([objectPath]);
  if (error) {
    console.warn('Supabase media delete warning:', error.message);
  }
}
