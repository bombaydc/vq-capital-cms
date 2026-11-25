#!/usr/bin/env node
"use strict";

/**
 * Reset an account's two-factor (TOTP) setup. Asks for the email address and
 * nothing else.
 *
 *   node scripts/reset-totp.js                        # prompts for the email
 *   node scripts/reset-totp.js --email a@b.com        # skip the prompt
 *   node scripts/reset-totp.js --email a@b.com --yes  # skip the confirmation too
 *   node scripts/reset-totp.js --list                 # who currently has a secret
 *   node scripts/reset-totp.js --email a@b.com --dry-run
 *
 * WHAT "RESET" MEANS
 * ------------------
 * The account's row in erp_step_up_secrets is deleted. The next login sees no
 * secret, so the panel shows the QR / setup screen again instead of asking for
 * a code. The old authenticator entry stops working immediately — tell the
 * user to delete it from their app.
 *
 * Active sessions are revoked as well (skip with --keep-sessions). Resetting
 * the second factor while a half-authenticated session is still alive would
 * leave that session holding admin access with no second factor behind it.
 *
 * WHY DIRECT SQL, NOT THE STRAPI DOCUMENT API
 * -------------------------------------------
 * This has to work when the panel is exactly what is broken — an admin locked
 * out of 2FA cannot reach any endpoint that would fix it. Running against the
 * database means the script works whether Strapi is up or down, and needs no
 * credentials beyond the ones already in .env.
 *
 * WHAT THIS SCRIPT CANNOT CLEAR
 * -----------------------------
 * The failed-attempt rate limiter (_failCounters in services/step-up.js) and
 * the post-login gate (services/admin-login-totp.js) both live in the running
 * Node process, not the database. After five bad codes a user stays rate
 * limited for the configured window even once the secret is gone; restart
 * Strapi to clear it immediately.
 */

const path = require("path");
const readline = require("readline");
const crypto = require("crypto");

const PROJECT_ROOT = path.resolve(__dirname, "..");
require(path.join(PROJECT_ROOT, "node_modules/dotenv")).config({
    path: path.join(PROJECT_ROOT, ".env"),
    quiet: true,
});

const mysql = require(path.join(PROJECT_ROOT, "node_modules/mysql2/promise"));

const SECRETS_TABLE = "erp_step_up_secrets";
const AUDIT_TABLE = "erp_session_audit_logs";
const ERP_SESSIONS_TABLE = "erp_sessions";
const STRAPI_SESSIONS_TABLE = "strapi_sessions";

// ─── CLI args ────────────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);

function argValue(...names) {
    for (const name of names) {
        const i = ARGV.indexOf(name);
        if (i !== -1 && ARGV[i + 1] && !ARGV[i + 1].startsWith("-")) return ARGV[i + 1];
        const inline = ARGV.find((a) => a.startsWith(`${name}=`));
        if (inline) return inline.slice(name.length + 1);
    }
    return null;
}

const EMAIL_ARG = argValue("--email", "-e");
const YES = ARGV.includes("--yes") || ARGV.includes("-y");
const DRY_RUN = ARGV.includes("--dry-run");
const KEEP_SESSIONS = ARGV.includes("--keep-sessions");
const LIST = ARGV.includes("--list");
const HELP = ARGV.includes("--help") || ARGV.includes("-h");

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
 * Strapi itself uses — rather than re-reading DATABASE_* here. That config sets
 * `ssl: { rejectUnauthorized: false }` for MySQL, and a user created with
 * REQUIRE SSL rejects a plaintext connection as "Access denied", which reads
 * like a wrong password.
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
            `This script only supports MySQL; config/database.js resolves DATABASE_CLIENT to "${client}".`
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

/**
 * Prompting, on a terminal and on a pipe.
 *
 * This script asks twice — the email, then the confirmation — and readline
 * cannot do that against piped stdin. The pipe hits EOF while the first answer
 * is still being handled, readline emits every buffered line at once with only
 * one question listening, drops the rest and closes; the second question then
 * either hangs forever or throws ERR_USE_AFTER_CLOSE. So a non-TTY stdin is
 * drained once and answered from a queue instead.
 */
let _rl = null;
let _piped = null;

function readAllStdin() {
    return new Promise((resolve) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => { data += chunk; });
        process.stdin.on("end", () => resolve(data));
        process.stdin.on("error", () => resolve(data));
    });
}

async function ask(question) {
    if (!process.stdin.isTTY) {
        if (_piped === null) {
            _piped = (await readAllStdin()).split(/\r?\n/);
        }
        const answer = (_piped.shift() ?? "").trim();
        // Echo it so a piped run reads like an interactive one in the log.
        process.stdout.write(`${question}${answer}\n`);
        return answer;
    }

    if (!_rl) {
        _rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    }
    return new Promise((resolve) => {
        _rl.question(question, (a) => resolve(a.trim()));
    });
}

function closePrompt() {
    if (_rl) {
        _rl.close();
        _rl = null;
    }
}

async function confirm(question) {
    if (YES) return true;
    const answer = await ask(question);
    return /^y(es)?$/i.test(answer);
}

/** Strapi 5 document ids are 24 lowercase alphanumerics. */
function makeDocumentId() {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    const bytes = crypto.randomBytes(24);
    let out = "";
    for (let i = 0; i < 24; i += 1) out += alphabet[bytes[i] % alphabet.length];
    return out;
}

function fmtDate(value) {
    if (!value) return c.dim("never");
    return new Date(value).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

async function hasColumn(conn, table, column) {
    const [rows] = await conn.query(
        `SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
          LIMIT 1`,
        [table, column]
    );
    return rows.length > 0;
}

async function tableExists(conn, table) {
    const [rows] = await conn.query(
        `SELECT 1 FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
          LIMIT 1`,
        [table]
    );
    return rows.length > 0;
}

// ─── Account lookup ──────────────────────────────────────────────────────────

/**
 * Find every account matching an email, across both identity tables.
 *
 * erp_step_up_secrets.user_id is written by two different code paths — the
 * admin login gate stores an admin_users id, the content-API gate stores an
 * up_users id — and the column does not record which. Resolving both and
 * refusing to guess when an email exists in both places is the only safe read.
 *
 * @param {object} conn
 * @param {string} email
 * @returns {Promise<Array<{ id: number, email: string, source: string, active: boolean }>>}
 */
async function findAccounts(conn, email) {
    const found = [];
    const needle = email.toLowerCase();

    const [admins] = await conn.query(
        "SELECT id, email, is_active FROM admin_users WHERE LOWER(email) = ?",
        [needle]
    );
    for (const row of admins) {
        found.push({ id: row.id, email: row.email, source: "admin_users", active: !!row.is_active });
    }

    if (await tableExists(conn, "up_users")) {
        const [users] = await conn.query(
            "SELECT id, email, blocked FROM up_users WHERE LOWER(email) = ?",
            [needle]
        );
        for (const row of users) {
            found.push({ id: row.id, email: row.email, source: "up_users", active: !row.blocked });
        }
    }

    return found;
}

async function readSecret(conn, userId, hasConfirmedAt) {
    const cols = hasConfirmedAt
        ? "id, user_id, provisioned_at, confirmed_at, last_used_at"
        : "id, user_id, provisioned_at, NULL AS confirmed_at, last_used_at";
    const [rows] = await conn.query(`SELECT ${cols} FROM ${SECRETS_TABLE} WHERE user_id = ?`, [userId]);
    return rows[0] || null;
}

// ─── --list ──────────────────────────────────────────────────────────────────

async function listSecrets(conn, hasConfirmedAt) {
    const confirmedCol = hasConfirmedAt ? "s.confirmed_at" : "NULL";
    const [rows] = await conn.query(
        `SELECT s.user_id, a.email, s.provisioned_at, ${confirmedCol} AS confirmed_at, s.last_used_at
           FROM ${SECRETS_TABLE} s
           LEFT JOIN admin_users a ON a.id = s.user_id
          ORDER BY s.user_id`
    );

    if (rows.length === 0) {
        console.log(c.dim("\n  No TOTP secrets are stored — nobody has 2FA configured.\n"));
        return;
    }

    console.log(`\n  ${c.bold("Accounts with a stored TOTP secret")}\n`);
    for (const r of rows) {
        // Neither timestamp set means the setup screen was abandoned: the secret
        // exists in the database but was never proved to be in an authenticator.
        const usable = r.confirmed_at || r.last_used_at;
        const label = usable ? c.green("confirmed") : c.yellow("NEVER CONFIRMED");
        console.log(`  user_id ${String(r.user_id).padEnd(8)} ${(r.email || c.dim("<not an admin user>")).padEnd(40)} ${label}`);
        console.log(c.dim(`      provisioned ${fmtDate(r.provisioned_at)}   last used ${fmtDate(r.last_used_at)}`));
    }
    console.log("");
}

// ─── Reset ───────────────────────────────────────────────────────────────────

async function revokeSessions(conn, account) {
    let erpRevoked = 0;
    let strapiDeleted = 0;

    if (await tableExists(conn, ERP_SESSIONS_TABLE)) {
        const [res] = await conn.execute(
            `UPDATE ${ERP_SESSIONS_TABLE}
                SET is_revoked = 1, revoke_reason = 'totp_reset', revoked_at = ?
              WHERE user_id = ? AND is_revoked = 0`,
            [Date.now(), account.id]
        );
        erpRevoked = res.affectedRows;
    }

    // Strapi's own session store is what actually keeps the admin JWT alive;
    // leaving these rows behind means the reset does not log the user out.
    // user_id is a varchar here, and `origin` is what separates an admin
    // session from a content-API one for the same numeric id.
    if (await tableExists(conn, STRAPI_SESSIONS_TABLE)) {
        const origin = account.source === "admin_users" ? "admin" : "api";
        const [res] = await conn.execute(
            `DELETE FROM ${STRAPI_SESSIONS_TABLE} WHERE user_id = ? AND origin = ?`,
            [String(account.id), origin]
        );
        strapiDeleted = res.affectedRows;
    }

    return { erpRevoked, strapiDeleted };
}

async function writeAuditLog(conn, account, detail) {
    const now = new Date();
    await conn.execute(
        `INSERT INTO ${AUDIT_TABLE}
            (document_id, event_type, user_id, session_id, ip_address, user_agent, outcome, metadata, timestamp, created_at, updated_at, published_at)
         VALUES (?, 'STEP_UP_SETUP_COMPLETE', ?, NULL, 'cli', ?, 'SUCCESS', ?, ?, ?, ?, ?)`,
        [
            makeDocumentId(),
            account.id,
            `scripts/reset-totp.js (${process.env.USERNAME || process.env.USER || "unknown"}@${require("os").hostname()})`,
            JSON.stringify({ action: "secret_reset_by_cli", email: account.email, source: account.source, ...detail }),
            now,
            now,
            now,
            now,
        ]
    );
}

async function resetForAccount(conn, account, secret, hasConfirmedAt) {
    if (DRY_RUN) {
        console.log(c.yellow("\n  --dry-run: nothing was written.\n"));
        return;
    }

    const [del] = await conn.execute(`DELETE FROM ${SECRETS_TABLE} WHERE user_id = ?`, [account.id]);

    let sessions = { erpRevoked: 0, strapiDeleted: 0 };
    if (!KEEP_SESSIONS) {
        sessions = await revokeSessions(conn, account);
    }

    try {
        await writeAuditLog(conn, account, {
            secretRowsDeleted: del.affectedRows,
            wasConfirmed: hasConfirmedAt ? Boolean(secret && (secret.confirmed_at || secret.last_used_at)) : null,
            sessionsRevoked: KEEP_SESSIONS ? "skipped" : sessions,
        });
    } catch (err) {
        // A missing audit row must not make a completed reset look like a failure.
        console.log(c.yellow(`  (audit log entry could not be written: ${err.message})`));
    }

    console.log(c.green(`\n  TOTP reset for ${account.email}.`));
    console.log(`    secret rows deleted     ${del.affectedRows}`);
    if (KEEP_SESSIONS) {
        console.log(c.dim("    sessions                left alone (--keep-sessions)"));
    } else {
        console.log(`    ERP sessions revoked    ${sessions.erpRevoked}`);
        console.log(`    Strapi sessions deleted ${sessions.strapiDeleted}`);
    }

    console.log(`\n  ${c.bold("Tell the user to:")}`);
    console.log("    1. Delete the old entry from their authenticator app — it no longer works.");
    console.log("    2. Sign in again. The panel will show a fresh QR code to scan.");
    console.log("    3. Enter the first 6-digit code to finish setup. Closing the tab at the");
    console.log("       QR screen is fine now — the next login shows the QR again.");
    console.log(c.dim("\n  If they were rate limited by failed codes, that counter lives in the running"));
    console.log(c.dim("  Strapi process — restart Strapi to clear it immediately.\n"));
}

// ─── Main ────────────────────────────────────────────────────────────────────

function printHelp() {
    console.log(`
  ${c.bold("Reset an account's TOTP (2FA) setup")}

    node scripts/reset-totp.js                        prompt for the email address
    node scripts/reset-totp.js --email a@b.com        skip the prompt
    node scripts/reset-totp.js --email a@b.com --yes  skip the confirmation too
    node scripts/reset-totp.js --list                 show who has a secret stored
    node scripts/reset-totp.js --email a@b.com --dry-run

  Options
    -e, --email <addr>   account to reset
    -y, --yes            do not ask for confirmation
        --dry-run        report what would happen, write nothing
        --keep-sessions  do not revoke the account's active sessions
        --list           list accounts with a stored TOTP secret, then exit
    -h, --help           this text
`);
}

(async () => {
    if (HELP) {
        printHelp();
        return;
    }

    const dbCfg = resolveDbConfig();
    console.log(c.dim(
        `\n  database: ${dbCfg.connection.database}@${dbCfg.connection.host}:${dbCfg.connection.port}` +
        ` user=${dbCfg.connection.user} (from config/database.js)`
    ));

    const conn = await connect();

    try {
        if (!(await tableExists(conn, SECRETS_TABLE))) {
            console.error(c.red(`\n  Table ${SECRETS_TABLE} does not exist in this database.`));
            console.error("  Start Strapi once so the erp-session-manager plugin creates its tables.\n");
            process.exitCode = 1;
            return;
        }

        // Added alongside the abandoned-setup fix; a database that has not been
        // through a Strapi restart yet will not have it.
        const hasConfirmedAt = await hasColumn(conn, SECRETS_TABLE, "confirmed_at");

        if (LIST) {
            await listSecrets(conn, hasConfirmedAt);
            return;
        }

        const email = EMAIL_ARG || (await ask("\n  Email address: "));
        if (!email) {
            console.error(c.red("\n  No email address given. Nothing to do.\n"));
            process.exitCode = 1;
            return;
        }

        const accounts = await findAccounts(conn, email);

        if (accounts.length === 0) {
            console.error(c.red(`\n  No account found with the email "${email}".`));
            console.error(c.dim("  Check the spelling, or run with --list to see who has 2FA configured.\n"));
            process.exitCode = 1;
            return;
        }

        if (accounts.length > 1) {
            console.error(c.red(`\n  "${email}" matches more than one account:`));
            for (const a of accounts) console.error(`    id ${a.id} in ${a.source}`);
            console.error(c.dim("\n  Resolve this by hand — the secrets table stores only the numeric id,"));
            console.error(c.dim("  so the script cannot tell which of these a stored secret belongs to.\n"));
            process.exitCode = 1;
            return;
        }

        const account = accounts[0];
        const secret = await readSecret(conn, account.id, hasConfirmedAt);

        console.log(`\n  ${c.bold("Account")}`);
        console.log(`    email      ${account.email}`);
        console.log(`    user id    ${account.id} ${c.dim(`(${account.source})`)}`);
        console.log(`    active     ${account.active ? c.green("yes") : c.yellow("no")}`);

        console.log(`\n  ${c.bold("Current TOTP state")}`);
        if (!secret) {
            console.log(c.dim("    No secret stored — 2FA is already unconfigured for this account."));
            console.log(c.dim("    The next login will show the QR / setup screen.\n"));

            if (KEEP_SESSIONS || DRY_RUN) return;

            const alsoRevoke = await confirm("  Nothing to delete. Revoke this account's sessions anyway? [y/N] ");
            if (!alsoRevoke) {
                console.log(c.dim("\n  Cancelled. Nothing written.\n"));
                return;
            }
            const sessions = await revokeSessions(conn, account);
            console.log(c.green(`\n  ERP sessions revoked ${sessions.erpRevoked}, Strapi sessions deleted ${sessions.strapiDeleted}.\n`));
            return;
        }

        const usable = Boolean(secret.confirmed_at || secret.last_used_at);
        console.log(`    provisioned  ${fmtDate(secret.provisioned_at)}`);
        if (hasConfirmedAt) console.log(`    confirmed    ${fmtDate(secret.confirmed_at)}`);
        console.log(`    last used    ${fmtDate(secret.last_used_at)}`);
        console.log(`    state        ${usable ? c.green("confirmed — a working authenticator exists") : c.yellow("NEVER CONFIRMED — setup was abandoned at the QR screen")}`);

        console.log(`\n  ${c.bold("This will")}`);
        console.log(`    - delete the stored secret, so the next login shows a fresh QR code`);
        console.log(`    - break the user's current authenticator entry permanently`);
        console.log(KEEP_SESSIONS
            ? c.dim("    - leave active sessions alone (--keep-sessions)")
            : "    - revoke the account's active sessions, forcing a re-login");

        const ok = await confirm(`\n  Reset TOTP for ${c.bold(account.email)}? [y/N] `);
        if (!ok) {
            console.log(c.dim("\n  Cancelled. Nothing written.\n"));
            return;
        }

        await resetForAccount(conn, account, secret, hasConfirmedAt);
    } finally {
        closePrompt();
        await conn.end();
    }
})().catch((err) => {
    closePrompt();
    console.error(c.red(`\n  Reset failed: ${err.message}`));

    if (err.code === "ER_ACCESS_DENIED_ERROR" || /Access denied/i.test(err.message || "")) {
        console.error(c.yellow("\n  This is a connection problem, not a data problem — nothing was written."));
        console.error("  Check that DATABASE_* in .env are the values this shell actually sees:");
        console.error("  a pm2/systemd-managed app has its own injected environment.\n");
    } else {
        console.error(err.stack);
    }
    process.exit(1);
});
