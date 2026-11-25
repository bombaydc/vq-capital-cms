'use strict';

/**
 * Optional (on-demand) dependencies.
 *
 * Heavy SDKs that only some deployments need are NOT in package.json
 * `dependencies`, so a plain `npm install` never downloads them. Each feature
 * below switches on from an env var; when it is on, install its packages with:
 *
 *     npm run deps:install            # auto: reads .env, installs what is enabled
 *     npm run deps:install -- s3 meili   # explicit feature list
 *
 * Code that needs one of these packages loads it through optionalRequire(),
 * which turns a missing module into an error that says exactly what to run.
 *
 * NOTE: `npm install` / `npm ci` prune packages installed with --no-save, so in
 * a deploy pipeline run `npm run deps:install` AFTER `npm ci`.
 */

const FEATURES = {
  s3: {
    description: 'AWS S3 media storage (AWS_BUCKET)',
    enabledBy: (env) => isSet(env.AWS_BUCKET) && !isSet(env.GCS_BUCKET),
    packages: {
      '@aws-sdk/client-s3': '3.1023.0',
      '@aws-sdk/lib-storage': '3.1023.0',
      '@aws-sdk/s3-request-presigner': '3.1023.0',
    },
  },
  gcs: {
    description: 'Google Cloud Storage media storage (GCS_BUCKET)',
    enabledBy: (env) => isSet(env.GCS_BUCKET),
    packages: { '@google-cloud/storage': '^7.19.0' },
  },
  redis: {
    description: 'Redis session store for erp-session-manager (ERP_REDIS_ENABLED)',
    enabledBy: (env) => isTrue(env.ERP_REDIS_ENABLED),
    packages: { ioredis: '^5.7.0' },
  },
  meili: {
    description: 'Meilisearch indexing of JSON snapshots (MEILI_ENABLE)',
    enabledBy: (env) => isTrue(env.MEILI_ENABLE),
    packages: { meilisearch: '^0.54.0' },
  },
  smtp: {
    description: 'SMTP email via nodemailer (SMTP_HOST)',
    enabledBy: (env) => isSet(env.SMTP_HOST),
    packages: { '@strapi/provider-email-nodemailer': '^5.47.0' },
  },
};

function isSet(v) {
  if (typeof v !== 'string') return false;
  const t = v.trim();
  return t !== '' && t !== 'undefined' && t !== 'null';
}

function isTrue(v) {
  return isSet(v) && ['true', '1', 'on', 'yes'].includes(v.trim().toLowerCase());
}

/** Feature that owns a package name, or null. */
function featureOf(pkg) {
  return Object.keys(FEATURES).find((f) => pkg in FEATURES[f].packages) || null;
}

/** Features switched on by the given env. */
function enabledFeatures(env = process.env) {
  return Object.keys(FEATURES).filter((f) => FEATURES[f].enabledBy(env));
}

/** True when the package resolves from this project. */
function isInstalled(pkg) {
  try {
    require.resolve(pkg);
    return true;
  } catch {
    return false;
  }
}

/**
 * require() an optional package, or throw an actionable error if it is missing.
 * Errors thrown while the package itself loads are re-thrown untouched.
 *
 * @param {string} pkg
 */
function optionalRequire(pkg) {
  try {
    return require(pkg);
  } catch (err) {
    const missingSelf =
      err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes(`'${pkg}'`);
    if (!missingSelf) throw err;
    const feature = featureOf(pkg);
    const hint = feature
      ? `npm run deps:install -- ${feature}`
      : `npm install ${pkg}`;
    const e = new Error(
      `[optional-deps] "${pkg}" is required${feature ? ` for ${FEATURES[feature].description}` : ''} ` +
        `but is not installed. Run: ${hint}`
    );
    e.code = 'OPTIONAL_DEP_MISSING';
    throw e;
  }
}

module.exports = { FEATURES, enabledFeatures, isInstalled, optionalRequire, isSet, isTrue };
