#!/usr/bin/env node
"use strict";

/**
 * Migrate lead PII from RSA-4096 (PKCS#1 v1.5) to AES-256-GCM at rest.
 *
 *   node scripts/migrate-lead-pii.js --dry-run     # analyse, write nothing
 *   node scripts/migrate-lead-pii.js               # migrate
 *   node scripts/migrate-lead-pii.js --verify      # check the result, write nothing
 *   node scripts/migrate-lead-pii.js --limit 100   # cap rows (per table)
 *   node scripts/migrate-lead-pii.js --table lead_contacts
 *
 * WHY DIRECT SQL, NOT THE STRAPI DOCUMENT API
 * -------------------------------------------
 * Strapi 5 draft & publish stores TWO rows per document (a draft and a
 * published copy) — verified on this database: 13 documents = 26 rows in
 * lead_contacts. The Document API addresses documents, so writing through it
 * would leave the draft copies holding the old RSA ciphertext, and would also
 * fire lifecycle hooks and bump timestamps. This script rewrites rows by
 * primary key so every copy is converted and nothing else is touched.
 *
 * SAFETY
 * ------
 *   - Idempotent: rows already `v2:` are skipped, so re-running is harmless.
 *   - Resumable: progress is per row; interrupt and re-run to continue.
 *   - Per-row: one UPDATE per row inside a per-batch transaction. A single
 *     undecryptable value is recorded and skipped, never written as garbage.
 *   - Only ever writes a value it has already decrypted AND verified by
 *     decrypting the new blob back to the identical plaintext.
 *   - --dry-run performs every step except the UPDATE.
 *
 * SPEED
 * -----
 * The slow half is the legacy RSA decrypt (~345-530 ms/field, pure JS, since
 * Node >= 20.11.1 blocks the native PKCS#1 v1.5 path per CVE-2023-46809).
 * Budget roughly 1-1.5 s per lead. 1,000 leads is ~20-30 minutes. Run it
 * off-peak: it is CPU-bound and single-threaded.
 */

const path = require("path");
const readline = require("readline");

const PROJECT_ROOT = path.resolve(__dirname, "..");
require(path.join(PROJECT_ROOT, "node_modules/dotenv")).config({
    path: path.join(PROJECT_ROOT, ".env"),
    quiet: true,
});

const mysql = require(path.join(PROJECT_ROOT, "node_modules/mysql2/promise"));
const { encryptPii, decryptPii, isEncryptedPii } = require("../src/utility/pii-encryption");
const { decrptRsa } = require("../src/utility/encryption");

// ─── Tables and their PII columns ────────────────────────────────────────────
// Derived by scanning every text column in the schema for RSA-ciphertext-shaped
// values (>=600 chars, base64 alphabet) — not by reading the models, so a lead
// type added later cannot be silently missed. Re-run that scan if new lead
// collections appear.
const TARGETS = [
    { table: "lead_contacts", columns: ["name", "email", "mobile"] },
    { table: "lead_dealers", columns: ["name", "email", "mobile"] },
    { table: "lead_electricians", columns: ["name"] },
    { table: "lead_news_letters", columns: ["email"] },
];

const BATCH_SIZE = 50;

/**
 * Byte length of this key's RSA ciphertext (512 for RSA-4096). Used to tell
 * "this is RSA ciphertext that will not decrypt" apart from "this was never
 * RSA ciphertext" — node-forge reports those very differently, and so should we.
 */
function rsaCiphertextBytes() {
    try {
        const forge = require(path.join(PROJECT_ROOT, "node_modules/node-forge"));
        const key = forge.pki.privateKeyFromPem(process.env.TOKEN_PRIVATE_FORM);
        return Math.ceil(key.n.bitLength() / 8);
    } catch {
        return 512; // RSA-4096 default
    }
}
const RSA_BYTES = rsaCiphertextBytes();

/**
 * Classify a non-`v2:` stored value.
 *
 *   'rsa'     — decodes to exactly one RSA block; a decrypt failure here means a
 *               rotated key or corrupt ciphertext, and the plaintext is lost.
 *   'not-rsa' — anything else. In practice this is PII that was written in the
 *               clear: the electrician write path stored the raw submitted value
 *               whenever RSA decryption failed, so an unencrypted submission
 *               landed as readable text.
 *
 * @param {string} stored
 * @returns {'rsa'|'not-rsa'}
 */
function classifyLegacyValue(stored) {
    if (typeof stored !== "string") return "not-rsa";
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(stored)) return "not-rsa";
    return Buffer.from(stored, "base64").length === RSA_BYTES ? "rsa" : "not-rsa";
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => {
    const i = argv.indexOf(f);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
};

const DRY_RUN = has("--dry-run");
const VERIFY = has("--verify");
const YES = has("--yes");
const LIMIT = valueOf("--limit") ? parseInt(valueOf("--limit"), 10) : null;
const ONLY_TABLE = valueOf("--table");
// Opt-in: AES-encrypt values that were never RSA ciphertext (PII stored in the
// clear). Off by default so nothing is rewritten before you have looked at it.
const ENCRYPT_PLAINTEXT = has("--encrypt-plaintext");

const c = {
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/**
 * Minimal stand-in for Strapi's `env` helper, so config/database.js can be
 * evaluated outside a running Strapi.
 */
function makeEnvHelper() {
    const env = (key, def) => (process.env[key] === undefined ? def : process.env[key]);
    env.int = (key, def) => (process.env[key] === undefined ? def : parseInt(process.env[key], 10));
    env.float = (key, def) => (process.env[key] === undefined ? def : parseFloat(process.env[key]));
    env.bool = (key, def) => (process.env[key] === undefined ? def : process.env[key] === "true");
    env.json = (key, def) => (process.env[key] === undefined ? def : JSON.parse(process.env[key]));
    env.array = (key, def) => (process.env[key] === undefined ? def : String(process.env[key]).split(","));
    env.date = (key, def) => (process.env[key] === undefined ? def : new Date(process.env[key]));
    return env;
}

/**
 * Resolve the database connection from `config/database.js` — the same file
 * Strapi itself uses — rather than re-reading DATABASE_* here.
 *
 * This matters: that config sets `ssl: { rejectUnauthorized: false }`
 * unconditionally for MySQL. A user created with REQUIRE SSL rejects a
 * plaintext connection as "Access denied ... (using password: YES)", which
 * looks like a wrong password. Deriving from the config keeps this script in
 * step with the app for SSL and anything else that changes later.
 *
 * @returns {{ client: string, connection: object }}
 */
function resolveDbConfig() {
    const configFactory = require(path.join(PROJECT_ROOT, "config", "database.js"));
    const resolved = configFactory({ env: makeEnvHelper() });
    const { client, connection } = resolved.connection;
    return { client, connection };
}

async function connect() {
    const { client, connection } = resolveDbConfig();

    if (client !== "mysql" && client !== "mysql2") {
        throw new Error(
            `This migration only supports MySQL; config/database.js resolves DATABASE_CLIENT to "${client}".`
        );
    }

    return mysql.createConnection({
        host: connection.host,
        port: connection.port,
        user: connection.user,
        password: connection.password,
        database: connection.database,
        // Carried over from config/database.js — omitting it breaks REQUIRE SSL users.
        ...(connection.ssl ? { ssl: connection.ssl } : {}),
    });
}

function confirm(question) {
    if (YES) return Promise.resolve(true);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(question, (a) => {
            rl.close();
            resolve(/^y(es)?$/i.test(a.trim()));
        });
    });
}

function fmtDuration(ms) {
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${Math.round(s - m * 60)}s`;
}

// ─── Survey: what is out there, before touching anything ─────────────────────
async function survey(conn, targets) {
    const rows = [];
    for (const { table, columns } of targets) {
        const legacyExpr = columns
            .map((col) => `SUM(${col} IS NOT NULL AND ${col} NOT LIKE 'v2:%')`)
            .join(" + ");
        const v2Expr = columns
            .map((col) => `SUM(${col} LIKE 'v2:%')`)
            .join(" + ");

        const [[r]] = await conn.query(
            `SELECT COUNT(*) AS rows_total,
                    COUNT(DISTINCT document_id) AS documents,
                    COALESCE(${legacyExpr}, 0) AS legacy_fields,
                    COALESCE(${v2Expr}, 0) AS v2_fields
             FROM \`${table}\``
        );
        rows.push({
            table,
            columns,
            rowsTotal: Number(r.rows_total),
            documents: Number(r.documents),
            legacyFields: Number(r.legacy_fields),
            v2Fields: Number(r.v2_fields),
        });
    }
    return rows;
}

// ─── Migrate one table ───────────────────────────────────────────────────────
async function migrateTable(conn, table, columns, stats) {
    const cols = columns.join(", ");
    const where = columns.map((col) => `(${col} IS NOT NULL AND ${col} NOT LIKE 'v2:%')`).join(" OR ");

    const [rows] = await conn.query(
        `SELECT id, ${cols} FROM \`${table}\` WHERE ${where} ORDER BY id` +
        (LIMIT ? ` LIMIT ${LIMIT}` : "")
    );

    if (rows.length === 0) {
        console.log(`  ${c.green("nothing to do")} — every row is already v2:`);
        return;
    }

    console.log(`  ${rows.length} row(s) to convert ${c.dim(`(batch size ${BATCH_SIZE})`)}`);
    const started = Date.now();

    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
        const batch = rows.slice(offset, offset + BATCH_SIZE);
        if (!DRY_RUN) await conn.beginTransaction();

        try {
            for (const row of batch) {
                const updates = {};

                for (const col of columns) {
                    const stored = row[col];
                    if (stored === null || stored === "" || isEncryptedPii(stored)) continue;

                    const field = `${table}#${row.id}.${col}`;
                    const kind = classifyLegacyValue(stored);

                    // Not RSA ciphertext at all — almost always PII that was stored
                    // in the clear (the electrician form kept the raw value when
                    // decryption failed). There is nothing to decrypt: the stored
                    // value IS the plaintext, so it can be encrypted directly.
                    if (kind === "not-rsa") {
                        if (!ENCRYPT_PLAINTEXT) {
                            stats.plaintext.push(field);
                            continue;
                        }
                        const blob = encryptPii(stored);
                        if (decryptPii(blob) !== stored) {
                            stats.roundTripFailed.push(field);
                            continue;
                        }
                        updates[col] = blob;
                        stats.plaintextEncrypted.push(field);
                        continue;
                    }

                    const plaintext = decrptRsa(stored);
                    if (plaintext === null || plaintext === "") {
                        stats.undecryptable.push(field);
                        continue;
                    }

                    const blob = encryptPii(plaintext);

                    // Never write a blob we cannot read back to the exact input.
                    if (decryptPii(blob) !== plaintext) {
                        stats.roundTripFailed.push(`${table}#${row.id}.${col}`);
                        continue;
                    }

                    updates[col] = blob;
                }

                const keys = Object.keys(updates);
                if (keys.length === 0) continue;

                if (!DRY_RUN) {
                    await conn.query(
                        `UPDATE \`${table}\` SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
                        [...keys.map((k) => updates[k]), row.id]
                    );
                }
                stats.fieldsConverted += keys.length;
                stats.rowsConverted += 1;
            }

            if (!DRY_RUN) await conn.commit();
        } catch (err) {
            if (!DRY_RUN) await conn.rollback();
            throw err;
        }

        const done = Math.min(offset + BATCH_SIZE, rows.length);
        const elapsed = Date.now() - started;
        const eta = done < rows.length ? (elapsed / done) * (rows.length - done) : 0;
        process.stdout.write(
            `\r  ${done}/${rows.length} rows  ${c.dim(`elapsed ${fmtDuration(elapsed)}`)}` +
            (eta ? c.dim(`  eta ${fmtDuration(eta)}`) : "") + "   "
        );
    }
    process.stdout.write("\n");
}

// ─── Verify ──────────────────────────────────────────────────────────────────
async function verifyTable(conn, table, columns) {
    const cols = columns.join(", ");
    const [rows] = await conn.query(
        `SELECT id, ${cols} FROM \`${table}\`` + (LIMIT ? ` LIMIT ${LIMIT}` : "")
    );

    let v2 = 0, legacy = 0, empty = 0, unreadable = 0;
    for (const row of rows) {
        for (const col of columns) {
            const v = row[col];
            if (v === null || v === "") { empty++; continue; }
            if (isEncryptedPii(v)) {
                v2++;
                if (decryptPii(v) === null) unreadable++;
            } else {
                legacy++;
            }
        }
    }
    return { rows: rows.length, v2, legacy, empty, unreadable };
}

// ─── Main ────────────────────────────────────────────────────────────────────
(async () => {
    const mode = VERIFY ? "VERIFY" : DRY_RUN ? "DRY RUN" : "MIGRATE";
    console.log(c.bold(`\nLead PII encryption migration — ${mode}`));
    // Report what config/database.js actually resolved, not the raw env vars —
    // the two can differ, and that difference is exactly what goes wrong.
    const dbCfg = resolveDbConfig();
    console.log(c.dim(
        `  database: ${dbCfg.connection.database}@${dbCfg.connection.host}:${dbCfg.connection.port}` +
        ` user=${dbCfg.connection.user} ssl=${dbCfg.connection.ssl ? "on" : "off"}` +
        ` (from config/database.js)`
    ));

    // Fail before touching the DB if the key is missing or unusable.
    try {
        const probe = encryptPii("migration-self-test");
        if (decryptPii(probe) !== "migration-self-test") throw new Error("round-trip mismatch");
        console.log(c.dim("  key: LEADS_ENCRYPTION_KEY loaded, self-test OK"));
    } catch (err) {
        console.error(c.red(`\nFATAL: ${err.message}`));
        console.error("Set LEADS_ENCRYPTION_KEY in .env before running. Generate one with:");
        console.error("  openssl rand -base64 32\n");
        process.exit(1);
    }

    const targets = ONLY_TABLE ? TARGETS.filter((t) => t.table === ONLY_TABLE) : TARGETS;
    if (targets.length === 0) {
        console.error(c.red(`\nUnknown --table "${ONLY_TABLE}". Known: ${TARGETS.map((t) => t.table).join(", ")}\n`));
        process.exit(1);
    }

    const conn = await connect();
    try {
        if (VERIFY) {
            console.log("");
            let bad = 0;
            for (const { table, columns } of targets) {
                const r = await verifyTable(conn, table, columns);
                const ok = r.legacy === 0 && r.unreadable === 0;
                if (!ok) bad++;
                console.log(
                    `  ${ok ? c.green("OK  ") : c.yellow("WARN")} ${table.padEnd(20)}` +
                    `rows=${String(r.rows).padStart(5)}  v2=${String(r.v2).padStart(5)}  ` +
                    `legacy=${String(r.legacy).padStart(5)}  empty=${String(r.empty).padStart(4)}  ` +
                    `unreadable=${r.unreadable}`
                );
            }
            console.log(bad === 0
                ? c.green("\n  All PII is AES-encrypted and readable with the current key.\n")
                : c.yellow("\n  Some rows are still legacy or unreadable — see above.\n"));
            return;
        }

        const found = await survey(conn, targets);
        console.log("");
        let totalLegacy = 0;
        for (const s of found) {
            totalLegacy += s.legacyFields;
            console.log(
                `  ${s.table.padEnd(20)} rows=${String(s.rowsTotal).padStart(5)} ` +
                `${c.dim(`(${s.documents} docs x2 for draft+published)`)}  ` +
                `legacy fields=${String(s.legacyFields).padStart(5)}  already v2=${s.v2Fields}`
            );
        }

        if (totalLegacy === 0) {
            console.log(c.green("\n  Nothing to migrate — all PII is already AES-encrypted.\n"));
            return;
        }

        const estMs = totalLegacy * 450;
        console.log(
            `\n  ${c.bold(String(totalLegacy))} field(s) to convert, ` +
            `estimated ${c.bold(fmtDuration(estMs))} ${c.dim("(RSA decrypt is the bottleneck)")}`
        );

        if (DRY_RUN) console.log(c.yellow("\n  DRY RUN — no rows will be written.\n"));
        else {
            console.log(c.yellow("\n  This rewrites PII columns in place. Take a database backup first.\n"));
            if (!(await confirm("  Proceed? (yes/no) "))) {
                console.log("  Aborted.\n");
                return;
            }
            console.log("");
        }

        const stats = {
            rowsConverted: 0, fieldsConverted: 0,
            undecryptable: [], roundTripFailed: [],
            plaintext: [], plaintextEncrypted: [],
        };
        const t0 = Date.now();

        for (const { table, columns } of targets) {
            console.log(c.bold(`\n  ${table}`));
            await migrateTable(conn, table, columns, stats);
        }

        console.log(c.bold("\n  Summary"));
        console.log(`    rows ${DRY_RUN ? "that would be" : ""} converted : ${stats.rowsConverted}`);
        console.log(`    fields ${DRY_RUN ? "that would be" : ""} converted: ${stats.fieldsConverted}`);
        console.log(`    elapsed                  : ${fmtDuration(Date.now() - t0)}`);

        if (stats.plaintextEncrypted.length) {
            console.log(c.green(`\n    ${stats.plaintextEncrypted.length} field(s) held UNENCRYPTED PII and are now AES-encrypted:`));
            stats.plaintextEncrypted.slice(0, 10).forEach((f) => console.log(`      ${f}`));
            if (stats.plaintextEncrypted.length > 10) console.log(`      ... and ${stats.plaintextEncrypted.length - 10} more`);
        }

        if (stats.plaintext.length) {
            console.log(c.yellow(`\n    ${stats.plaintext.length} field(s) are NOT RSA ciphertext — almost certainly PII stored in the clear:`));
            stats.plaintext.slice(0, 10).forEach((f) => console.log(`      ${f}`));
            if (stats.plaintext.length > 10) console.log(`      ... and ${stats.plaintext.length - 10} more`);
            console.log(c.dim("    Nothing to decrypt — the stored value IS the plaintext, so it is readable"));
            console.log(c.dim("    by anyone with database access. Encrypt them with:"));
            console.log(c.dim("      node scripts/migrate-lead-pii.js --encrypt-plaintext"));
        }

        if (stats.undecryptable.length) {
            console.log(c.yellow(`\n    ${stats.undecryptable.length} field(s) are valid RSA ciphertext that will not decrypt — left untouched:`));
            stats.undecryptable.slice(0, 10).forEach((f) => console.log(`      ${f}`));
            if (stats.undecryptable.length > 10) console.log(`      ... and ${stats.undecryptable.length - 10} more`);
            console.log(c.dim("    A rotated TOKEN_PRIVATE_FORM or corrupt data. The plaintext is not"));
            console.log(c.dim("    recoverable with the current key; these render as '-' in exports."));
        }
        if (stats.roundTripFailed.length) {
            console.log(c.red(`\n    ${stats.roundTripFailed.length} field(s) failed the AES round-trip check and were NOT written.`));
            stats.roundTripFailed.slice(0, 10).forEach((f) => console.log(`      ${f}`));
        }

        console.log(DRY_RUN
            ? c.dim("\n  Dry run complete. Re-run without --dry-run to apply.\n")
            : c.green("\n  Migration complete. Verify with: node scripts/migrate-lead-pii.js --verify\n"));
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error(c.red(`\nMigration failed: ${err.message}`));

    // MySQL reports an SSL-required user, a host-grant mismatch and a genuinely
    // wrong password with the *same* "Access denied" code, so spell out what to
    // check rather than leaving it looking like a bad password.
    if (err.code === "ER_ACCESS_DENIED_ERROR" || /Access denied/i.test(err.message || "")) {
        let cfg = null;
        try { cfg = resolveDbConfig(); } catch { /* config itself unreadable */ }
        console.error(c.yellow("\n  This is a connection problem, not a data problem — nothing was written."));
        if (cfg) {
            console.error(
                `  Tried: user=${cfg.connection.user} host=${cfg.connection.host}:${cfg.connection.port} ` +
                `db=${cfg.connection.database} ssl=${cfg.connection.ssl ? "on" : "off"}`
            );
        }
        console.error("\n  Check, in this order:");
        console.error("    1. Is the grant host-specific? The error shows the IP the DB saw you connect FROM.");
        console.error("       Compare it against:  SELECT user, host FROM mysql.user WHERE user = '<user>';");
        console.error("    2. Does the user REQUIRE SSL? MySQL reports that as 'Access denied' too.");
        console.error("       config/database.js sets ssl for MySQL, and this script now uses that same setting.");
        console.error("    3. Are DATABASE_* the values this shell actually sees? If the app is run by");
        console.error("       pm2/systemd with injected env vars, a plain shell will not have them:");
        console.error("         pm2 env <id>        # or:  systemctl show <unit> -p Environment");
        console.error("    4. Does the password contain '#' or quotes? Check how it is quoted in .env.\n");
    } else {
        console.error(err.stack);
    }
    process.exit(1);
});
