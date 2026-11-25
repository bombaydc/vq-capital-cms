'use strict';

/**
 * Migration 001 — DB indexes for all ERP Session Manager tables (Gap G22).
 *
 * Adds indexes only if the target tables exist (safe to run before data is present).
 * All index names are prefixed with `erp_` to avoid collisions.
 */

exports.up = async (knex) => {
  // erp_sessions ─────────────────────────────────────────────────────────────
  if (await knex.schema.hasTable('erp_sessions')) {
    await knex.schema.table('erp_sessions', (t) => {
      // Composite index speeds up "get active sessions for user" (most frequent query)
      t.index(['user_id', 'is_revoked', 'expires_at'], 'erp_sessions_user_active_idx');
      // Refresh-token lookup by hash
      t.index(['refresh_token_hash'], 'erp_sessions_refresh_hash_idx');
    });
  }

  // erp_known_devices ────────────────────────────────────────────────────────
  if (await knex.schema.hasTable('erp_known_devices')) {
    await knex.schema.table('erp_known_devices', (t) => {
      // Unique constraint prevents duplicate device rows per user
      t.unique(['user_id', 'device_hash'], { indexName: 'erp_known_devices_user_device_uniq' });
    });
  }

  // erp_session_activities ───────────────────────────────────────────────────
  if (await knex.schema.hasTable('erp_session_activities')) {
    await knex.schema.table('erp_session_activities', (t) => {
      t.index(['session_id'], 'erp_session_activities_session_idx');
      t.index(['user_id', 'logged_at'], 'erp_session_activities_user_time_idx');
    });
  }
};

exports.down = async (knex) => {
  if (await knex.schema.hasTable('erp_sessions')) {
    await knex.schema.table('erp_sessions', (t) => {
      t.dropIndex([], 'erp_sessions_user_active_idx');
      t.dropIndex([], 'erp_sessions_refresh_hash_idx');
    });
  }

  if (await knex.schema.hasTable('erp_known_devices')) {
    await knex.schema.table('erp_known_devices', (t) => {
      t.dropUnique([], 'erp_known_devices_user_device_uniq');
    });
  }

  if (await knex.schema.hasTable('erp_session_activities')) {
    await knex.schema.table('erp_session_activities', (t) => {
      t.dropIndex([], 'erp_session_activities_session_idx');
      t.dropIndex([], 'erp_session_activities_user_time_idx');
    });
  }
};
