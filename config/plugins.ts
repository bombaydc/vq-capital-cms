import fs from 'fs';
import path from 'path';
import type { Core } from '@strapi/strapi';

type Env = Core.Config.Shared.ConfigParams['env'];

/**
 * Plugin configuration — ported from abg-cms.
 *
 * Media library: self-hosted (public/uploads) unless a bucket is configured.
 *   GCS_BUCKET set → src/providers/upload-gcs-secure   (needs `npm run deps:install -- gcs`)
 *   AWS_BUCKET set → src/providers/upload-aws-s3-secure (needs `npm run deps:install -- s3`)
 *   neither        → local filesystem — no cloud SDK is installed or loaded.
 */

// Providers are .js files compiled next to this config (dist/config → dist/src).
const providerPath = (name: string) => path.resolve(__dirname, '../src/providers', name);

function logUploadProvider(env: Env) {
  const gcsBucket = env('GCS_BUCKET', '');
  const awsBucket = env('AWS_BUCKET', '');
  const isBuild = process.argv.includes('build');

  if (gcsBucket) {
    const keyFile = env('GCS_KEY_FILE_PATH');
    if (keyFile && !fs.existsSync(keyFile)) {
      const msg = `[upload] GCS selected but GCS_KEY_FILE_PATH="${keyFile}" does not exist.`;
      if (isBuild) console.warn(msg);
      else throw new Error(msg);
    }
    console.info(`[upload] Provider: GCS  bucket=${gcsBucket}`);
    if (awsBucket) console.info('[upload] AWS_BUCKET is also set but GCS takes priority.');
    return;
  }

  if (awsBucket) {
    const missing = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'].filter((k) => !env(k));
    if (missing.length) {
      throw new Error(
        `[upload] AWS S3 selected (AWS_BUCKET="${awsBucket}") but missing: ${missing.join(', ')}`
      );
    }
    console.info(`[upload] Provider: AWS S3  bucket=${awsBucket}  region=${env('AWS_REGION')}`);
    return;
  }

  console.info('[upload] Provider: local filesystem (self-hosted media library)');
}

function uploadProvider(env: Env) {
  if (env('GCS_BUCKET')) {
    return {
      provider: providerPath('upload-gcs-secure'),
      providerOptions: {
        bucket: env('GCS_BUCKET'),
        projectId: env('GCS_PROJECT_ID'),
        keyFilename: env('GCS_KEY_FILE_PATH'),
        keyJson: env('GCS_KEY_JSON'),
        baseUrl: env('GCS_CDN_URL'),
        rootPath: env('GCS_ROOT_PATH', ''),
        uniformAccess: env.bool('GCS_UNIFORM_ACCESS', true),
        signedUrlExpires: env.int('GCS_SIGNED_URL_EXPIRES', 900),
      },
    };
  }
  if (env('AWS_BUCKET')) {
    return {
      provider: providerPath('upload-aws-s3-secure'),
      providerOptions: {
        baseUrl: env('AWS_CDN_URL'),
        rootPath: env('AWS_ROOT_PATH', ''),
        s3Options: {
          credentials: {
            accessKeyId: env('AWS_ACCESS_KEY_ID'),
            secretAccessKey: env('AWS_SECRET_ACCESS_KEY'),
          },
          region: env('AWS_REGION', 'us-east-1'),
          params: {
            Bucket: env('AWS_BUCKET'),
            ACL: env('AWS_ACL', 'public-read'),
            signedUrlExpires: env.int('AWS_SIGNED_URL_EXPIRES', 900),
          },
        },
      },
    };
  }
  return {};
}

// Email: nodemailer (SMTP) only when SMTP_HOST is set — `npm run deps:install -- smtp`.
// Otherwise Strapi's default sendmail provider is used. Sending is also gated
// by ENABLE_EMAIL=ON in src/utility/send-mail.js.
function emailConfig(env: Env): Core.Config.Plugin {
  if (!env('SMTP_HOST')) return {};
  // On-demand deps are installed with --no-save, so a plain `npm install`/`npm ci`
  // removes them. Without this guard Strapi crashes at boot ("provider.init is not
  // a function"); instead warn and keep the default provider until it is reinstalled.
  try {
    require.resolve('@strapi/provider-email-nodemailer');
  } catch {
    console.warn(
      '[email] SMTP_HOST is set but @strapi/provider-email-nodemailer is not installed — ' +
        'falling back to the default provider. Run `npm run deps:install` to enable SMTP.'
    );
    return {};
  }
  return {
    email: {
      config: {
        provider: 'nodemailer',
        providerOptions: {
          host: env('SMTP_HOST'),
          port: env.int('SMTP_PORT', 587),
          secure: env.bool('SMTP_SECURE', false),
          auth: {
            user: env('SMTP_USERNAME'),
            pass: env('SMTP_PASSWORD'),
          },
        },
        settings: {
          defaultFrom: env('EMAIL_FROM'),
          defaultReplyTo: env('EMAIL_REPLYTO'),
        },
      },
    },
  };
}

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  logUploadProvider(env);

  return {
    // VAPT #7 — Long-lived JWT. Kept in legacy-support mode (no jwtManagement)
    // because the ERP session-manager hook reads ctx.body.jwt on login; JWT
    // lifetime cut from 30d to 4h (matches ERP absolute timeout).
    'users-permissions': {
      config: {
        jwt: {
          expiresIn: '4h',
        },
      },
    },

    'leads-dashboard': {
      enabled: true,
      resolve: './src/plugins/leads-dashboard',
    },

    'erp-session-manager': {
      enabled: true,
      resolve: './src/plugins/erp-session-manager',
      config: {
        // database store takes priority over redis; both off → memory store.
        store: {
          database: {
            enabled: env.bool('ERP_DB_STORE_ENABLED', true),
            purgeIntervalMs: 3600000,
          },
          redis: {
            // Needs `npm run deps:install -- redis`.
            enabled: env.bool('ERP_REDIS_ENABLED', false),
            host: env('REDIS_HOST', '127.0.0.1'),
            port: env.int('REDIS_PORT', 6379),
            password: env('REDIS_PASSWORD'),
          },
        },
        tokens: {
          accessTokenTtl: 900, // 15 min
          refreshTokenTtl: 28800, // 8 h
        },
        sessions: {
          idleTimeout: 900, // 15 min
          absoluteTimeout: 14400, // 4 h
          maxConcurrent: 2,
          evictionPolicy: 'oldest-first',
          anomaly: {
            blockOnIpChange: true,
            blockOnUaChange: false,
            impossibleTravelEnabled: false,
            maxSpeedKmh: 900,
          },
        },
        cookies: {
          name: 'erp_rt',
          sameSite: 'Strict',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
        },
        hsts: {
          enabled: env('NODE_ENV') === 'production',
          maxAge: 31536000,
          includeSubDomains: true,
          preload: false,
        },
        password: {
          minLength: 12,
          maxLength: 128,
          requireUppercase: true,
          requireLowercase: true,
          requireDigit: true,
          requireSpecial: true,
          preventCommonPasswords: true,
          passwordHistory: 5, // VAPT #27
        },
        auditLog: {
          retentionDays: 90,
        },
        stepUp: {
          enabled: true,
          tokenTtl: 300,
          maxAttempts: 5,
          windowMs: 900000,
          clockSkewSeconds: 30,
          protectedRoutes: ['policy_management', 'password_change'], // VAPT #4
          enforceForContentApi: false,
        },
        // VAPT #20 — self-hosted SVG CAPTCHA; toggled from the ERP Settings page.
        captcha: {
          enabled: false,
          enforceForContentApi: true,
          enforceForAdminPanel: true,
          ttlSeconds: 300,
        },
        // VAPT #4 / #9 — rate limits
        rateLimiting: {
          login: { windowMs: 900000, maxAttempts: 10 },
          register: { windowMs: 3600000, maxAttempts: 5 },
          changePassword: { windowMs: 900000, maxAttempts: 5 },
          forgotPassword: { windowMs: 900000, maxAttempts: 3 },
          resetPassword: { windowMs: 900000, maxAttempts: 5 },
          emailConfirm: { windowMs: 3600000, maxAttempts: 3 },
          oauthCallback: { windowMs: 900000, maxAttempts: 20 },
          auditExport: { windowMs: 3600000, maxAttempts: 5 },
          redisTest: { windowMs: 3600000, maxAttempts: 10 },
          stepUpRegenerate: { windowMs: 3600000, maxAttempts: 3 },
          stepUpVerify: { windowMs: 900000, maxAttempts: 5 },
        },
      },
    },

    // VAPT #3 — Malicious file upload: MIME allowlist (declared + extension +
    // magic bytes), executable denylist, 50 MB cap (default is 1 GB).
    upload: {
      enabled: true,
      config: {
        ...uploadProvider(env),
        sizeLimit: 52428800,
        security: {
          allowedTypes: [
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
            'image/avif',
            'image/tiff',
            // SVG is NOT allowed: it can carry <script> and is served inline
            // (stored XSS). abg-cms allows it deliberately; add 'image/svg+xml'
            // here only if that risk is accepted for this project.
            'application/pdf',
            'application/json',
            'video/mp4',
            'video/webm',
            'video/ogg',
            'audio/mpeg',
            'audio/wav',
            'audio/ogg',
            'audio/webm',
            'text/plain',
            'text/csv',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          ],
          deniedTypes: [
            'image/svg+xml',
            'application/x-msdownload',
            'application/x-executable',
            'application/x-msdos-program',
            'application/x-dosexec',
            'application/vnd.microsoft.portable-executable',
            'application/x-mach-binary',
            'application/x-sh',
            'application/x-csh',
            'application/x-bat',
            'application/x-cmd',
            'application/x-msi',
            'application/java-archive',
            'application/x-java-archive',
            'application/x-powershell',
            'text/x-shellscript',
            'text/x-perl',
            'text/x-python',
            'text/x-ruby',
          ],
        },
      },
    },

    ...emailConfig(env),
  };
};

export default config;
