/**
 * Pagination helpers for the Activity Log page.
 *
 * Kept in a plain .js module (not the .jsx page) so it is unit-testable — the
 * plugin's jest config has no JSX transform.
 */

/**
 * Page numbers to render, with 'dots' markers where the run is broken.
 *
 * The page used to render one link per page:
 *
 *     Array.from({ length: pageCount }, (_, i) => <PageLink … />)
 *
 * At 4,326 rows and 25 per page that is 174 links in a single row — the bar ran
 * off the screen and the control was unusable. This windows the list to first,
 * last, and `span` pages either side of the current one.
 *
 * @param {number} current — 1-based current page
 * @param {number} pageCount — total pages
 * @param {number} [span] — pages shown either side of current
 * @returns {Array<number|'dots'>}
 */
export function buildPageList(current, pageCount, span = 1) {
  if (pageCount <= 1) return pageCount === 1 ? [1] : [];

  // Below this, the windowed form would be no shorter than simply listing them.
  if (pageCount <= 2 * span + 5) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  const wanted = new Set([1, pageCount]);
  for (let p = current - span; p <= current + span; p += 1) {
    if (p > 1 && p < pageCount) wanted.add(p);
  }

  const out = [];
  let prev = 0;
  for (const p of [...wanted].sort((a, b) => a - b)) {
    if (prev && p - prev > 1) out.push('dots');
    out.push(p);
    prev = p;
  }
  return out;
}

export default buildPageList;
