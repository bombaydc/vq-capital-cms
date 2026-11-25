"use strict";

/**
 * Lead PII encryption at rest — AES-256-GCM.
 *
 * WHY THIS EXISTS
 * ---------------
 * Lead PII used to be stored as the RSA-4096 (PKCS#1 v1.5) ciphertext that the
 * browser produced. Node >= 20.11.1 blocks the native fast path for that padding
 * (CVE-2023-46809), so `node-forge` decrypts it in pure JS at ~345-530 ms per
 * field. The Leads Dashboard export decrypts 3 fields per lead on the main
 * thread, so 1,000 leads meant ~26 minutes with the whole event loop blocked —
 * i.e. the entire site down for the duration.
 *
 * AES-256-GCM decrypts the same field in ~0.017 ms (~31,000x faster) and is
 * *authenticated*, so tampering is detected rather than silently yielding junk.
 *
 * NOTHING CHANGES ON THE WIRE. The browser still RSA-encrypts with the public
 * key, and the form controller still RSA-decrypts on arrival — it already did
 * that to validate the payload and build the notification email. This module
 * only changes what gets written to the column.
 *
 * STORAGE FORMAT
 * --------------
 *   v2:<base64( iv[12] || authTag[16] || ciphertext )>
 *
 * The `v2:` prefix is what makes the migration safe: `readPii()` routes
 * prefixed values to AES and everything else to the legacy RSA path, so old and
 * new rows coexist with no downtime. Do not infer the scheme from length.
 *
 * KEY
 * ---
 * `LEADS_ENCRYPTION_KEY`, kept separate from `ENCRYPTION_KEY` (TOTP secrets) so
 * that compromising one does not expose the other. Derived with scrypt and
 * memoised — scrypt costs ~100 ms, and re-deriving per field would be slower
 * than the RSA path this replaces.
 */

// `node:` prefix is deliberate: package.json carries an npm package literally
// named "crypto", so the unprefixed specifier is ambiguous to readers even
// though Node resolves builtins first.
const crypto = require("node:crypto");
const { decrptRsa } = require("./encryption");

const VERSION_PREFIX = "v2:";
const IV_BYTES = 12;   // 96-bit nonce — the GCM standard
const TAG_BYTES = 16;  // 128-bit auth tag
// Per-project KDF salt. Changing it makes every stored lead PII value unreadable.
const KEY_SALT = "vq-capital:lead-pii-v2";

let cachedKey = null;

/**
 * Derive (once) the AES-256 key from LEADS_ENCRYPTION_KEY.
 *
 * Memoised deliberately: scrypt is intentionally expensive, and this is called
 * per field on the export path.
 *
 * @returns {Buffer} 32-byte key
 * @throws {Error} if LEADS_ENCRYPTION_KEY is not set
 */
function deriveKey() {
    if (cachedKey) return cachedKey;

    const secret = process.env.LEADS_ENCRYPTION_KEY;
    if (!secret) {
        throw new Error(
            "LEADS_ENCRYPTION_KEY environment variable is not set. " +
            "Lead PII cannot be encrypted or decrypted without it. " +
            "Generate one with: openssl rand -base64 32"
        );
    }
    cachedKey = crypto.scryptSync(secret, KEY_SALT, 32);
    return cachedKey;
}

/**
 * True if the value is in the AES (`v2:`) format.
 * @param {unknown} value
 * @returns {boolean}
 */
function isEncryptedPii(value) {
    return typeof value === "string" && value.startsWith(VERSION_PREFIX);
}

/**
 * Encrypt a plaintext PII value for storage.
 *
 * A fresh random IV per call is mandatory for GCM — reusing an IV with the same
 * key breaks the mode's confidentiality guarantees outright.
 *
 * @param {string|null|undefined} plaintext
 * @returns {string|null} `v2:`-prefixed blob, or null for empty input
 */
function encryptPii(plaintext) {
    if (plaintext === null || plaintext === undefined || plaintext === "") {
        return null;
    }

    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
    const ciphertext = Buffer.concat([
        cipher.update(String(plaintext), "utf8"),
        cipher.final(),
    ]);

    return VERSION_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

/**
 * Decrypt a `v2:` blob.
 *
 * Returns null rather than throwing for any failure — wrong key, truncated
 * blob, or a failed auth tag (tampering). Callers decide how to render that.
 *
 * @param {unknown} blob
 * @returns {string|null}
 */
function decryptPii(blob) {
    if (!isEncryptedPii(blob)) return null;

    try {
        const raw = Buffer.from(blob.slice(VERSION_PREFIX.length), "base64");
        if (raw.length <= IV_BYTES + TAG_BYTES) return null;

        const decipher = crypto.createDecipheriv(
            "aes-256-gcm",
            deriveKey(),
            raw.subarray(0, IV_BYTES)
        );
        decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));

        return Buffer.concat([
            decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
            decipher.final(),
        ]).toString("utf8");
    } catch {
        // Bad key, corrupt blob, or failed authentication.
        return null;
    }
}

/**
 * Read a stored PII value under either scheme.
 *
 * This is the single dual-read path used by the export and the migration
 * script, so the legacy branch only has to be retired in one place.
 *
 * @param {unknown} stored
 * @returns {string|null} plaintext, or null if it could not be read
 */
function readPii(stored) {
    if (stored === null || stored === undefined || stored === "") return null;
    if (isEncryptedPii(stored)) return decryptPii(stored);

    // Legacy RSA-4096 rows, pre-migration.
    //
    // Wrapped because decrptRsa() parses TOKEN_PRIVATE_FORM *outside* its own
    // try/catch, so a missing or malformed key throws rather than returning
    // null. Unhandled, that would abort a whole export part-way through instead
    // of rendering the affected cells as '-'. Fail closed, like decryptPii.
    try {
        return decrptRsa(stored);
    } catch {
        return null;
    }
}

module.exports = {
    encryptPii,
    decryptPii,
    readPii,
    isEncryptedPii,
    VERSION_PREFIX,
};
