'use strict';

/**
 * Seed script for `api::legal-page.legal-page` (Collection Type: 4 pages):
 *   - regulatory-information
 *   - disclaimer
 *   - privacy-policy
 *   - terms-of-use
 *
 * Usage (from project root, after `npm run build`):
 *   node scripts/seed-legal-pages.js            # Create & publish missing pages
 *   node scripts/seed-legal-pages.js --force    # Overwrite/update & publish all 4 pages
 *   node scripts/seed-legal-pages.js --export   # Also export public/uploads/data/legal-pages.json
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
    console.warn('[seed-legal-pages] Social image upload skipped:', err.message);
    return null;
  }
}

function buildSeo(socialId) {
  return {
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
  };
}

function docItem(name, description, href) {
  const isInternal = href.startsWith('/');
  return {
    name,
    description,
    button: {
      buttonText: 'Read more',
      type: isInternal ? 'Internal' : href.startsWith('mailto:') ? 'Email' : 'External',
      buttonType: 'Primary',
      buttonLink: href,
    },
  };
}

function buildPages(socialId) {
  const seo = buildSeo(socialId);

  return [
    {
      slug: 'regulatory-information',
      label: 'Disclosures',
      name: 'Regulatory information.',
      description:
        'Registrations, investor documents, grievance pathways and statutory disclosures for VQ Capital Partners’ regulated businesses.',
      note: 'VQ Capital Partners Investment Advisors Private Limited · CIN U65991MH2010PTC198452 · SEBI PMS Registration INP000003724',
      seo,
      content: [
        {
          __component: 'common.main-section',
          label: 'The regulated entity',
          name: 'Registration and access.',
          grid_items: [
            { name: 'Corporate identity', description: 'CIN U65991MH2010PTC198452' },
            { name: 'Portfolio manager', description: 'SEBI Registration INP000003724' },
            {
              name: 'Direct onboarding',
              description: 'Available to eligible clients in accordance with applicable SEBI requirements.',
            },
          ],
        },
        {
          __component: 'common.main-section',
          label: 'Common disclosures',
          name: 'Corporate and investor documents.',
          list_items: [
            docItem(
              'SEBI Master Circular for Online Resolution of Disputes',
              'Master circular establishing the common online dispute-resolution framework.',
              'https://www.valuequest.in/wp-content/uploads/2024/11/SEBI-master-circular.pdf'
            ),
            docItem(
              'Investor Grievance Redressal Policy',
              'VQ Capital Partners’ process for receiving, escalating and resolving investor complaints.',
              'https://www.valuequest.in/wp-content/uploads/2025/04/Investor-Grievance-Redressal-Policy.pdf'
            ),
            docItem(
              'Annual Return · FY 2020–21',
              'Statutory annual return filed for the financial year.',
              'https://www.valuequest.in/wp-content/uploads/2025/08/AR-2020-21.pdf'
            ),
            docItem(
              'Annual Return · FY 2021–22',
              'Statutory annual return filed for the financial year.',
              'https://www.valuequest.in/wp-content/uploads/2025/08/AR-2021-22.pdf'
            ),
            docItem(
              'Annual Return · FY 2022–23',
              'Statutory annual return filed for the financial year.',
              'https://www.valuequest.in/wp-content/uploads/2025/08/AR-2022-23.pdf'
            ),
            docItem(
              'Annual Return · FY 2023–24',
              'Statutory annual return filed for the financial year.',
              'https://www.valuequest.in/wp-content/uploads/2025/08/AR-2023-24.pdf'
            ),
            docItem(
              'Annual Return · FY 2024–25',
              'Statutory annual return filed for the financial year.',
              'https://www.valuequest.in/wp-content/uploads/2026/06/Annual-Return-2024-25.pdf'
            ),
            docItem(
              'Common SOP for Centralized Demise Information',
              'Standard operating procedure for centralized reporting of an investor’s demise.',
              '/documents/Common-SOP-for-Centralized-Demise-information.pdf'
            ),
            docItem(
              'CSR Policy',
              'Corporate Social Responsibility policy.',
              '/documents/CSR-Policy.pdf'
            ),
            docItem(
              'EPFO Form 5A',
              'VQ Capital Partners Form 5A extract.',
              '/documents/VQ-Form-5A-Extract.pdf'
            ),
            docItem(
              'SEBI Registration',
              'SEBI registration list.',
              '/documents/SEBI_Registration_List.pdf'
            ),
          ],
        },
        {
          __component: 'common.main-section',
          label: 'Portfolio management services',
          name: 'PMS documents.',
          list_items: [
            docItem(
              'Investor Charter',
              'Investor rights, responsibilities, services and grievance mechanisms for portfolio-management clients.',
              'https://www.valuequest.in/wp-content/uploads/2026/05/Investor-Charter-May-26_.pdf'
            ),
            docItem(
              'Disclosure Document',
              'The current VQ Capital Partners PMS disclosure document.',
              'https://www.valuequest.in/wp-content/uploads/2025/11/disclosure-doc.pdf'
            ),
            docItem(
              'Payment via UPI for PMS',
              'Information on making permitted PMS payments through UPI.',
              'https://www.valuequest.in/wp-content/uploads/2025/10/PAYMENT-VIA-UPI-FOR-PMS.pdf'
            ),
            docItem(
              'Artificial-intelligence framework under PMS',
              'VQ Capital Partners’ framework governing the use of artificial intelligence within PMS activities.',
              'https://www.valuequest.in/wp-content/uploads/2023/10/VQ-AI_Framwork-_under_PMS.pdf'
            ),
            docItem(
              'Investor Complaints · September 2026',
              'PMS investor complaint status and monthly and annual disposal trends as at 30 September 2026.',
              '/documents/Investor-Complaints-September-2026.jpg'
            ),
          ],
        },
        {
          __component: 'common.main-section',
          label: 'Alternative investment funds',
          name: 'Domestic and offshore disclosures.',
          list_items: [
            docItem(
              'Domestic AIFs',
              'Regulatory information for the alternative investment funds and schemes managed by the VQ Capital Partners group.',
              'https://www.valuequest.in/wp-content/uploads/2025/10/AIFs-managed-by-VQIAPL.pdf'
            ),
            docItem(
              'Stewardship Code',
              'Policies governing stewardship responsibilities in relation to investee companies.',
              'https://www.valuequest.in/wp-content/uploads/2026/04/VQ_Stewardship_Policy.pdf'
            ),
            docItem(
              'GIFT IFSC grievance policy',
              'Complaint handling and grievance redressal for VQ Capital Partners’ GIFT IFSC branch.',
              'https://www.valuequest.in/wp-content/uploads/2025/10/Complaint-Handling-and-Grievance-Redressal-of-GIFT-IFSC-Branch.pdf'
            ),
          ],
        },
        {
          __component: 'common.main-section',
          label: 'Investor grievances',
          name: 'A clear escalation path.',
          grid_items: [
            docItem(
              'VQ Capital Partners Compliance',
              'Email complaints@valuequest.in or call +91 22 6939 4444. VQ Capital Partners states that it will endeavour to resolve an investor complaint within 21 calendar days of receipt.',
              'mailto:complaints@valuequest.in'
            ),
            docItem(
              'Principal Officer',
              'If the first response is not satisfactory, escalate the matter in writing to pms.assist@valuequest.in.',
              'mailto:pms.assist@valuequest.in'
            ),
            docItem(
              'SEBI SCORES',
              'After the intermediary-level process, an eligible complaint may be lodged with SEBI through its Complaints Redress System.',
              'https://scores.sebi.gov.in/'
            ),
            docItem(
              'SMART ODR',
              'After exhausting the available grievance options, an eligible unresolved dispute may proceed to online conciliation or arbitration through the SMART ODR portal.',
              'https://smartodr.in/login'
            ),
          ],
        },
        {
          __component: 'common.faq-section',
          label: 'PMS questions',
          name: 'Practical information for investors.',
          description: 'Read frequently asked questions',
          faqs: [
            {
              question: 'What service does VQ Capital Partners offer?',
              answer:
                '<p>VQ Capital Partners currently offers discretionary Portfolio Management Services. Under this arrangement, the portfolio manager makes investment decisions for each client in accordance with the client’s agreed profile and mandate.</p>',
            },
            {
              question: 'What is the minimum corpus?',
              answer:
                '<p>The current regulatory minimum is ₹50 lakh. The corpus may be introduced in cash or, subject to the applicable process, through a transfer of eligible securities.</p>',
            },
            {
              question: 'How are fees charged?',
              answer:
                '<p>Fees are set out in the client agreement and may be fixed, performance-based or a combination of both. Portfolio managers may not charge an upfront fee, directly or indirectly.</p>',
            },
            {
              question: 'Is partial withdrawal permitted?',
              answer:
                '<p>A client may make a partial withdrawal in accordance with the agreement, provided the remaining portfolio value does not fall below the applicable minimum investment amount.</p>',
            },
            {
              question: 'Is there a lock-in?',
              answer:
                '<p>A portfolio manager cannot impose a lock-in, although an applicable early-exit fee may be charged in accordance with the client agreement and SEBI requirements.</p>',
            },
            {
              question: 'Are returns guaranteed?',
              answer:
                '<p>No. Portfolio managers cannot guarantee a minimum return. Historical performance is not an assurance of future results.</p>',
            },
            {
              question: 'Where can portfolio-manager information be verified?',
              answer:
                '<p>SEBI publishes regulations, circulars and information on registered portfolio managers on its website.</p>',
              button: {
                buttonText: 'Read more',
                type: 'External',
                buttonType: 'Primary',
                buttonLink: 'https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doPmr=yes',
              },
            },
          ],
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
    },
    {
      slug: 'disclaimer',
      label: 'Legal / Website information',
      name: 'Disclaimer.',
      description: 'Important information about the scope, limitations and appropriate use of this website.',
      note: 'Draft template · Subject to review and approval by VQ Capital Partners’ legal and compliance teams before publication.',
      seo,
      content: [
        {
          __component: 'common.rich-text-section',
          label: 'Purpose',
          name: 'Information, not an offer.',
          description:
            '<p>This website is provided for general information and reference. Nothing on it constitutes investment, legal, tax or other professional advice; an offer, invitation or solicitation to acquire or dispose of any security or investment product; or a recommendation suitable for any particular investor.</p>',
        },
        {
          __component: 'common.rich-text-section',
          label: 'Investment risk',
          name: 'No assurance of outcome.',
          description:
            '<p>Investments in securities and alternative investment products involve risk, including possible loss of capital. Past performance is not indicative of future results. No return, objective or investment outcome is assured or guaranteed, and performance-related information on this website is not verified by SEBI unless expressly stated otherwise.</p>',
          grid_items: [
            {
              name: 'Independent assessment',
              description:
                'Investors should evaluate suitability, risk and liquidity in light of their own circumstances.',
            },
            {
              name: 'Professional advice',
              description:
                'Appropriate legal, tax, financial and investment advice should be obtained before a decision is made.',
            },
            {
              name: 'Governing documents',
              description:
                'Executed agreements, offering documents and current regulatory disclosures prevail over website summaries.',
            },
          ],
        },
        {
          __component: 'common.rich-text-section',
          label: 'Information and interests',
          name: 'Reasonable care, not a warranty.',
          description:
            '<p>Information may be drawn from internal work, public sources and third parties believed to be reliable. VQ Capital Partners does not warrant that all website information is accurate, complete or current and is not obliged to update it. VQ Capital Partners, its affiliates and personnel may hold or transact in securities discussed on the website, as permitted by applicable law and policy.</p>',
        },
        {
          __component: 'common.rich-text-section',
          label: 'Jurisdiction',
          name: 'Access may be restricted.',
          description:
            '<p>The availability and distribution of information may be restricted by law in certain jurisdictions. Each visitor is responsible for observing applicable restrictions. Links to third-party websites are provided for convenience and are accessed at the visitor’s own risk.</p><p><em>Draft legal template. Confirm defined entities, conflicts language, jurisdictional gating and all mandatory product-specific risk statements before publication.</em></p>',
        },
        {
          __component: 'common.bottom-link',
          name: 'continue',
          button: {
            buttonText: 'Regulatory information',
            type: 'Internal',
            buttonType: 'Primary',
            buttonLink: '/regulatory-information',
          },
        },
      ],
    },
    {
      slug: 'privacy-policy',
      label: 'Legal / Personal information',
      name: 'Privacy policy.',
      description:
        'A draft framework describing how personal information may be collected, used, protected and retained through the VQ Capital Partners website.',
      note: 'Draft template · This must be reconciled with VQ Capital Partners’ actual systems, vendors, retention schedules and legal obligations.',
      seo,
      content: [
        {
          __component: 'common.rich-text-section',
          label: 'Scope',
          name: 'Information connected with an enquiry or visit.',
          description:
            '<p>Depending on the website services used, VQ Capital Partners may receive contact and professional information submitted by a visitor, correspondence and enquiry details, event or publication preferences, and technical information generated when the website is accessed.</p>',
          grid_items: [
            {
              name: 'Information you provide',
              description: 'Name, organisation, role, contact details and the contents of an enquiry or request.',
            },
            {
              name: 'Technical information',
              description:
                'Device, browser, approximate location, referral and usage information collected through security, server or analytics tools.',
            },
            {
              name: 'Relationship information',
              description:
                'Records necessary to respond to an enquiry, administer an event or maintain an existing business relationship.',
            },
          ],
        },
        {
          __component: 'common.rich-text-section',
          label: 'Use',
          name: 'Limited to a defined purpose.',
          description:
            '<p>Personal information may be used to respond to requests, provide requested publications or event information, maintain website security, comply with legal and regulatory duties, administer a business relationship and improve the clarity and performance of the website.</p>',
        },
        {
          __component: 'common.rich-text-section',
          label: 'Sharing and retention',
          name: 'Controlled access, proportionate retention.',
          description:
            '<p>Information may be shared with VQ Capital Partners group entities, professional advisers, regulators and service providers where required for a stated purpose or legal obligation. It should be retained only for as long as required by that purpose, applicable law, regulatory recordkeeping or the resolution of a dispute.</p>',
        },
        {
          __component: 'common.rich-text-section',
          label: 'Choices and contact',
          name: 'Questions should have a clear route.',
          description:
            '<p>Subject to applicable law, a person may ask about personal information held by VQ Capital Partners, request a correction or raise a privacy concern. Until a dedicated privacy address is confirmed, enquiries may be directed to <a href="mailto:info@valuequest.in">info@valuequest.in</a>.</p><p><em>Draft privacy template. Confirm consent language, cookies, analytics, cross-border transfers, processors, data-subject rights, grievance officer details and retention periods before publication.</em></p>',
        },
        {
          __component: 'common.bottom-link',
          name: 'continue',
          button: {
            buttonText: 'Terms of use',
            type: 'Internal',
            buttonType: 'Primary',
            buttonLink: '/terms-of-use',
          },
        },
      ],
    },
    {
      slug: 'terms-of-use',
      label: 'Legal / Website access',
      name: 'Terms of use.',
      description: 'The proposed terms governing access to and use of the VQ Capital Partners website.',
      note: 'Draft template · Final provisions, governing law and jurisdiction must be approved by legal counsel.',
      seo,
      content: [
        {
          __component: 'common.rich-text-section',
          label: 'Acceptance',
          name: 'Use of the website carries conditions.',
          description:
            '<p>By accessing or using this website, a visitor agrees to these terms and confirms that they have the legal capacity to do so. A visitor who does not agree should discontinue use. Certain products, services and information may also be subject to separate agreements, eligibility requirements and jurisdictional restrictions.</p>',
        },
        {
          __component: 'common.rich-text-section',
          label: 'Permitted use',
          name: 'Read, evaluate and correspond responsibly.',
          description:
            '<p>The website may be used for lawful personal or professional information purposes. No visitor may interfere with its operation, attempt unauthorised access, introduce malicious code, misrepresent identity or authority, scrape content at scale, or use the website in a manner that infringes another person’s rights.</p>',
        },
        {
          __component: 'common.rich-text-section',
          label: 'Content and ownership',
          name: 'The work remains protected.',
          description:
            '<p>Unless otherwise stated, website content, design, research, trade names and associated intellectual property belong to VQ Capital Partners or their respective licensors. Limited viewing and printing for personal reference does not transfer ownership or permit republication, commercial exploitation or modification without prior written consent.</p>',
        },
        {
          __component: 'common.rich-text-section',
          label: 'Availability and liability',
          name: 'Access may change without notice.',
          description:
            '<p>VQ Capital Partners may change, suspend or withdraw website content or functionality. To the extent permitted by law, VQ Capital Partners is not liable for loss arising from reliance on website information, interruption, technical failure, malicious software or third-party websites. Nothing in these terms excludes liability that cannot lawfully be excluded.</p><p><em>Draft terms template. Confirm age threshold, intellectual-property permissions, limitation of liability, indemnity, governing law, jurisdiction and change-notification provisions before publication.</em></p>',
        },
        {
          __component: 'common.bottom-link',
          name: 'continue',
          button: {
            buttonText: 'Regulatory information',
            type: 'Internal',
            buttonType: 'Primary',
            buttonLink: '/regulatory-information',
          },
        },
      ],
    },
  ];
}

async function run() {
  process.chdir(PROJECT_ROOT);
  require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });

  if (!fs.existsSync(path.join(PROJECT_ROOT, 'dist/config/database.js'))) {
    throw new Error('dist/ not built. Run `npm run build` first.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vq-seed-legal-'));
  let app;

  try {
    const { createStrapi } = require('@strapi/strapi');
    app = await createStrapi({ distDir: './dist' }).load();

    const socialId = await ensureSocialMedia(app, tempDir);
    const pages = buildPages(socialId);

    for (const page of pages) {
      const existing = await app.documents('api::legal-page.legal-page').findFirst({
        filters: { slug: { $eq: page.slug } },
        status: 'published',
      });

      if (existing && !FORCE) {
        console.log(`[seed-legal-pages] Exists: ${page.slug} (documentId=${existing.documentId})`);
      } else if (existing && FORCE) {
        const updated = await app.documents('api::legal-page.legal-page').update({
          documentId: existing.documentId,
          data: page,
          status: 'published',
        });
        console.log(`[seed-legal-pages] Updated & published: ${page.slug} (documentId=${updated.documentId})`);
      } else {
        const created = await app.documents('api::legal-page.legal-page').create({
          data: page,
          status: 'published',
        });
        console.log(`[seed-legal-pages] Created & published: ${page.slug} (documentId=${created.documentId})`);
      }
    }

    if (EXPORT_JSON) {
      const { syncJSON } = require(path.join(PROJECT_ROOT, 'src/workers/upload-s3'));
      const res = await syncJSON('api::legal-page.legal-page');
      console.log('[seed-legal-pages] Export legal-pages.json:', res.status, res.message);
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
    console.error('[seed-legal-pages] Failed:', err);
    process.exit(1);
  });
