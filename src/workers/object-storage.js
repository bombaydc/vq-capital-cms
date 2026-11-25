'use strict';
const { optionalRequire } = require('../utils/optional-deps'); // on-demand SDKs — see src/utils/optional-deps.js

/**
 * object-storage — provider-agnostic object writer for worker-side data sync.
 *
 * Writes an arbitrary object (e.g. a pre-rendered JSON file) to whichever cloud
 * bucket is configured, using the SAME selection priority as the Strapi upload
 * provider in config/plugins.js:
 *
 *     GCS_BUCKET set  → Google Cloud Storage   (highest priority)
 *     AWS_BUCKET set  → AWS S3                  (fallback)
 *     neither         → Local filesystem       (public/uploads/data/*)
 *
 * Local mode mirrors the Strapi upload provider's local fallback: the JSON is
 * written under public/uploads/<key> and served by Strapi's static middleware
 * at ${STRAPI_API_BASE}/uploads/<key>. This keeps the worker functional when
 * no cloud bucket is configured (e.g. local dev).
 *
 * This runs inside the search-indexer worker thread, so it relies only on
 * process.env (populated from workerData.env in src/index.js) and never touches
 * the global `strapi` object.
 *
 * GCS auth mirrors the upload provider exactly (src/utils/gcs-auth.js):
 *     1. GCS_KEY_FILE_PATH → service account JSON key file
 *     2. GCS_KEY_JSON      → service account JSON string
 *     3. neither           → Application Default Credentials (ADC) — automatic
 *                            on GCP (Cloud Run / GKE / Compute Engine)
 *
 * S3 auth keeps the worker's existing env convention (AWS_ACCESS_SECRET) with a
 * fallback to the project-standard AWS_SECRET_ACCESS_KEY.
 */

const fs   = require('fs');
const path = require('path');
const { buildGcsStorageOptions } = require('../utils/gcs-auth');

/**
 * Treat an env var as "set" only when it is a non-empty string that is not the
 * literal "undefined"/"null".
 *
 * Why this matters: worker threads receive env via workerData and then run
 * `Object.assign(process.env, workerData.env)`. process.env coerces every value
 * to a string, so an undefined source var becomes the STRING "undefined" — which
 * is truthy. Without this guard, an unset GCS_BUCKET would wrongly select GCS.
 *
 * @param {unknown} v
 * @returns {boolean}
 */
function isSet(v) {
  if (typeof v !== 'string') return false;
  const t = v.trim();
  return t !== '' && t !== 'undefined' && t !== 'null';
}

/** Strip trailing slashes safely without regex backtracking. */
function trimTrailingSlash(str) {
  if (!str || typeof str !== 'string') return '';
  let end = str.length;
  while (end > 0 && str.codePointAt(end - 1) === 47 /* '/' */) {
    end -= 1;
  }
  return str.slice(0, end);
}


/** Return the env var value if genuinely set, otherwise undefined. */
function envOr(name) {
  return isSet(process.env[name]) ? process.env[name] : undefined;
}

/**
 * Resolve the active storage provider from env (GCS → S3 → local).
 * Always returns a usable provider; 'local' is the zero-config fallback.
 * @returns {'gcs'|'s3'|'local'}
 */
function getProvider() {
  if (isSet(process.env.GCS_BUCKET)) return 'gcs';
  if (isSet(process.env.AWS_BUCKET)) return 's3';
  return 'local';
}

/**
 * Upload to Google Cloud Storage.
 * @param {{ key: string, body: string|Buffer, contentType: string }} params
 * @returns {Promise<{ provider: 'gcs', bucket: string, key: string, url: string }>}
 */
async function putToGcs({ key, body, contentType }) {
  const { Storage } = optionalRequire('@google-cloud/storage');

  const bucketName = process.env.GCS_BUCKET.trim();
  // envOr() converts the worker's "undefined" string back to a real undefined so
  // ADC kicks in when no key file/JSON is configured (instead of trying to read
  // a file literally named "undefined").
  const storageOptions = buildGcsStorageOptions({
    projectId:   envOr('GCS_PROJECT_ID'),
    keyFilename: envOr('GCS_KEY_FILE_PATH'),
    keyJson:     envOr('GCS_KEY_JSON'),
  });

  // Uniform bucket-level access (default true) → no per-object ACL allowed.
  // Legacy ACL buckets (GCS_UNIFORM_ACCESS=false) → mark the object public-read.
  const uniformAccess = (envOr('GCS_UNIFORM_ACCESS') ?? 'true') !== 'false';

  const storage = new Storage(storageOptions);
  const file = storage.bucket(bucketName).file(key);

  await file.save(body, {
    resumable: false,
    contentType,
    metadata: { contentType },
    ...(uniformAccess ? {} : { public: true }),
  });

  const cdn  = envOr('GCS_CDN_URL');
  const base = cdn
    ? trimTrailingSlash(cdn)
    : `https://storage.googleapis.com/${bucketName}`;

  return { provider: 'gcs', bucket: bucketName, key, url: `${base}/${key}` };
}

/**
 * Upload to AWS S3.
 * @param {{ key: string, body: string|Buffer, contentType: string }} params
 * @returns {Promise<{ provider: 's3', bucket: string, key: string, url: string }>}
 */
async function putToS3({ key, body, contentType }) {
  const { S3Client, PutObjectCommand } = optionalRequire('@aws-sdk/client-s3');

  const region = process.env.AWS_REGION?.trim();
  const bucket = process.env.AWS_BUCKET?.trim();
  // Worker convention is AWS_ACCESS_SECRET; fall back to the project-standard name.
  const secretAccessKey = (process.env.AWS_ACCESS_SECRET || process.env.AWS_SECRET_ACCESS_KEY)?.trim();

  const s3 = new S3Client({
    region,
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID?.trim(),
      secretAccessKey,
    },
  });

  await s3.send(new PutObjectCommand({
    Bucket:      bucket,
    Key:         key,
    Body:        body,
    ContentType: contentType,
    ACL:         process.env.AWS_ACL?.trim() || 'public-read',
  }));

  const cdn  = envOr('AWS_CDN_URL');
  const base = cdn
    ? trimTrailingSlash(cdn)
    : `https://${bucket}.s3.${region}.amazonaws.com`;

  return { provider: 's3', bucket, key, url: `${base}/${key}` };
}

/**
 * Write to the local filesystem under public/uploads (zero-config fallback).
 *
 * The public dir comes from STRAPI_PUBLIC_DIR (strapi.dirs.static.public, passed
 * in by src/lifecycle/search-sync.js), because this file runs from dist/src/workers
 * in the compiled TS app where a __dirname-relative path would land in dist/.
 * Fallback: the project root found by walking up past dist/. Strapi's static middleware serves
 * the public/ directory, so a key of 'data/home.json' is reachable at
 * ${STRAPI_API_BASE}/uploads/data/home.json.
 *
 * @param {{ key: string, body: string|Buffer }} params
 * @returns {Promise<{ provider: 'local', bucket: string, key: string, url: string }>}
 */
function resolvePublicDir() {
  const fromEnv = envOr('STRAPI_PUBLIC_DIR');
  if (fromEnv) return fromEnv;
  // src/workers → ../.. ; dist/src/workers → ../../..
  const up = __dirname.split(path.sep).includes('dist') ? '../../..' : '../..';
  return path.resolve(__dirname, up, 'public');
}

async function putToLocal({ key, body }) {
  const uploadsDir = path.join(resolvePublicDir(), 'uploads');
  const destPath   = path.join(uploadsDir, key);

  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  await fs.promises.writeFile(destPath, body);

  const base = trimTrailingSlash(envOr('STRAPI_API_BASE') || '');
  const url  = base ? `${base}/uploads/${key}` : `/uploads/${key}`;

  return { provider: 'local', bucket: uploadsDir, key, url };
}


/**
 * Write an object to the active store (GCS → S3 → local).
 *
 * @param {object} params
 * @param {string} params.key                 Object key, e.g. 'data/home.json'
 * @param {string|Buffer} params.body         Object body
 * @param {string} [params.contentType]       MIME type (default application/octet-stream)
 * @returns {Promise<{ provider: 'gcs'|'s3'|'local', bucket: string, key: string, url: string }>}
 */
async function putObject({ key, body, contentType = 'application/octet-stream' }) {
  const provider = getProvider();
  if (provider === 'gcs') return putToGcs({ key, body, contentType });
  if (provider === 's3')  return putToS3({ key, body, contentType });
  return putToLocal({ key, body });
}

module.exports = { putObject, getProvider };
