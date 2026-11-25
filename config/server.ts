import type { Core } from '@strapi/strapi';
import cronTasks from './cron-tasks';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  app: {
    keys: env.array('APP_KEYS')!,
  },
  url: env('API_URL', 'http://localhost:1337'),

  // Reverse-proxy awareness. Enable IS_PROXIED=true wherever nginx / a load
  // balancer terminates TLS (and sends X-Forwarded-Proto/For). While it is off
  // behind a proxy, ctx.ip is the proxy's address — the per-IP rate limiter,
  // IP-change anomaly detection and step-up IP binding all degrade. Never
  // enable it if node is also reachable directly (X-Forwarded-For spoofing).
  // MUST be nested under `koa` — Strapi reads server.proxy.koa.
  proxy: {
    koa: env.bool('IS_PROXIED', false),
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
  cron: {
    enabled: env.bool('CRON_ENABLED', false),
    tasks: cronTasks({ env }),
  },
});

export default config;
