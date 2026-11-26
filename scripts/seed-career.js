'use strict';

/**
 * Seed script for `api::career.career` (Single Type) + its SEO media.
 *
 * Usage (from project root, after `npm run build`):
 *   node scripts/seed-career.js            # Create & publish Career if empty
 *   node scripts/seed-career.js --force    # Overwrite/update & publish Career
 *   node scripts/seed-career.js --export   # Also export public/uploads/data/career.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FORCE = process.argv.includes('--force');
const EXPORT_JSON = process.argv.includes('--export');

const SOCIAL_IMAGE_URL = 'https://wondrous-sawine-0270e5.netlify.app/vq-social-preview.png';
const SOCIAL_IMAGE_NAME = 'vq-social-preview.png';

async function ensureSocialMedia(app, tempDir) {
  const existing = await app.db.query('plugin::upload.file').findOne({
    where: { name: SOCIAL_IMAGE_NAME },
  });
  if (existing) return existing.id;

  try {
    const res = await fetch(SOCIAL_IMAGE_URL);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const dest = path.join(tempDir, SOCIAL_IMAGE_NAME);
    fs.writeFileSync(dest, buf);
    const [uploaded] = await app.plugin('upload').service('upload').upload({
      data: { fileInfo: { name: SOCIAL_IMAGE_NAME, alternativeText: SOCIAL_IMAGE_NAME } },
      files: {
        filepath: dest,
        originalFilename: SOCIAL_IMAGE_NAME,
        mimetype: 'image/png',
        size: buf.length,
      },
    });
    return uploaded.id;
  } catch (err) {
    console.warn('[seed-career] Social image upload skipped:', err.message);
    return null;
  }
}

function buildCareerData(socialId) {
  return {
    label: 'Careers / Build with VQ Capital Partners',
    name: 'Entrepreneurial in spirit. Exacting in practice.',
    description:
      'At VQ Capital Partners, entrepreneurial means seeing work that needs to exist and taking it from idea to consequence. People are expected to question inherited answers, build capabilities beyond the limits of a job description and remain accountable for the outcome—not only their part in it.',
    seo: {
      metaTitle: 'VQ Capital Partners — Independent investment thinking',
      metaDescription:
        'VQ Capital Partners studies structural change before selecting the businesses best placed to capture and compound its value.',
      metaRobots: 'noindex, nofollow',
      metaViewport: 'width=device-width, initial-scale=1',
      ...(socialId ? { metaImage: socialId } : {}),
      metaSocial: [
        {
          socialNetwork: 'Facebook',
          title: 'VQ Capital Partners — Independent investment thinking',
          description:
            'VQ Capital Partners studies structural change before selecting the businesses best placed to capture and compound its value.',
          ...(socialId ? { image: socialId } : {}),
        },
        {
          socialNetwork: 'Twitter',
          title: 'VQ Capital Partners — Independent investment thinking',
          description:
            'VQ Capital Partners studies structural change before selecting the businesses best placed to capture and compound its value.',
          ...(socialId ? { image: socialId } : {}),
        },
      ],
    },
    content: [
      {
        __component: 'common.main-section',
        label: 'How ownership works',
        name: 'See the need. Build the answer. Stay with the outcome.',
        description:
          'VQ Capital Partners has grown through people enlarging the role in front of them. Opening a research question, building a system, strengthening a relationship or connecting work across teams. Initiative matters here because it is carried through with judgement, consequence and a clear owner.',
      },
      {
        __component: 'common.main-section',
        label: 'Open roles',
        name: 'Come build with us.',
        description: 'Our current opportunities are based in Mumbai and are full-time roles.',
        list_items: [
          {
            name: 'IT Research Analyst',
            description:
              'Mumbai · Full time — Track developments and news flow, analyse financial statements and stay current with the technology trends reshaping businesses.',
            button: {
              buttonText: 'Read more',
              type: 'Email',
              buttonType: 'Primary',
              buttonLink:
                'mailto:careers@valuequest.in?subject=Application%20%E2%80%94%20IT%20Research%20Analyst',
            },
          },
          {
            name: 'Executive — Back-office operations',
            description:
              'Mumbai · Full time — For candidates with at least three years’ experience in PMS and AIF operations, including daily processes, compliance requirements and platforms such as Wealth Spectrum or Miles.',
            button: {
              buttonText: 'Read more',
              type: 'Email',
              buttonType: 'Primary',
              buttonLink:
                'mailto:careers@valuequest.in?subject=Application%20%E2%80%94%20Executive%20%E2%80%94%20Back-office%20operations',
            },
          },
        ],
      },
      {
        __component: 'common.main-section',
        label: 'How to apply',
        name: 'Show us how you think.',
        description:
          'Send your résumé with a short note about the work you want to do, the problems you want to solve and why VQ Capital Partners is the right place to do it.',
        button: {
          buttonText: 'careers@valuequest.in',
          type: 'Email',
          buttonType: 'Primary',
          buttonLink: 'mailto:careers@valuequest.in',
        },
      },
      {
        __component: 'common.bottom-link',
        name: 'continue',
        button: {
          buttonText: 'Contact',
          type: 'Internal',
          buttonType: 'Primary',
          buttonLink: '/contact',
        },
      },
    ],
  };
}

async function run() {
  process.chdir(PROJECT_ROOT);
  require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });

  if (!fs.existsSync(path.join(PROJECT_ROOT, 'dist/config/database.js'))) {
    throw new Error('dist/ not built. Run `npm run build` first.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vq-seed-career-'));
  let app;

  try {
    const { createStrapi } = require('@strapi/strapi');
    app = await createStrapi({ distDir: './dist' }).load();

    const socialId = await ensureSocialMedia(app, tempDir);
    const careerData = buildCareerData(socialId);

    const existing = await app.documents('api::career.career').findFirst({ status: 'published' });

    if (existing && !FORCE) {
      console.log(
        `[seed-career] Career already published (documentId=${existing.documentId}). Pass --force to overwrite.`
      );
    } else if (existing && FORCE) {
      const updated = await app.documents('api::career.career').update({
        documentId: existing.documentId,
        data: careerData,
        status: 'published',
      });
      console.log(`[seed-career] Updated & published Career (documentId=${updated.documentId})`);
    } else {
      const created = await app.documents('api::career.career').create({
        data: careerData,
        status: 'published',
      });
      console.log(`[seed-career] Created & published Career (documentId=${created.documentId})`);
    }

    if (EXPORT_JSON) {
      const { syncJSON } = require(path.join(PROJECT_ROOT, 'src/workers/upload-s3'));
      const res = await syncJSON('api::career.career');
      console.log('[seed-career] Export career.json:', res.status, res.message);
    }
  } finally {
    if (app) {
      await app.destroy();
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-career] Failed:', err);
    process.exit(1);
  });
