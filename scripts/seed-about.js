'use strict';

/**
 * Seed script for `api::about.about` (Single Type) + its SEO media.
 *
 * Usage (from project root, after `npm run build`):
 *   node scripts/seed-about.js            # Create & publish About if empty
 *   node scripts/seed-about.js --force    # Overwrite/update & publish About
 *   node scripts/seed-about.js --export   # Also export public/uploads/data/about.json
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
    console.warn('[seed-about] Social image upload skipped:', err.message);
    return null;
  }
}

function buildAboutData(socialId) {
  return {
    label: 'About the firm',
    name: 'Independent research to investment platform.',
    description:
      'VQ Capital Partners is an Indian public markets and Private Equity investment platform built around independent research, deep conviction and long-duration relationships.',
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
        label: 'The platform',
        name: 'VQ Capital Partners as an investment platform.',
        description:
          'Institutional scale was never an end goal, it was the natural progression of our research-first DNA. As our foundational analysis uncovered opportunities across public markets and Private Equity, institutionalizing risk controls, operational discipline, and compliance became the organic way to execute our conviction.',
        stat_items: [
          {
            name: 'Return since inception (VQ Capital Partners Growth)',
            stat: '17.97%',
            description: 'v/s 10.81% BSE 500 TRI',
          },
          {
            name: 'Assets under management · As of 30 June 2026',
            stat: '~$3.21B',
            description: 'Assets under management · As of 30 June 2026',
          },
          {
            name: 'Foreign institutional capital',
            stat: '38%',
            description: 'AUM',
          },
          {
            name: 'Operational excellence',
            stat: '16 years+',
            description: 'Operational excellence',
          },
          {
            name: 'Team strength',
            stat: '140 employees',
            description: 'Team strength',
          },
        ],
      },
      {
        __component: 'common.timeline-section',
        label: 'History',
        name: 'The investment platform followed the research.',
        description:
          'VQ Capital Partners began in the research-house tradition of the mid-1990s. Public markets investing and PMS came first; Category II AIFs extended the platform; private equity expanded the ability to invest alongside businesses through later stages of growth. Each step grew from the same underlying work: understand the change, test the economics and assess the company.',
        items: [
          { year: '1995', description: 'ValueQuest in-house research journey begins' },
          { year: '2010', description: 'ValueQuest 2.0 journey begins with the launch of Growth (PMS)' },
          { year: '2014', description: 'Platinum (PMS) launched' },
          { year: '2022', description: 'Our first sovereign wealth fund mandate' },
          { year: '2023', description: 'Launched private equity CAT II SCALE Fund' },
          { year: '2024', description: 'FasterCAP Fund launch- our maiden CAT III AIF' },
          {
            year: '2025',
            description:
              'Launched CAT II: SCALE II & Tristar Fund and CAT III: India G.I.F.T. & India Inflexion Fund',
          },
          { year: '2026', description: 'Launched Founder’s Conviction Large Value Fund' },
        ],
      },
      {
        __component: 'common.main-section',
        label: 'Who we serve',
        name: 'Different pools of capital. A shared need for judgement.',
        description:
          'A suitable investment relationship varies based on horizon, governance needs and the degree of alignment with the investment process. Not simply on the size of an allocation.',
        grid_items: [
          {
            name: 'Individual investors',
            description: 'Investors seeking concentrated, research-led public markets ownership.',
          },
          {
            name: 'Family offices',
            description: 'Long-horizon capital looking for a direct, considered investment relationship.',
          },
          {
            name: 'Institutions',
            description:
              'Allocators whose objectives, governance or reporting requirements call for a dedicated conversation.',
          },
        ],
      },
      {
        __component: 'common.main-section',
        label: 'Risk and governance',
        name: 'Research, risk and governance work together.',
        description:
          'VQ Capital Partners turns regulatory readiness and operational discipline into institutionalized risk controls. This enables easier investing through seamless compliance across the financial ecosystem, and across equity stages.',
      },
      {
        __component: 'common.bottom-link',
        name: 'continue',
        button: {
          buttonText: 'Leadership',
          type: 'Internal',
          buttonType: 'Primary',
          buttonLink: '/leadership',
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

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vq-seed-about-'));
  let app;

  try {
    const { createStrapi } = require('@strapi/strapi');
    app = await createStrapi({ distDir: './dist' }).load();

    const socialId = await ensureSocialMedia(app, tempDir);
    const aboutData = buildAboutData(socialId);

    const existing = await app.documents('api::about.about').findFirst({ status: 'published' });

    if (existing && !FORCE) {
      console.log(`[seed-about] About already published (documentId=${existing.documentId}). Pass --force to overwrite.`);
    } else if (existing && FORCE) {
      const updated = await app.documents('api::about.about').update({
        documentId: existing.documentId,
        data: aboutData,
        status: 'published',
      });
      console.log(`[seed-about] Updated & published About (documentId=${updated.documentId})`);
    } else {
      const created = await app.documents('api::about.about').create({
        data: aboutData,
        status: 'published',
      });
      console.log(`[seed-about] Created & published About (documentId=${created.documentId})`);
    }

    if (EXPORT_JSON) {
      const { syncJSON } = require(path.join(PROJECT_ROOT, 'src/workers/upload-s3'));
      const res = await syncJSON('api::about.about');
      console.log('[seed-about] Export about.json:', res.status, res.message);
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
    console.error('[seed-about] Failed:', err);
    process.exit(1);
  });
