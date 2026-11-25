'use strict';

/**
 * gcs-auth — shared GCP Storage authentication helper.
 *
 * Resolves @google-cloud/storage constructor options from three possible
 * credential sources, in priority order:
 *
 *   1. keyFilename  — path to a service account JSON key file on disk.
 *                     The file is read and parsed at call time so the
 *                     resulting `credentials` object is passed directly
 *                     to the SDK — no file-path coupling at runtime.
 *
 *   2. keyJson      — service account JSON already loaded as a string
 *                     (e.g. from GCS_KEY_JSON env var, a secrets manager,
 *                     or a container secret mount read elsewhere).
 *
 *   3. Neither      — Application Default Credentials (ADC).
 *                     Automatic on Cloud Run / GKE with Workload Identity;
 *                     also works locally when `gcloud auth application-default
 *                     login` has been run.
 *
 * Both (1) and (2) produce the same output shape: `{ credentials: { ... } }`.
 * This means the calling code never needs to distinguish between the two
 * sources — it always receives a plain credentials object.
 *
 * Used by:
 *   - src/providers/upload-gcs-secure.js  (upload provider)
 *   - src/index.js                        (CORS bootstrap)
 *
 * @param {object}  opts
 * @param {string} [opts.projectId]    GCP project ID (optional — ADC detects it)
 * @param {string} [opts.keyFilename]  Absolute path to service account JSON file
 * @param {string} [opts.keyJson]      Service account JSON as a string
 * @returns {object} Options object ready to pass to `new Storage(options)`
 */
function buildGcsStorageOptions({ projectId, keyFilename, keyJson } = {}) {
  const storageOptions = {};

  if (projectId) storageOptions.projectId = projectId;

  if (keyFilename) {
    // ── Source 1: key file — read + parse dynamically ─────────────────────
    const fs = require('fs');
    let raw;
    try {
      raw = fs.readFileSync(keyFilename, 'utf8');
    } catch (err) {
      throw new Error(
        `[gcs-auth] Cannot read service account key file "${keyFilename}": ${err.message}`
      );
    }
    try {
      storageOptions.credentials = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `[gcs-auth] Service account key file "${keyFilename}" is not valid JSON: ${err.message}`
      );
    }

  } else if (keyJson) {
    // ── Source 2: JSON string (env var / secrets manager) ─────────────────
    try {
      storageOptions.credentials = typeof keyJson === 'string'
        ? JSON.parse(keyJson)
        : keyJson; // already an object — pass through
    } catch (err) {
      throw new Error(
        `[gcs-auth] GCS_KEY_JSON is not valid JSON: ${err.message}`
      );
    }
  }
  // Source 3: neither set → ADC; no credentials key added to storageOptions

  return storageOptions;
}

module.exports = { buildGcsStorageOptions };
