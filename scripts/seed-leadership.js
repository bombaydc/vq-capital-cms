'use strict';

/**
 * Seed script for `api::leadership.leadership` (Single Type),
 * `api::leader.leader` (Collection Type, 23 entries), and their Media Library assets.
 *
 * Usage (from project root, after `npm run build`):
 *   node scripts/seed-leadership.js            # Upload missing media & seed missing entries
 *   node scripts/seed-leadership.js --force    # Overwrite/update existing entries & publish
 *   node scripts/seed-leadership.js --export   # Also export leadership.json & leaders.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SITE_ORIGIN = 'https://vqcapitalpartners.vercel.app';
const FORCE = process.argv.includes('--force');
const EXPORT_JSON = process.argv.includes('--export');

function toSlug(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toHtml(text) {
  if (!text) return null;
  return text
    .split(/\n\n+/)
    .map((p) => `<p>${p.trim()}</p>`)
    .join('');
}

const LEADERS = [
  // Founders (3)
  {
    category: 'Founders',
    name: 'Ravi Dharamshi',
    slug: 'ravi-dharamshi',
    designation: 'Founder & CIO',
    bio: 'Ravi founded ValueQuest and has spent the past 14 years building it from a research-led firm into a diversified asset management platform, with AUM exceeding ₹33,000 crore (USD ~3.21 billion) as of 30 June 2025. Known for his macro-driven approach and long-term strategic vision, he shapes the firm’s investment philosophy across public equities, private equity, PMS strategies and offshore funds.\n\nHe began his career at RARE Enterprises under the mentorship of the late Mr. Rakesh Jhunjhunwala, gaining hands-on experience in equity research, portfolio construction and private equity transactions. Ravi holds an MBA in Finance from the McCallum Graduate School of Business, USA.',
    cardImage: '/team/cutouts/ravi-dharamshi.png',
    profileImage: '/team/ravi-dharamshi.png',
    links: [{ text: 'LinkedIn', href: 'https://in.linkedin.com/in/ravi-dharamshi-8617754' }],
  },
  {
    category: 'Founders',
    name: 'Sameer Shah',
    slug: 'sameer-shah',
    designation: 'Co-Founder & Fund Manager',
    bio: 'With over 25 years of experience in Indian equity markets, Sameer has been central to building ValueQuest into a respected, research-driven investment platform. He leads the firm’s research function, has managed its founding investment strategy since inception, and oversees offshore mandates, while shaping the core investment framework across strategies.\n\nHis approach is anchored in the ValueQuest philosophy: identifying structural megatrends, backing sectors with durable tailwinds, and investing in businesses at key inflection points for the long term. Under his leadership, the team has built a strong culture of fundamental research and high-conviction investing.\n\nSameer also serves as Co-Chair of the IVCA Category III Council, contributing to the growth and policy direction of India’s alternative investment ecosystem.',
    cardImage: '/team/cutouts/sameer-shah.png',
    profileImage: '/team/sameer-shah.png',
    links: [{ text: 'LinkedIn', href: 'https://in.linkedin.com/in/sameer-shah-8989058' }],
  },
  {
    category: 'Founders',
    name: 'Aniket Dharamshi',
    slug: 'aniket-dharamshi',
    designation: 'Co-Founder & Managing Partner',
    bio: 'Aniket has been closely involved in shaping ValueQuest’s investment strategy across public markets and Private Equity, with a focus on spotting emerging opportunities at inflection points. As Fund Manager of the Tristar Fund, he leads investments in structurally evolving sectors such as aerospace, defence, energy transition and advanced manufacturing, backing scalable models and strong management teams.\n\nCombining a deep understanding of market cycles with a disciplined, research-driven approach, he focuses on companies with long-term structural tailwinds that are positioned to become industry leaders. Aniket has been instrumental in expanding ValueQuest’s Private Equity presence, particularly in sectors aligned with India’s evolving industrial and manufacturing ecosystem.',
    cardImage: '/team/cutouts/aniket-dharamshi.png',
    profileImage: '/team/aniket-dharamshi.png',
    links: [{ text: 'LinkedIn', href: 'https://www.linkedin.com/in/aniket-dharamshi-7278391b0/' }],
  },

  // Lead Management Team (15)
  {
    category: 'Lead Management Team',
    name: 'Deepak Ramachandra',
    slug: 'deepak-ramachandra',
    designation: 'Chief Executive Officer',
    bio: 'Deepak leads ValueQuest’s overall strategy, institutional growth and business expansion across its public markets and Private Equity platforms. He brings over 25 years of experience in global financial markets, with deep expertise in equities, investment strategy and institutional business, having held senior leadership roles at Axis Capital, Bank of America Merrill Lynch, Credit Suisse, Sharekhan and Citibank.\n\nAt ValueQuest, he is focused on strengthening the investment platform, scaling its presence across AIF and PMS strategies, and building a globally competitive institutional business, in line with the firm’s research-driven, long-term philosophy. He is recognised for his market acumen, his ability to build high-performing teams, and his experience scaling large investment businesses across geographies.',
    cardImage: '/team/cutouts/deepak-ramachandra.png',
    profileImage: '/team/deepak-ramachandra.png',
    links: [{ text: 'LinkedIn', href: 'https://www.linkedin.com/in/deepak-ramachandra-59a78b7/' }],
  },
  {
    category: 'Lead Management Team',
    name: 'Kunal J. Chandawalla',
    slug: 'kunal-j-chandawalla',
    designation: 'Chief Operating Officer',
    bio: 'Kunal’s career includes Goldman Sachs and Citigroup. With an MBA, a BSc in Computer Science and over 20 years of experience, he serves as VQ Capital Partners’ Chief Operating Officer.',
    cardImage: '/team/cutouts/kunal-chandawalla.png',
    profileImage: '/team/kunal-chandawalla.png',
    links: [{ text: 'Find on LinkedIn', href: 'https://www.linkedin.com/search/results/people/?keywords=Kunal%20J.%20Chandawalla' }],
  },
  {
    category: 'Lead Management Team',
    name: 'Akshada R. Sathe',
    slug: 'akshada-r-sathe',
    designation: 'Head of Human Resources',
    bio: null,
    cardImage: null,
    profileImage: null,
    links: [],
  },
  {
    category: 'Lead Management Team',
    name: 'Khushnum Ichhaporia',
    slug: 'khushnum-ichhaporia',
    designation: 'Chief Marketing Officer',
    bio: null,
    cardImage: null,
    profileImage: null,
    links: [],
  },
  {
    category: 'Lead Management Team',
    name: 'Chirag Shah',
    slug: 'chirag-shah',
    designation: 'Chief Strategy Officer',
    bio: 'Chirag brings over 21 years of experience to VQ Capital Partners’ strategy function. A chartered accountant, he previously headed the Private Client Group at ICICI Securities.',
    cardImage: '/team/cutouts/chirag-shah.png',
    profileImage: '/team/chirag-shah.png',
    links: [{ text: 'LinkedIn', href: 'https://in.linkedin.com/in/chirag-shah-7412aba5' }],
  },
  {
    category: 'Lead Management Team',
    name: 'Ankit Gala',
    slug: 'ankit-gala',
    designation: 'Chief Business Officer, Domestic',
    bio: 'Ankit brings over 17 years of experience to VQ Capital Partners’ domestic business. With an MBA in Finance, he previously served as a Managing Partner at Nuvama Group.',
    cardImage: '/team/cutouts/ankit-gala.png',
    profileImage: '/team/ankit-gala.png',
    links: [{ text: 'LinkedIn', href: 'https://www.linkedin.com/in/ankitgala/' }],
  },
  {
    category: 'Lead Management Team',
    name: 'Himanshoo Bohara',
    slug: 'himanshoo-bohara',
    designation: 'Chief Financial Officer',
    bio: 'Himanshoo joined VQ Capital Partners after serving as CFO and Director at PPFAS Mutual Fund. A chartered accountant and company secretary, he brings over 25 years of experience.',
    cardImage: '/team/cutouts/himanshoo-bohara.png',
    profileImage: '/team/himanshoo-bohara.png',
    links: [{ text: 'Find on LinkedIn', href: 'https://www.linkedin.com/search/results/people/?keywords=Himanshoo%20Bohara' }],
  },
  {
    category: 'Lead Management Team',
    name: 'Ashish Gupta',
    slug: 'ashish-gupta',
    designation: 'Senior Managing Director, Group Strategy and Head of Investments',
    bio: null,
    cardImage: null,
    profileImage: null,
    links: [],
  },
  {
    category: 'Lead Management Team',
    name: 'Dr. Arvind Ananthnarayanan',
    slug: 'dr-arvind-ananthnarayanan',
    designation: 'Partner — Private Equity',
    bio: null,
    cardImage: '/team/cutouts/private-equity-arvind.png',
    profileImage: null,
    links: [],
  },
  {
    category: 'Lead Management Team',
    name: 'Sachin Mehta',
    slug: 'sachin-mehta',
    designation: 'Partner — Private Equity',
    bio: null,
    cardImage: '/team/cutouts/private-equity-sachin.png',
    profileImage: null,
    links: [],
  },
  {
    category: 'Lead Management Team',
    name: 'Niyati Tanna',
    slug: 'niyati-tanna',
    designation: 'Partner — Private Equity',
    bio: null,
    cardImage: '/team/cutouts/private-equity-niyati.png',
    profileImage: null,
    links: [],
  },
  {
    category: 'Lead Management Team',
    name: 'Hiten Gala',
    slug: 'hiten-gala',
    designation: 'Chief Compliance Officer',
    bio: 'A chartered accountant with over 21 years of experience, Hiten leads compliance at VQ Capital Partners. His career includes roles at Sharekhan and E-serve.',
    cardImage: '/team/cutouts/hiten-gala-v2.png',
    profileImage: '/team/hiten-gala-v2.png',
    links: [{ text: 'LinkedIn', href: 'https://in.linkedin.com/in/hiten-gala-a8766480' }],
  },
  {
    category: 'Lead Management Team',
    name: 'Anand Barbhaya',
    slug: 'anand-barbhaya',
    designation: 'Head of Operation',
    bio: 'Anand brings over 22 years of experience to VQ Capital Partners’ operations. A chartered accountant, he worked at Sharekhan before joining the firm.',
    cardImage: '/team/cutouts/anand-barbhaya-v2.png',
    profileImage: '/team/anand-barbhaya-v2.png',
    links: [{ text: 'LinkedIn', href: 'https://www.linkedin.com/in/anand-barbhaya-0b6b4122/' }],
  },
  {
    category: 'Lead Management Team',
    name: 'Aniruddha Marathe',
    slug: 'aniruddha-marathe',
    designation: 'Head of Engineering',
    bio: null,
    cardImage: null,
    profileImage: null,
    links: [],
  },
  {
    category: 'Lead Management Team',
    name: 'Gaurav Maheshwari',
    slug: 'gaurav-maheshwari',
    designation: 'Co-Fund Manager',
    bio: null,
    cardImage: null,
    profileImage: null,
    links: [],
  },

  // Board of Directors (5)
  {
    category: 'Board of Directors',
    name: 'Darius Dinshaw Pandole',
    slug: 'darius-dinshaw-pandole',
    designation: 'Independent Director',
    bio: 'Mr. Darius Dinshaw Pandole has been appointed as an Independent Director of the Company. He holds a degree in Bachelors in Economics from Harvard University (1988) and an MBA from the University of Chicago (1992). He was the Managing Director and CEO - Private Equity and Equity AIFs, at JM Financial Ltd., a leading, listed financial services company in India. During this time, he led all aspects of the private equity platform at JM Financial Ltd., managing multiple PE funds raised from institutional, corporate and high net worth individual investors. Darius serves as an independent director on the board of directors of Mahindra Logistics Limited, Fairchem Organics Limited and the Cricket Club of India Limited (Executive Committee). He has previously served as a director on the boards of various companies including Tata Global Beverages Ltd., Tata Global Beverages Group UK, NourishCo Beverages Ltd (joint venture between Tata and PepsiCo), JM Financial Asset Management Ltd., VRL Logistics Ltd., and Spandana Sphoorty Financial Ltd.',
    cardImage: '/team/cutouts/darius-dinshaw-pandole.png',
    profileImage: '/team/darius-dinshaw-pandole.png',
    links: [],
  },
  {
    category: 'Board of Directors',
    name: 'Chirag Manubhai Shah',
    slug: 'chirag-manubhai-shah',
    designation: 'Independent Director',
    bio: 'Mr. Chirag Manubhai Shah has been appointed as an Independent Director of the Company. He holds a degree in Economics (1996) and Law (2018) from Mumbai University. He has over 25 years of experience in the Securities, Commodities, Fixed Income and Foreign Exchange markets. Before qualifying as a lawyer in 2018 from Mumbai University, he worked with Phillip Capital, MF Global, Man Financial and Refco. He was a member of their founding team and held various leadership roles within those firms. Since 2018 he has been practicing law in various capacities before going independent in 2022 and appears as a counsel across courts of India.',
    cardImage: '/team/cutouts/chirag-manubhai-shah.png',
    profileImage: '/team/chirag-manubhai-shah.png',
    links: [],
  },
  {
    category: 'Board of Directors',
    name: 'Aniket Dharamshi',
    slug: 'aniket-dharamshi-board',
    designation: 'Executive Director',
    bio: 'Aniket has been closely involved in shaping ValueQuest’s investment strategy across public markets and Private Equity, with a focus on spotting emerging opportunities at inflection points. As Fund Manager of the Tristar Fund, he leads investments in structurally evolving sectors such as aerospace, defence, energy transition and advanced manufacturing, backing scalable models and strong management teams.',
    cardImage: '/team/cutouts/aniket-dharamshi.png',
    profileImage: null,
    links: [],
  },
  {
    category: 'Board of Directors',
    name: 'Ravi Dharamshi',
    slug: 'ravi-dharamshi-board',
    designation: 'Chairman and Executive Director',
    bio: 'Ravi founded ValueQuest and has spent the past 14 years building it from a research-led firm into a diversified asset management platform, with AUM exceeding ₹33,000 crore (USD ~3.21 billion) as of 30 June 2025. Known for his macro-driven approach and long-term strategic vision, he shapes the firm’s investment philosophy across public equities, private equity, PMS strategies and offshore funds.',
    cardImage: '/team/cutouts/ravi-dharamshi.png',
    profileImage: null,
    links: [],
  },
  {
    category: 'Board of Directors',
    name: 'Sameer Shah',
    slug: 'sameer-shah-board',
    designation: 'Executive Director',
    bio: 'With over 25 years of experience in Indian equity markets, Sameer has been central to building ValueQuest into a respected, research-driven investment platform. He leads the firm’s research function, has managed its founding investment strategy since inception, and oversees offshore mandates, while shaping the core investment framework across strategies.',
    cardImage: '/team/cutouts/sameer-shah.png',
    profileImage: null,
    links: [],
  },
];

async function ensureMedia(app, uploadService, tempDir, urlPath, uniqueName) {
  if (!urlPath) return null;
  const fullUrl = urlPath.startsWith('http') ? urlPath : `${SITE_ORIGIN}${urlPath}`;
  const fileName = uniqueName || path.basename(urlPath);

  const existing = await app.db.query('plugin::upload.file').findOne({ where: { name: fileName } });
  if (existing) {
    return existing.id;
  }

  try {
    const res = await fetch(fullUrl);
    if (!res.ok) {
      console.warn(`[seed-leadership] Failed to download ${fullUrl}: HTTP ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const dest = path.join(tempDir, fileName);
    fs.writeFileSync(dest, buf);

    const [uploaded] = await uploadService.upload({
      data: { fileInfo: { name: fileName, alternativeText: fileName } },
      files: {
        filepath: dest,
        originalFilename: fileName,
        mimetype: fileName.endsWith('.webp') ? 'image/webp' : 'image/png',
        size: buf.length,
      },
    });
    console.log(`[seed-leadership] Uploaded ${fileName} -> id=${uploaded.id}`);
    return uploaded.id;
  } catch (err) {
    console.warn(`[seed-leadership] Error uploading ${fullUrl}: ${err.message}`);
    return null;
  }
}

async function run() {
  process.chdir(PROJECT_ROOT);
  require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });

  if (!fs.existsSync(path.join(PROJECT_ROOT, 'dist/config/database.js'))) {
    throw new Error('dist/ not built. Run `npm run build` first.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vq-seed-leadership-'));
  let app;

  try {
    const { createStrapi } = require('@strapi/strapi');
    app = await createStrapi({ distDir: './dist' }).load();
    const uploadService = app.plugin('upload').service('upload');

    // Upload shared SEO image
    const socialId = await ensureMedia(
      app,
      uploadService,
      tempDir,
      'https://wondrous-sawine-0270e5.netlify.app/vq-social-preview.png',
      'vq-social-preview.png'
    );

    // Seed Leadership Single Type
    const leadershipData = {
      label: 'Leadership',
      name: 'The people behind the investment decisions.',
      description:
        'VQ Capital Partners is led by investors who built their practice before they built a firm. Leadership here means stewardship of capital, standards and the next generation of decision-makers.',
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
          __component: 'common.dynamic-section',
          name: 'Leaders',
          type: 'leader-list',
        },
        {
          __component: 'common.bottom-link',
          name: 'continue',
          button: {
            buttonText: 'News & Events',
            type: 'Internal',
            buttonType: 'Primary',
            buttonLink: '/in-the-news',
          },
        },
      ],
    };

    const existingLeadership = await app
      .documents('api::leadership.leadership')
      .findFirst({ status: 'published' });

    if (existingLeadership && !FORCE) {
      console.log(`[seed-leadership] Leadership already published (documentId=${existingLeadership.documentId}).`);
    } else if (existingLeadership && FORCE) {
      const updated = await app.documents('api::leadership.leadership').update({
        documentId: existingLeadership.documentId,
        data: leadershipData,
        status: 'published',
      });
      console.log(`[seed-leadership] Updated & published Leadership (documentId=${updated.documentId})`);
    } else {
      const created = await app.documents('api::leadership.leadership').create({
        data: leadershipData,
        status: 'published',
      });
      console.log(`[seed-leadership] Created & published Leadership (documentId=${created.documentId})`);
    }

    // Seed all 23 Leader entries
    for (const person of LEADERS) {
      const slug = person.slug || toSlug(person.name);
      const cardUniqueName = person.cardImage ? `cutout-${path.basename(person.cardImage)}` : null;
      const profileUniqueName = person.profileImage ? `profile-${path.basename(person.profileImage)}` : null;

      const cardImageId = await ensureMedia(app, uploadService, tempDir, person.cardImage, cardUniqueName);
      const profileImageId = await ensureMedia(app, uploadService, tempDir, person.profileImage, profileUniqueName);

      const leaderData = {
        name: person.name,
        slug,
        category: person.category,
        designation: person.designation,
        ...(person.bio ? { description: toHtml(person.bio) } : {}),
        ...(cardImageId ? { card_image: cardImageId } : {}),
        ...(profileImageId ? { profile_image: profileImageId } : {}),
        buttons: person.links.map((l) => ({
          buttonText: l.text,
          type: 'External',
          buttonType: 'Primary',
          buttonLink: l.href,
        })),
        seo: {
          metaTitle: `${person.name} — ${person.designation} | VQ Capital Partners`,
          metaDescription: person.bio ? person.bio.split('\n')[0].slice(0, 160) : `${person.name}, ${person.designation} at VQ Capital Partners.`,
          ...(profileImageId || cardImageId ? { metaImage: profileImageId || cardImageId } : {}),
        },
      };

      const existing = await app.documents('api::leader.leader').findFirst({
        filters: { slug: { $eq: slug } },
        status: 'published',
      });

      if (existing && !FORCE) {
        console.log(`[seed-leadership] Leader exists: ${person.name} (${slug})`);
      } else if (existing && FORCE) {
        await app.documents('api::leader.leader').update({
          documentId: existing.documentId,
          data: leaderData,
          status: 'published',
        });
        console.log(`[seed-leadership] Updated & published Leader: ${person.name} (${slug})`);
      } else {
        await app.documents('api::leader.leader').create({
          data: leaderData,
          status: 'published',
        });
        console.log(`[seed-leadership] Created & published Leader: ${person.name} (${slug})`);
      }
    }

    if (EXPORT_JSON) {
      const { syncJSON } = require(path.join(PROJECT_ROOT, 'src/workers/upload-s3'));
      const r1 = await syncJSON('api::leadership.leadership');
      console.log('[seed-leadership] Export leadership.json:', r1.status, r1.message);
      const r2 = await syncJSON('api::leader.leader');
      console.log('[seed-leadership] Export leaders.json:', r2.status, r2.message);
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
    console.error('[seed-leadership] Failed:', err);
    process.exit(1);
  });
