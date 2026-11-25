'use strict';
const { optionalRequire } = require('../utils/optional-deps'); // on-demand SDKs — see src/utils/optional-deps.js

/**
 * upload-aws-s3-secure — VAPT Finding #3, Gap 2 (S3 variant).
 *
 * A Strapi 5 upload provider that wraps the AWS S3 SDK and sets
 * Content-Disposition dynamically per file at PutObject time, so that S3
 * returns the correct header on every GET — without any reverse proxy or
 * Lambda@Edge needed.
 *
 * Why not use @strapi/provider-upload-aws-s3 directly?
 *   The official provider's `actionOptions.upload` is resolved once at init()
 *   and is the same for every file.  Determining `inline` vs `attachment`
 *   requires knowing each file's MIME type at upload time, which only our
 *   wrapper can do.
 *
 * Behaviour:
 *   • Inline types (jpeg/png/gif/webp/avif/tiff + pdf/json/svg) →
 *       ContentDisposition: inline; filename*=UTF-8''<name>
 *   • Everything else (Office, video, audio, text, …) →
 *       ContentDisposition: attachment; filename*=UTF-8''<name>
 *     The inline set is owned by isInlineMime() in
 *     src/middlewares/upload-security.js — see there for the per-type rationale.
 *   • Private buckets (ACL: 'private'): the same logic is applied to
 *       ResponseContentDisposition in every GetObjectCommand (signed URL),
 *       so the browser honours it even for presigned requests.
 *
 * Configuration in config/plugins.js — see that file for the full example.
 *
 * Required env vars: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION,
 *                    AWS_BUCKET
 * Optional env vars: AWS_CDN_URL, AWS_ROOT_PATH, AWS_ACL,
 *                    AWS_SIGNED_URL_EXPIRES
 *
 * References: VAPT Finding #3, Gap 2
 */

const {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
} = optionalRequire('@aws-sdk/client-s3');
const { Upload }         = optionalRequire('@aws-sdk/lib-storage');
const { getSignedUrl: awsGetSignedUrl } = optionalRequire('@aws-sdk/s3-request-presigner');

const { isInlineMime } = require('../middlewares/upload-security');

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
  const filename = encodeURIComponent((file && file.name) || 'download');
  const disposition = isInlineMime(file?.mime) ? 'inline' : 'attachment';
  return `${disposition}; filename*=UTF-8''${filename}`;
}

// ── Provider factory ──────────────────────────────────────────────────────────

/**
 * Strapi provider `init` function.
 *
 * @param {object} providerOptions
 * @param {string}  [providerOptions.baseUrl]      CDN / CloudFront base URL
 * @param {string}  [providerOptions.rootPath]     Key prefix (e.g. 'uploads')
 * @param {object}   providerOptions.s3Options     Passed to S3Client + params
 * @param {object}   [providerOptions.s3Options.credentials]
 * @param {string}   [providerOptions.s3Options.region]
 * @param {string}   [providerOptions.s3Options.endpoint]  S3-compatible endpoint
 * @param {boolean}  [providerOptions.s3Options.forcePathStyle]
 * @param {object}   [providerOptions.s3Options.params]
 * @param {string}    providerOptions.s3Options.params.Bucket
 * @param {string}   [providerOptions.s3Options.params.ACL]
 * @param {number}   [providerOptions.s3Options.params.signedUrlExpires]  seconds
 */
module.exports = {
  init(providerOptions = {}) {
    const {
      baseUrl,
      rootPath,
      s3Options: {
        credentials,
        region,
        endpoint,
        forcePathStyle,
        params: {
          Bucket,
          ACL,
          signedUrlExpires = 15 * 60, // 15 minutes default
        } = {},
        ...restS3Options
      } = {},
    } = providerOptions;

    // Initialise the S3 client.  For S3-compatible services (Cloudflare R2,
    // MinIO, Scaleway…) supply `endpoint` + `forcePathStyle: true`.
    const s3Client = new S3Client({
      ...(credentials ? { credentials } : {}),
      ...(region     ? { region }      : {}),
      ...(endpoint   ? { endpoint, forcePathStyle: forcePathStyle ?? true } : {}),
      ...restS3Options,
    });

    const prefix = rootPath ? `${rootPath.replace(/\/$/, '')}/` : '';

    /** Compute the S3 object key for a Strapi file. */
    function getKey(file) {
      return `${prefix}${file.hash}${file.ext}`;
    }

    /** Build the public URL for a file. */
    function buildUrl(key, location) {
      if (baseUrl)   return `${baseUrl.replace(/\/$/, '')}/${key}`;
      if (location)  return location;
      return `https://${Bucket}.s3.${region}.amazonaws.com/${key}`;
    }

    /** Core PutObject logic shared by upload() and uploadStream(). */
    async function putObject(file, body) {
      const key = getKey(file);
      const uploadParams = {
        Bucket,
        Key:                key,
        Body:               body,
        ContentType:        file.mime,
        ContentDisposition: getContentDisposition(file),
        ...(ACL ? { ACL } : {}),
      };

      const uploader = new Upload({ client: s3Client, params: uploadParams });
      const result   = await uploader.done();
      file.url       = buildUrl(key, result.Location);
    }

    return {
      /** Upload a buffered file to S3 with the correct Content-Disposition. */
      async upload(file) {
        await putObject(file, file.buffer);
      },

      /** Upload a streaming file to S3 with the correct Content-Disposition. */
      async uploadStream(file) {
        await putObject(file, file.stream);
      },

      /** Remove an object from S3. */
      async delete(file) {
        const key = getKey(file);
        await s3Client.send(new DeleteObjectCommand({ Bucket, Key: key }));
      },

      /**
       * Returns true when the bucket uses private ACL, signalling to Strapi
       * that all file access must go through signed URLs.
       */
      async isPrivate() {
        return ACL === 'private';
      },

      /**
       * Generate a pre-signed GetObject URL.
       * ResponseContentDisposition is set so S3 returns the correct header
       * even for private-bucket requests that bypass our Koa middleware.
       *
       * @param {{ hash: string, ext: string, name: string, mime: string }} file
       * @param {object} [customParams]  Additional GetObjectCommand params
       * @returns {Promise<{ url: string }>}
       */
      async getSignedUrl(file, customParams = {}) {
        const key = getKey(file);
        const command = new GetObjectCommand({
          ...customParams,
          Bucket,
          Key:                        key,
          ResponseContentDisposition: getContentDisposition(file),
        });
        const url = await awsGetSignedUrl(s3Client, command, {
          expiresIn: signedUrlExpires,
        });
        return { url };
      },

      /**
       * Validate file size before upload.
       * @param {{ size: number, name: string }} file
       * @param {{ sizeLimit: number }} options
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

// Export helper for unit testing
module.exports.getContentDisposition = getContentDisposition;
