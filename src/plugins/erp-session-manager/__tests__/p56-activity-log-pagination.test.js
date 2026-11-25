'use strict';

/**
 * P56 — Activity Log pagination stays a usable size
 *
 * Tester observation: "pagination and page view not proper" on
 * /admin/plugins/erp-session-manager/activity-log.
 *
 * The page rendered one PageLink per page:
 *
 *     Array.from({ length: pagination.pageCount }, (_, i) => <PageLink .../>)
 *
 * With 4,326 rows at 25 per page that is 174 links laid out in a single row —
 * the bar ran off the page and the control was unusable. buildPageList() now
 * windows it to first, last, and a span either side of the current page, with
 * 'dots' markers where the run breaks.
 *
 * Covers:
 *   (A) Small page counts render every page, unchanged
 *   (B) Large page counts stay bounded regardless of size
 *   (C) First, last and current are always reachable
 *   (D) Dots appear only where pages are actually skipped
 */

const fc   = require('fast-check');
const fs   = require('fs');
const path = require('path');

// The admin source is ESM and this jest project has no babel transform (and no
// preset installed), so the module is loaded by evaluating its real source with
// the export keywords stripped. That keeps the test bound to the shipped file
// rather than a copy, without pulling babel into the plugin for one helper.
const SRC = fs.readFileSync(
  path.join(__dirname, '../admin/src/pages/ActivityLog/pagination.js'),
  'utf8'
);
// Strip the ESM keywords line-wise: no regex, so nothing depends on line
// endings or escaping. The `export default` line is dropped outright, since
// removing just the keyword would leave `default buildPageList;`.
const BODY = SRC
  .split('\n')
  .filter((line) => !line.trim().startsWith('export default'))
  .join('\n')
  .split('export ')
  .join('');

const buildPageList = new Function(`${BODY}
return buildPageList;`)();

const nums = (list) => list.filter((x) => x !== 'dots');

describe('A — small page counts are listed in full', () => {
  test.each([
    [0, []],
    [1, [1]],
    [2, [1, 2]],
    [5, [1, 2, 3, 4, 5]],
    [7, [1, 2, 3, 4, 5, 6, 7]],
  ])('pageCount %i', (pageCount, expected) => {
    expect(buildPageList(1, pageCount)).toEqual(expected);
  });

  test('no dots are emitted when every page is shown', () => {
    expect(buildPageList(3, 7)).not.toContain('dots');
  });
});

describe('B — large page counts stay bounded', () => {
  test('the reported case: 174 pages renders a handful of links', () => {
    const list = buildPageList(1, 174);
    expect(nums(list).length).toBeLessThanOrEqual(8);
    expect(list.length).toBeLessThanOrEqual(10);
  });

  test('property: never more than 10 entries, at any page of any size', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        (pageCount, rawCurrent) => {
          const current = Math.min(rawCurrent, pageCount);
          expect(buildPageList(current, pageCount).length).toBeLessThanOrEqual(10);
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('C — the important pages are always reachable', () => {
  test('property: first, last and current are present', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        (pageCount, rawCurrent) => {
          const current = Math.min(rawCurrent, pageCount);
          const list = nums(buildPageList(current, pageCount));
          expect(list).toContain(1);
          expect(list).toContain(pageCount);
          expect(list).toContain(current);
        }
      ),
      { numRuns: 300 }
    );
  });

  test('property: pages are ascending and unique', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        (pageCount, rawCurrent) => {
          const list = nums(buildPageList(Math.min(rawCurrent, pageCount), pageCount));
          expect([...new Set(list)]).toEqual(list);
          expect([...list].sort((a, b) => a - b)).toEqual(list);
        }
      ),
      { numRuns: 300 }
    );
  });

  test('walking through the middle keeps the neighbours visible', () => {
    const list = nums(buildPageList(87, 174));
    expect(list).toEqual(expect.arrayContaining([86, 87, 88]));
  });
});

describe('D — dots mark real gaps only', () => {
  test('property: a dots marker always separates non-consecutive pages', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        (pageCount, rawCurrent) => {
          const list = buildPageList(Math.min(rawCurrent, pageCount), pageCount);
          for (let i = 1; i < list.length; i += 1) {
            if (list[i] === 'dots') continue;
            if (list[i - 1] === 'dots') continue;
            // two adjacent numbers must be consecutive
            expect(list[i] - list[i - 1]).toBe(1);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  test('no dots at the very start or end', () => {
    for (const [cur, count] of [[1, 174], [174, 174], [87, 174]]) {
      const list = buildPageList(cur, count);
      expect(list[0]).not.toBe('dots');
      expect(list[list.length - 1]).not.toBe('dots');
    }
  });

  test('near the start there is no leading gap', () => {
    expect(buildPageList(2, 174).slice(0, 3)).toEqual([1, 2, 3]);
  });
});
