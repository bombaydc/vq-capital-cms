'use strict';
const { optionalRequire } = require('../utils/optional-deps'); // on-demand SDKs — see src/utils/optional-deps.js

/**
 * upload-gcs-secure — VAPT Finding #3, Gap 2 (GCS variant).
 *
 * A Strapi 5 upload provider that wraps the official @google-cloud/storage SDK
 * and sets Content-Disposition dynamically per file at object-creation time,
 * so that GCS returns the correct header on every GET — without any reverse
 * proxy or Cloud CDN rewrite needed.
 *
 * Why a custom provider instead of @strapi-community/strapi-provider-upload-google-cloud-storage?
 *   The community provider sets a single static Content-Disposition for all files.
 *   Determining `inline` vs `attachment` requires knowing each file's MIME type
 *   at upload time, which only our custom wrapper can do correctly.
 *
 * Behaviour:
 *   • Inline types (jpeg/png/gif/webp/avif/tiff + pdf/json/svg) →
 *       contentDisposition metadata: inline; filename*=UTF-8''<name>
 *   • Everything else (Office, video, audio, text, …) →
 *       contentDisposition metadata: attachment; filename*=UTF-8''<name>
 *     The inline set is owned by isInlineMime() in
 *     src/middlewares/upload-security.js — see there for the per-type rationale.
 *   • Private buckets (uniformAccess: true): the same logic is applied to
 *       responseDisposition in every V4 signed URL, so the browser honours it
 *       even for presigned requests that bypass our Koa middleware.
 *
 * Auth strategy (checked in order):
 *   1. GCS_KEY_FILE_PATH env var → keyFilename option to Storage constructor
 *   2. GCS_KEY_JSON env var      → credentials option (JSON string, for containers
 *                                   and secrets managers)
 *   3. Neither                   → Application Default Credentials (ADC) —
 *                                   automatic for Cloud Run / GKE with Workload
 *                                   Identity (no config required)
 *
 * Configuration in config/plugins.js — see that file for the full example.
 *
 * Required env vars: GCS_BUCKET
 * Optional env vars: GCS_PROJECT_ID, GCS_KEY_FILE_PATH, GCS_KEY_JSON,
 *                    GCS_CDN_URL, GCS_ROOT_PATH, GCS_UNIFORM_ACCESS,
 *                    GCS_SIGNED_URL_EXPIRES
 *
 * References: VAPT Finding #3, Gap 2 (Phase 16 — GCS variant)
 */

const { Storage } = optionalRequire('@google-cloud/storage');

const { isInlineMime }           = require('../middlewares/upload-security');
const { buildGcsStorageOptions } = require('../utils/gcs-auth');

// ── Content-Disposition helper ────────────────────────────────────────────────

/**
 * Compute the RFC 6266 Content-Disposition value for a Strapi file object.
 *
 * Inline types are served inline so the browser can display them directly
 * (images in <img> tags, PDFs in the built-in viewer, JSON as text) without a
 * download prompt. Everything else forces a download, preventing the browser
 * from rendering untrusted content.
 *
 * Uses the RFC 5987 `filename*` parameter for correct UTF-8 filename encoding.
 *
 * @param {{ name?: string, mime?: string }} file - Strapi file object
 * @returns {string}  e.g. 'attachment; filename*=UTF-8\'\'report.docx'
 */
function getContentDisposition(file) {
  const filename    = encodeURIComponent((file && file.name) || 'download');
  const disposition = isInlineMime(file?.mime) ? 'inline' : 'attachment';
  return `${disposition}; filename*=UTF-8''${filename}`;
}

/** Strip trailing slashes safely without regex backtracking */
function trimTrailingSlash(str) {
  if (!str || typeof str !== 'string') return '';
  let end = str.length;
  while (end > 0 && str.codePointAt(end - 1) === 47 /* '/' */) {
    end -= 1;
  }
  return str.slice(0, end);
}

// ── Provider factory ──────────────────────────────────────────────────────────

/**
 * Strapi provider `init` function.
 *
 * @param {object}  providerOptions
 * @param {string}   providerOptions.bucket           GCS bucket name (required)
 * @param {string}  [providerOptions.projectId]       GCP project ID
 * @param {string}  [providerOptions.keyFilename]     Path to SA JSON key file
 * @param {string}  [providerOptions.keyJson]         SA JSON as a string
 * @param {string}  [providerOptions.baseUrl]         Cloud CDN base URL
 * @param {string}  [providerOptions.rootPath]        Object key prefix
 * @param {boolean} [providerOptions.uniformAccess]   Default true — treat bucket
 *                                                    as private (IAM-only access)
 * @param {number}  [providerOptions.signedUrlExpires] Signed URL TTL in seconds
 */
module.exports = {
  init(providerOptions = {}) {
    const {
      bucket:           bucketName,
      projectId,
      keyFilename,
      keyJson,
      baseUrl,
      rootPath,
      uniformAccess    = true,
      signedUrlExpires = 900,
    } = providerOptions;

    if (!bucketName) {
      throw new Error('[upload-gcs-secure] providerOptions.bucket is required');
    }

    // ── Build Storage constructor options ─────────────────────────────────────
    //
    // Auth priority (handled by buildGcsStorageOptions):
    //   1. keyFilename  → read + parse JSON file at runtime → credentials object
    //   2. keyJson      → parse JSON string → credentials object
    //   3. neither      → ADC (Cloud Run / GKE with Workload Identity — no config needed)
    //
    // Both (1) and (2) resolve to the same `credentials` shape so the SDK
    // never receives a raw file path — credentials are always loaded in-process.
    const storageOptions = buildGcsStorageOptions({ projectId, keyFilename, keyJson });

    const storage = new Storage(storageOptions);
    const bucket  = storage.bucket(bucketName);

    const prefix  = rootPath ? `${trimTrailingSlash(rootPath)}/` : '';


    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Compute the GCS object key for a Strapi file. */
    function getKey(file) {
      return `${prefix}${file.hash}${file.ext}`;
    }

    /** Build the public URL for a file. */
    function buildUrl(key) {
      if (baseUrl) return `${trimTrailingSlash(baseUrl)}/${key}`;
      return `https://storage.googleapis.com/${bucketName}/${key}`;
    }


    /**
     * Shared upload options: ContentType + Content-Disposition metadata.
     * `public: true` is only set when bucket uses legacy per-object ACLs.
     */
    function uploadOptions(file) {
      return {
        contentType: file.mime,
        metadata:    { contentDisposition: getContentDisposition(file) },
        // When uniformAccess is false the bucket still uses per-object ACLs;
        // make newly uploaded objects publicly readable.
        ...(uniformAccess ? {} : { public: true }),
      };
    }

    // ── Provider interface ────────────────────────────────────────────────────

    return {
      /**
       * Upload a buffered file to GCS with the correct Content-Disposition.
       * Sets file.url to the public (or CDN) URL after upload.
       *
       * @param {{ hash: string, ext: string, name: string, mime: string,
       *            buffer: Buffer }} file
       */
      async upload(file) {
        const key     = getKey(file);
        const gcsFile = bucket.file(key);
        await gcsFile.save(file.buffer, uploadOptions(file));
        file.url = buildUrl(key);
      },

      /**
       * Upload a streaming file to GCS with the correct Content-Disposition.
       * Sets file.url to the public (or CDN) URL after upload.
       *
       * @param {{ hash: string, ext: string, name: string, mime: string,
       *            stream: NodeJS.ReadableStream }} file
       */
      async uploadStream(file) {
        const key     = getKey(file);
        const gcsFile = bucket.file(key);

        await new Promise((resolve, reject) => {
          const writeStream = gcsFile.createWriteStream(uploadOptions(file));
          file.stream
            .on('error', reject)
            .pipe(writeStream)
            .on('error',  reject)
            .on('finish', resolve);
        });

        file.url = buildUrl(key);
      },

      /**
       * Delete a file from GCS.
       * `ignoreNotFound: true` prevents errors when the object was already removed.
       *
       * @param {{ hash: string, ext: string }} file
       */
      async delete(file) {
        const key = getKey(file);
        await bucket.file(key).delete({ ignoreNotFound: true });
      },

      /**
       * Returns true when the bucket is private (uniform IAM access).
       * Strapi uses this flag to decide whether to generate signed URLs.
       *
       * @returns {Promise<boolean>}
       */
      async isPrivate() {
        // Treat uniformAccess bucket as private — all access via signed URLs.
        // When uniformAccess is explicitly false the bucket uses per-object ACLs
        // and files are uploaded as public-read, so signed URLs are not needed.
        return uniformAccess === true || uniformAccess === 'true';
      },

      /**
       * Generate a V4 signed URL for a private-bucket file.
       * responseDisposition is set so GCS returns the correct Content-Disposition
       * header even for requests that bypass our Koa middleware.
       *
       * @param {{ hash: string, ext: string, name: string, mime: string }} file
       * @param {object} [customParams]  Additional getSignedUrl options (version,
       *                                 action, and expires are always set by us)
       * @returns {Promise<{ url: string }>}
       */
      async getSignedUrl(file, customParams = {}) {
        const key = getKey(file);
        const [url] = await bucket.file(key).getSignedUrl({
          ...customParams,
          version:             'v4',
          action:              'read',
          expires:             Date.now() + signedUrlExpires * 1000,
          responseDisposition: getContentDisposition(file),
        });
        return { url };
      },

      /**
       * Validate file size before upload.
       *
       * @param {{ size: number, name: string }} file
       * @param {{ sizeLimit: number }}          options
       */
      async checkFileSize(file, { sizeLimit }) {
        if (sizeLimit && file.size > sizeLimit) {
          throw new Error(
            `File "${file.name}" exceeds the maximum allowed size of ${sizeLimit} bytes.`
          );
        }
      },
    };
  },
};

// Export helper for unit testing (same pattern as upload-aws-s3-secure.js)
module.exports.getContentDisposition = getContentDisposition;
