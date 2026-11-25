'use strict';

const path = require('path');
const { Worker } = require('worker_threads');
const { sharedBuffer, syncFlag, changedUids } = require('../workers/sync-flag');
const jsonRoutes = require('../workers/json-routes');
const { optionalRequire } = require('../utils/optional-deps');

/**
 * Configures the GCS bucket CORS policy on startup so that the browser can
 * load images/media directly from GCS (avoids "CORS header missing" errors).
 *
 * Uses setCorsConfiguration() from @google-cloud/storage.  Only runs when
 * GCS_BUCKET is set.  Any failure is logged and swallowed — the CORS update
 * is non-fatal; the Strapi server starts regardless.
 *
 * Auth: inherits the same auth strategy as the upload provider (keyFilename,
 * keyJson, or ADC) so no extra credentials are needed.
 */
async function ensureGcsCorsPolicy(strapi) {
  const bucket = process.env.GCS_BUCKET;
  if (!bucket) return; // no GCS bucket configured — nothing to do

  let Storage;
  try {
    ({ Storage } = optionalRequire('@google-cloud/storage'));
  } catch (err) {
    strapi.log.warn(`[GCS CORS] ${err.message} — skipping CORS bootstrap`);
    return;
  }

  // Determine the allowed origins.
  // In production set APP_URL/PUBLIC_URL to restrict to your domain.
  // Falls back to '*' so local and staging environments work without extra config.
  const appUrl  = process.env.APP_URL || process.env.PUBLIC_URL || '';
  const origins = appUrl
    ? [appUrl, 'http://localhost:1337', 'http://127.0.0.1:1337']
    : ['*'];

  // Build Storage constructor options using the same shared helper as the
  // upload provider — ensures auth behaviour is identical in both places.
  const { buildGcsStorageOptions } = require('../utils/gcs-auth');
  const storageOptions = buildGcsStorageOptions({
    projectId:   process.env.GCS_PROJECT_ID,
    keyFilename: process.env.GCS_KEY_FILE_PATH,
    keyJson:     process.env.GCS_KEY_JSON,
  });

  try {
    const storage   = new Storage(storageOptions);
    const gcsBucket = storage.bucket(bucket);
    await gcsBucket.setCorsConfiguration([{
      origin:         origins,
      method:         ['GET', 'HEAD'],
      responseHeader: ['Content-Type', 'Content-Disposition', 'ETag', 'Content-Length'],
      maxAgeSeconds:  86400, // 24 h browser cache for preflight results
    }]);
    strapi.log.info(
      `[GCS CORS] CORS policy applied to bucket "${bucket}" ` +
      `(origins: ${origins.join(', ')})`
    );
  } catch (err) {
    // Non-fatal — log and continue server startup.
    strapi.log.warn(
      `[GCS CORS] Failed to apply CORS policy to bucket "${bucket}": ${err.message}`
    );
  }
}

/**
 * Configures the S3 bucket CORS policy on startup so that the browser can
 * load images/media directly from S3 (avoids "CORS header missing" errors).
 *
 * Uses PUT-then-verify so we only make an API call when the bucket is
 * configured via AWS_BUCKET env var.  Any failure is logged and swallowed —
 * the CORS update is non-fatal; the Strapi server starts regardless.
 */
async function ensureS3CorsPolicy(strapi) {
  const bucket = process.env.AWS_BUCKET;
  if (!bucket) return; // no S3 bucket configured — nothing to do

  let S3Client, PutBucketCorsCommand;
  try {
    ({ S3Client, PutBucketCorsCommand } = optionalRequire('@aws-sdk/client-s3'));
  } catch (err) {
    strapi.log.warn(`[S3 CORS] ${err.message} — skipping CORS bootstrap`);
    return;
  }

  const region = process.env.AWS_REGION || 'us-east-1';

  // Determine the allowed origins.
  // In production set APP_URL/PUBLIC_URL to restrict to your domain.
  // Falls back to '*' so local and staging environments work without extra config.
  const appUrl  = process.env.APP_URL || process.env.PUBLIC_URL || '';
  const origins = appUrl ? [appUrl, 'http://localhost:1337', 'http://127.0.0.1:1337'] : ['*'];

  const corsConfig = {
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          // Allow the browser to fetch images/media from S3 directly.
          AllowedMethods: ['GET', 'HEAD'],
          AllowedOrigins: origins,
          AllowedHeaders: ['*'],
          ExposeHeaders: ['ETag', 'Content-Disposition', 'Content-Type', 'Content-Length'],
          MaxAgeSeconds: 86400, // 24 h browser cache for preflight results
        },
      ],
    },
  };

  try {
    const client = new S3Client({ region });
    await client.send(new PutBucketCorsCommand(corsConfig));
    strapi.log.info(
      `[S3 CORS] CORS policy applied to bucket "${bucket}" ` +
      `(origins: ${origins.join(', ')})`
    );
  } catch (err) {
    // Non-fatal — log and continue server startup.
    strapi.log.warn(
      `[S3 CORS] Failed to apply CORS policy to bucket "${bucket}": ${err.message}`
    );
  }
}


/**
 * Worker Manager
 * Manages the background worker thread for search indexing.
 */
let searchWorker = null;

function getOrCreateWorker() {
  if (searchWorker) return searchWorker;

  // Build the worker env whitelist. IMPORTANT: drop undefined/null entries.
  // process.env coerces every value to a string, so passing `undefined` would
  // become the literal string "undefined" inside the worker — making unset vars
  // like GCS_BUCKET look "set" and wrongly selecting the GCS provider.
  const rawWorkerEnv = {
    // ── AWS S3 (used when AWS_BUCKET is set and GCS_BUCKET is not) ──────
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_ACCESS_SECRET: process.env.AWS_ACCESS_SECRET,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: process.env.AWS_REGION,
    AWS_BUCKET: process.env.AWS_BUCKET,
    AWS_ACL: process.env.AWS_ACL,
    AWS_CDN_URL: process.env.AWS_CDN_URL,
    // ── GCP Cloud Storage (takes priority over S3 when GCS_BUCKET is set) ─
    GCS_BUCKET: process.env.GCS_BUCKET,
    GCS_PROJECT_ID: process.env.GCS_PROJECT_ID,
    GCS_KEY_FILE_PATH: process.env.GCS_KEY_FILE_PATH,
    GCS_KEY_JSON: process.env.GCS_KEY_JSON,
    GCS_CDN_URL: process.env.GCS_CDN_URL,
    GCS_ROOT_PATH: process.env.GCS_ROOT_PATH,
    GCS_UNIFORM_ACCESS: process.env.GCS_UNIFORM_ACCESS,
    MEILI_ENABLE: process.env.MEILI_ENABLE || false,
    MEILI_HOST: process.env.MEILI_HOST,
    MEILI_API_KEY: process.env.MEILI_API_KEY,
    STRAPI_API_BASE: process.env.STRAPI_API_BASE,
    STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN,
  };
  const workerEnv = Object.fromEntries(
    Object.entries(rawWorkerEnv).filter(([, v]) => v !== undefined && v !== null)
  );

  // public/ dir from Strapi itself — the worker may run from src/ or dist/src/
  // (TS build), so it must not derive the uploads path from its own __dirname.
  workerEnv.STRAPI_PUBLIC_DIR = strapi.dirs.static.public;

  // Resolved next to this file: dist/src/workers in the compiled TS app,
  // src/workers when run from source — works whether or not src/ is deployed.
  searchWorker = new Worker(path.join(__dirname, '..', 'workers', 'search-indexer.js'), {
    workerData: {
      sharedBuffer,
      env: workerEnv
    }
  });

  // Listen for messages from the worker
  searchWorker.on('message', (msg) => {
    if (msg.status === 'error') {
      strapi.log.info(`[Search Worker Error] ${msg.model}: ${msg.error}`);
    } else if (msg.status === 'success') {
      strapi.log.info(`[Search Worker] Successfully processed ${msg.model} (ID: ${msg?.documentId})`);
      if (msg.model) changedUids.add(msg.model);
    }
  });

  searchWorker.on('error', (err) => {
    //console.error('[Search Worker] Thread crashed:', err);
    strapi.log.error('[Search Worker] Thread crashed:', err);
    // Reset worker so it restarts on next call
    searchWorker = null;
  });
  //console.log('[Global Search Sync] Background worker thread initialized.');
  strapi.log.info('[Global Search Sync] Background worker thread initialized.');
  return searchWorker;
}

/**
 * Helper to check if the request originated from the Admin Panel
 * 1. Checks if request context exists (excludes cron/bootstrap scripts)
 * 2. Checks if auth strategy is 'admin' (excludes REST/GraphQL API)
 */
function isAdminRequest() {
  const ctx = strapi.requestContext.get();
  return ctx?.state?.auth?.strategy?.name === 'admin';
}

/**
 * Helper: Sanitize Payload for Worker
 * Strips out functions and non-serializable data to prevent DataCloneError.
 */
function sanitizePayload(payload) {
  try {
    // JSON.stringify automatically removes functions and symbols, making the object safe for postMessage.
    return JSON.parse(JSON.stringify(payload));
  } catch (error) {
    strapi.log.warn(`[Search Sync] Failed to sanitize payload for ${payload?.modelName}: ${error.message}`);
    // Return a simplified version if deep cloning fails (e.g. circular refs)
    return {
      action: payload.action,
      modelName: payload.modelName,
      data: payload?.data ? { documentId: payload.data.documentId } : null, // Minimal data fallback
      params: null
    };
  }
}

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }) {
    strapi.documents.use(async (ctx, next) => {
      // 1. Run the default Strapi logic first (save to DB)
      const result = await next();

      try {
        // 2. Filter: Only 'api::' models and only Admin requests
        // Only content types that have a JSON snapshot route (workers/json-routes.js).
        const modelName = ctx.uid.split('.')[1];
        if (ctx.uid.startsWith('api::') && jsonRoutes[modelName] && isAdminRequest()) {

          // 3. Identify the action
          // Document Service actions are: 'create', 'update', 'delete', 'publish', 'unpublish', 'discardDraft'
          const allowedActions = ['create', 'update', 'delete', 'publish', 'unpublish'];

          if (allowedActions.includes(ctx.action)) {
            getOrCreateWorker().postMessage(sanitizePayload({
              action: ctx.action,      // e.g., 'publish', 'create'
              modelName: ctx.uid,      // e.g., 'api::article.article'
              data: result,            // The full document returned by Strapi
              params: ctx.params       // Filters/data passed to the call
            }));
          }
        }
      } catch (err) {
        strapi.log.error(`[Search Middleware Error] ${err.message}`);
      }

      // 4. Always return the result so the API response is not blocked/modified
      return result;
    });
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }) {
     // 1. Initialize the worker immediately
    getOrCreateWorker();
    strapi.log.info('[Global Search Sync] Document Service Middleware registered.');
    // Apply GCS bucket CORS policy (runs when GCS_BUCKET is set).
    await ensureGcsCorsPolicy(strapi);
    // Apply S3 bucket CORS policy (runs when AWS_BUCKET is set).
    await ensureS3CorsPolicy(strapi);
  },
};
