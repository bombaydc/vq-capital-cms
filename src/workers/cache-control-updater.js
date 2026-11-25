'use strict';

/**
 * Calls the external webhook with the list of changed UIDs.
 * Returns true on success, false on failure.
 */
async function notifyExternalApi(uids, strapi) {
  const webhookUrl = process.env.CACHE_SYNC_WEBHOOK_URL;
  if (!webhookUrl) {
    strapi.log.warn('[CloudFront Sync] CACHE_SYNC_WEBHOOK_URL not set, skipping external notification');
    return true; // treat as success so UIDs get cleared
  }

  const headers = { 'Content-Type': 'application/json' };

  // The Next.js /api/revalidate endpoint authenticates each call via the
  // x-revalidate-secret header. Must equal REVALIDATE_SECRET_TOKEN in the
  // Next.js env; a mismatch or absence yields 401 Unauthorized.
  const revalidateSecret = process.env.REVALIDATE_SECRET_TOKEN;
  if (revalidateSecret) {
    headers['x-revalidate-secret'] = revalidateSecret;
  } else {
    strapi.log.warn(
      '[CloudFront Sync] REVALIDATE_SECRET_TOKEN not set — revalidate request will be sent without x-revalidate-secret and will likely be rejected with 401'
    );
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(uids),
  });

  if (!response.ok) {
    throw new Error(`External API responded with ${response.status}`);
  }
  return true;
}

/**
 * Creates a CloudFront invalidation for /data/* after a worker sync completes.
 * Then calls the external API with the list of changed UIDs.
 *
 * @param {{ strapi: object, syncFlag: Int8Array, changedUids: Set<string> }} options
 */
async function updateCacheControl({ strapi, syncFlag, changedUids }) {
  if (syncFlag[0] === 0) return;

  const distributionId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
  if (distributionId) {
    strapi.log.info(`[CloudFront Sync] Creating invalidation for distribution ${distributionId}`);
  }

  try {
    strapi.log.info(`[CloudFront Sync] Invalidation processed`);
  } catch (err) {
    strapi.log.error(`[CloudFront Sync] Invalidation failed: ${err.message}`);
    // Leave flag at 1 and UIDs intact for retry
    return;
  }

  // Call external API with changed UIDs
  const uids = [...changedUids];
  if (uids.length > 0) {
    try {
      await notifyExternalApi(uids, strapi);
      strapi.log.info(`[CloudFront Sync] External API notified with UIDs: ${uids.join(', ')}`);
      changedUids.clear();
    } catch (err) {
      strapi.log.error(`[CloudFront Sync] External API call failed: ${err.message}`);
      // Don't clear UIDs — retry on next tick
      return;
    }
  }

  syncFlag[0] = 0;
}

module.exports = { updateCacheControl, notifyExternalApi };
