'use strict';

/**
 * Migration 002 — `confirmed_at` on erp_step_up_secrets.
 *
 * WHY
 * ---
 * provisionSecret() writes the secret row BEFORE the QR code is shown, so the
 * presence of a row said nothing about whether the user ever scanned it.
 * Anyone who closed the tab at the QR screen left an identical row behind, and
 * the next login read it as "already set up" and asked for a code from an
 * authenticator that had never received the secret — an unrecoverable lockout
 * without a DB edit. `confirmed_at` is stamped only when a code from the secret
 * verifies, so the two states are now distinguishable.
 *
 * The column is declared on the content type, so Strapi's own schema sync
 * normally creates it. It is created here as well so the fix does not silently
 * depend on schema sync being enabled in a given environment.
 *
 * BACKFILL
 * --------
 * `last_used_at` is set every time a secret produces a valid code, so a row
 * that has one is, by definition, in someone's authenticator — those are
 * backfilled as confirmed. Rows with neither timestamp are exactly the
 * abandoned setups and are deliberately left NULL: those users get the QR
 * screen again on their next login, which is the recovery.
 */

const TABLE = 'erp_step_up_secrets';

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable(TABLE))) return;

  if (!(await knex.schema.hasColumn(TABLE, 'confirmed_at'))) {
    await knex.schema.table(TABLE, (t) => {
      t.datetime('confirmed_at', { precision: 6 }).nullable();
    });
  }

  await knex(TABLE)
    .whereNull('confirmed_at')
    .whereNotNull('last_used_at')
    .update({ confirmed_at: knex.ref('last_used_at') });
};

exports.down = async (knex) => {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if (!(await knex.schema.hasColumn(TABLE, 'confirmed_at'))) return;

  await knex.schema.table(TABLE, (t) => {
    t.dropColumn('confirmed_at');
  });
};
