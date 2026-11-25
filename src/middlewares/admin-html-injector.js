'use strict';

const { randomBytes } = require('crypto');

/**
 * AdminHtmlInjector — project-root global middleware (Gap G11/G12, VAPT #19).
 *
 * Runs after next() and only processes /admin HTML responses.
 *
 * G11 / VAPT #19 — Password-input autocomplete:
 *   Strapi 5 admin is a React SPA. The HTML shell served at /admin contains
 *   only a bare <div id="strapi"> mount point — no <form> or <input> elements
 *   are present in the server-sent HTML. All forms (login, reset-password,
 *   change-password) are rendered client-side by React.
 *
 *   To attribute-stamp React-rendered password inputs we inject an inline
 *   <script> before </head> that installs a MutationObserver. The observer
 *   fires whenever React adds an input[type="password"] to the DOM and sets
 *   the correct autocomplete value based on the current URL:
 *     /auth/login              → autocomplete="current-password"
 *     /auth/reset-password
 *     /auth/forgot-password    → autocomplete="new-password"
 *     change-pw form (first field) → "current-password"
 *     everything else          → "new-password"
 *
 *   Note: autocomplete="off" is ignored by modern browsers on password fields
 *   (OWASP WSTG-CONF-06). The semantically correct values above are honoured
 *   by all major browsers.
 *
 * G11 secondary — form-level attribute (defence-in-depth):
 *   The regex injection below remains for any edge-case server-rendered HTML
 *   from third-party admin plugins. It is a no-op against the Strapi SPA shell
 *   but harmless and provides coverage if Strapi ever server-renders forms.
 *
 * G12 — reCAPTCHA v3:
 *   Injects reCAPTCHA <script> before </head> when recaptcha.enabled and
 *   siteKey are configured.
 */

/**
 * Pure helper: pick the correct autocomplete value for a password input.
 * Exported for unit testing (p35).
 *
 * @param {string}  pathname            — window.location.pathname at render time
 * @param {boolean} isFirstPwInForm     — true if this is the first password input in its form
 * @param {boolean} hasMultiplePwInForm — true if the form contains more than one password input
 * @returns {'current-password'|'new-password'}
 */
function _buildAutocompleteValue(pathname, isFirstPwInForm, hasMultiplePwInForm) {
  if (pathname.indexOf('/auth/login') !== -1) {
    return 'current-password';
  }
  if (
    pathname.indexOf('/auth/reset-password') !== -1 ||
    pathname.indexOf('/auth/forgot-password') !== -1
  ) {
    return 'new-password';
  }
  // Change-password forms have multiple password fields:
  // first = current password, rest = new password / confirm
  if (hasMultiplePwInForm && isFirstPwInForm) {
    return 'current-password';
  }
  return 'new-password';
}

/**
 * Inline <script> block injected into the admin HTML shell before </head>.
 * Installs a MutationObserver that stamps autocomplete on every password input
 * React adds to the DOM. Exported for unit testing (p35).
 */
const AUTOCOMPLETE_SCRIPT = `<script>
/* erp-session-manager: VAPT #19 — password input autocomplete (MutationObserver) */
(function(){
  'use strict';
  function buildValue(pathname, isFirst, hasMultiple){
    if(pathname.indexOf('/auth/login')!==-1) return 'current-password';
    if(pathname.indexOf('/auth/reset-password')!==-1||pathname.indexOf('/auth/forgot-password')!==-1) return 'new-password';
    if(hasMultiple&&isFirst) return 'current-password';
    return 'new-password';
  }
  function applyPwAutocomplete(input){
    if(!input||input.tagName!=='INPUT'||input.type!=='password') return;
    if(input.getAttribute('autocomplete')) return;
    var path=window.location.pathname;
    var form=input.closest?input.closest('form'):null;
    var pwFields=form?form.querySelectorAll('input[type="password"]'):null;
    var isFirst=!pwFields||pwFields.length===0||pwFields[0]===input;
    var hasMultiple=!!(pwFields&&pwFields.length>1);
    input.setAttribute('autocomplete',buildValue(path,isFirst,hasMultiple));
  }
  function scanNode(node){
    if(!node||node.nodeType!==1) return;
    if(node.tagName==='INPUT'){applyPwAutocomplete(node);return;}
    if(node.querySelectorAll){
      var inputs=node.querySelectorAll('input[type="password"]');
      for(var i=0;i<inputs.length;i++) applyPwAutocomplete(inputs[i]);
    }
  }
  var observer=new MutationObserver(function(mutations){
    for(var m=0;m<mutations.length;m++){
      var added=mutations[m].addedNodes;
      for(var n=0;n<added.length;n++) scanNode(added[n]);
    }
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  scanNode(document.documentElement);
})();
</script>`;

/**
 * Inline <script> block: injects SVG image CAPTCHA into admin panel auth forms.
 *
 * Runs on /admin/auth/* pages, fetches the challenge from the plugin endpoint
 * (GET /api/erp-session/captcha/challenge?context=admin), and monkey-patches
 * window.fetch to attach captchaToken + captchaAnswer to admin auth API calls.
 *
 * When CAPTCHA is disabled or enforceForAdminPanel=false the endpoint returns
 * { enabled: false } and the script silently does nothing.
 *
 * Exported for unit testing.
 */
const CAPTCHA_SCRIPT = `<script>
/* erp-session-manager: Admin Panel SVG CAPTCHA */
(function(){
  'use strict';
  var AUTH_PAGE_PATTERNS   = ['/auth/login','/auth/forgot-password','/auth/reset-password','/auth/register-admin'];
  var ADMIN_API_PATTERNS   = ['/admin/login','/admin/forgot-password','/admin/reset-password','/admin/register-admin'];
  var _token        = null;
  var _answer       = '';
  var _inited       = false;
  var _captchaImage = null;   // cache the last fetched PNG so late-arriving forms can inject
  var _submitBtn    = null;   // reference to the form's submit button for enable/disable control

  /** Enable or disable the submit button and apply matching visual cues. */
  function enableSubmit(enable){
    if(!_submitBtn) return;
    _submitBtn.disabled = !enable;
    _submitBtn.style.opacity    = enable ? '' : '0.5';
    _submitBtn.style.cursor     = enable ? '' : 'not-allowed';
    _submitBtn.title            = enable ? '' : 'Please complete the security verification above';
  }

  function onAuthPage(){
    var p = window.location.pathname;
    return AUTH_PAGE_PATTERNS.some(function(x){ return p.indexOf(x) !== -1; });
  }

  function fetchChallenge(cb){
    fetch('/api/erp-session-manager/captcha/challenge?context=admin')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(json){
        var d = json && (json.data || json);
        if(!d || !d.enabled){ _token = null; _captchaImage = null; return; }
        _token = d.challengeToken;
        // The response escaper now writes real JSON escapes, so JSON.parse
        // already hands back the data URI intact — no un-escaping needed.
        var img = typeof d.captchaImage === 'string' ? d.captchaImage : null;
        _captchaImage = img;
        if(cb && img) cb(img);
      })
      .catch(function(){});
  }

  // captchaImage is now a PNG data URI from the server (data:image/png;base64,...).
  // Plain <img src> — no SVG rendering, no CSS overrides, works in every browser.
  function updateCaptchaImg(wrap, pngSrc){
    var img = wrap && wrap.querySelector('#erp-captcha-img');
    if(img) img.src = pngSrc;
  }

  function injectUI(pngSrc){
    var forms = document.querySelectorAll('form');
    for(var i = 0; i < forms.length; i++){
      var form = forms[i];
      if(form.dataset.erpCaptcha) continue;
      form.dataset.erpCaptcha = '1';

      // Detect dark theme
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
                   (document.body && document.body.getAttribute('data-theme') === 'dark') ||
                   (window.matchMedia && window.matchMedia('(prefers-color-scheme:dark)').matches);

      var borderCol  = isDark ? '#4a4a6a' : '#dcdce4';
      var inputBg    = isDark ? '#1e1e3a' : '#ffffff';
      var inputColor = isDark ? '#f0f0ff' : '#32324d';
      var labelColor = isDark ? '#a5a5ba' : '#666687';

      var wrap = document.createElement('div');
      wrap.id = 'erp-captcha-wrap';
      wrap.style.cssText = 'margin:12px 0;width:100%;box-sizing:border-box;';

      // Build structure WITHOUT embedding the data URI in innerHTML —
      // long base64 strings in innerHTML are reliable but setting .src directly
      // after DOM insertion is cleaner and avoids any HTML-parsing edge cases.
      wrap.innerHTML =
        '<div style="margin-bottom:6px;">' +
          '<span style="display:block;font-size:11px;font-weight:600;margin-bottom:4px;' +
          'color:' + labelColor + ';letter-spacing:.5px;text-transform:uppercase;">Security Verification</span>' +
          '<img id="erp-captcha-img" alt="CAPTCHA" width="220" height="70" ' +
          'style="display:block;width:220px;height:70px;border-radius:4px;' +
          'border:1px solid ' + borderCol + ';" />' +
        '</div>' +
        '<div style="margin-bottom:6px;">' +
          '<input id="erp-captcha-input" type="text" placeholder="Type the characters shown above" autocomplete="off"' +
          ' style="width:100%;padding:10px 12px;font-size:14px;border:1px solid ' + borderCol + ';' +
          'border-radius:4px;box-sizing:border-box;background:' + inputBg + ';color:' + inputColor + ';outline:none;" />' +
        '</div>' +
        '<button type="button" id="erp-captcha-refresh"' +
        ' style="font-size:12px;background:none;border:none;color:#4945ff;cursor:pointer;padding:0;">↻ Refresh challenge</button>' +
        '<div id="erp-captcha-error"' +
        ' style="color:#d02b20;font-size:12px;margin-top:6px;padding:6px 8px;border-radius:4px;' +
        'background:rgba(208,43,32,.1);display:none;">✕ Incorrect — please try again.</div>';

      var btn = form.querySelector('button[type="submit"]') || form.querySelector('button');
      if(btn && btn.parentNode){ btn.parentNode.insertBefore(wrap, btn); }
      else{ form.appendChild(wrap); }

      // Capture submit button and disable it until the user enters a CAPTCHA answer.
      // Reuse the btn reference found before insertion — it is still the submit button.
      _submitBtn = btn;
      enableSubmit(false);

      // Set img.src AFTER inserting into DOM — avoids HTML-parser truncation of
      // long base64 data URIs and is guaranteed to trigger a load event.
      var imgEl = document.getElementById('erp-captcha-img');
      if(imgEl) imgEl.src = pngSrc;

      var input = document.getElementById('erp-captcha-input');
      if(input) input.addEventListener('input', function(e){
        _answer = e.target.value;
        // Enable submit only when the user has typed something in the CAPTCHA field.
        enableSubmit(_answer.trim().length > 0);
      });

      var refreshBtn = document.getElementById('erp-captcha-refresh');
      if(refreshBtn) refreshBtn.addEventListener('click', function(){
        fetchChallenge(function(png){
          updateCaptchaImg(wrap, png);
          var inp = document.getElementById('erp-captcha-input');
          if(inp){ inp.value = ''; _answer = ''; inp.focus(); }
          // Re-disable submit: new challenge requires a fresh answer
          enableSubmit(false);
          var errEl = document.getElementById('erp-captcha-error');
          if(errEl) errEl.style.display = 'none';
        });
      });
    }
  }

  /**
   * Swap in a brand-new challenge and reset the answer field.
   * Every submitted challenge is spent server-side (single-use), so this must
   * run after ANY failed auth attempt — not only CAPTCHA-specific rejections.
   * Reusing a spent token would fail verification and look like a wrong answer.
   */
  function refreshChallenge(showError){
    var errEl = document.getElementById('erp-captcha-error');
    if(errEl) errEl.style.display = showError ? 'block' : 'none';
    // Disable submit — the previous answer is stale either way
    enableSubmit(false);
    fetchChallenge(function(png){
      var wrap = document.getElementById('erp-captcha-wrap');
      updateCaptchaImg(wrap, png);
      var inp = document.getElementById('erp-captcha-input');
      if(inp){ inp.value = ''; _answer = ''; inp.focus(); }
    });
  }

  function showCaptchaError(){ refreshChallenge(true); }

  // Monkey-patch window.fetch to inject captcha fields on admin auth requests
  var _origFetch = window.fetch;
  window.fetch = function(url, opts){
    var urlStr = String(url || '');
    var isAdminAuth = ADMIN_API_PATTERNS.some(function(p){ return urlStr.indexOf(p) !== -1; });
    if(isAdminAuth && _token){
      opts = opts || {};
      try{
        var body = opts.body ? JSON.parse(opts.body) : {};
        body.captchaToken  = _token;
        body.captchaAnswer = _answer;
        opts = Object.assign({}, opts, { body: JSON.stringify(body) });
      } catch(e){ /* parse error — send request as-is */ }
    }
    var promise = _origFetch.apply(this, [url, opts]);
    if(isAdminAuth && _token){
      promise = promise.then(function(resp){
        // Success — the panel navigates away; nothing left to refresh.
        if(resp.status >= 200 && resp.status < 300) return resp;

        if(resp.status === 400){
          // Clone before reading so the original stream is still consumable
          return resp.clone().json().then(function(data){
            var msg = (data && data.error && data.error.message) || '';
            if(msg.toLowerCase().indexOf('captcha') !== -1){
              showCaptchaError();
              // Return a synthetic "still-processing" response so React does not
              // show a misleading "Invalid credentials" banner for a CAPTCHA failure.
              // A 200 with {data:null} is the quietest response React will accept
              // without redirecting or clearing the form fields.
              return new Response(JSON.stringify({ data: null, error: null }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            // Rejected for some other reason (bad password, rate limit…). The
            // challenge was still spent, so issue a fresh one silently — the
            // panel shows its own error banner for the real failure.
            refreshChallenge(false);
            return resp;
          }).catch(function(){ refreshChallenge(false); return resp; });
        }

        refreshChallenge(false);
        return resp;
      });
    }
    return promise;
  };

  function tryInit(){
    if(!onAuthPage()) return;
    if(_inited) return;
    _inited = true;
    fetchChallenge(function(svg){ injectUI(svg); });
  }

  // MutationObserver: detect React rendering the form
  var _observer = new MutationObserver(function(){
    if(!onAuthPage()){ _inited = false; _captchaImage = null; _token = null; _submitBtn = null; return; }
    // Case 1: fetch not started yet and form now visible — start full init
    if(!_inited && document.querySelector('form')){ tryInit(); return; }
    // Case 2 (race condition fix): fetch already completed and SVG is cached,
    // but the form arrived in the DOM AFTER fetchChallenge resolved, so injectUI
    // found no <form> elements and did nothing. Inject now without re-fetching.
    if(_captchaImage && !document.getElementById('erp-captcha-wrap') && document.querySelector('form')){
      injectUI(_captchaImage);
    }
  });
  _observer.observe(document.documentElement, {childList:true, subtree:true});

  // SPA navigation: React Router calls history.pushState on soft-navigate
  // Reset all state so a fresh challenge is fetched on the next auth page visit
  window.addEventListener('popstate', function(){ _inited = false; _captchaImage = null; _token = null; _submitBtn = null; setTimeout(tryInit, 50); });
  var _origPushState = history.pushState;
  history.pushState = function(){
    _origPushState.apply(this, arguments);
    _inited = false; _captchaImage = null; _token = null; _submitBtn = null;
    setTimeout(tryInit, 50);
  };

  tryInit();
})();
</script>`;

// ─── Nonce helpers ───────────────────────────────────────────────────────────

/**
 * Add a CSP nonce to every `script-src` (and `script-src-elem`) directive in
 * the Content-Security-Policy header so that our injected inline scripts are
 * allowed.  Without this Strapi's default CSP ("script-src 'self' 'unsafe-eval'")
 * blocks all inline <script> blocks.
 *
 * Exported for unit testing.
 */
function _addNonceToCsp(cspHeader, nonce) {
  if (!cspHeader || !nonce) return cspHeader;
  const nonceToken = `'nonce-${nonce}'`;

  // Handle script-src-elem (more specific; falls back to script-src when absent)
  let result = cspHeader.includes('script-src-elem')
    ? cspHeader.replace(/(script-src-elem\s[^;]*)/i, `$1 ${nonceToken}`)
    : cspHeader;

  // Handle script-src (but NOT script-src-elem or script-src-attr — use word boundary)
  result = result.replace(/(script-src(?!-)[^;]*)/i, `$1 ${nonceToken}`);

  return result;
}

/**
 * Stamp a nonce attribute onto a raw <script> tag string.
 * e.g. "<script>\n/* … *\/" → "<script nonce=\"abc123\">\n/* … *\/"
 */
function _withNonce(scriptBlock, nonce) {
  return scriptBlock.replace(/^<script(\s|>)/i, `<script nonce="${nonce}"$1`);
}

// ─── Middleware factory ───────────────────────────────────────────────────────

const factory = (config, { strapi }) => {
  return async (ctx, next) => {
    // Generate a fresh random nonce for each request.
    // Must be generated before next() so the same value is used for both
    // the CSP header update and the injected script tags.
    const nonce = randomBytes(16).toString('base64');

    await next();

    // Only process /admin HTML pages
    if (!ctx.path.startsWith('/admin')) return;
    const contentType = ctx.response.get('Content-Type') || '';
    if (!contentType.includes('text/html')) return;

    let body = typeof ctx.body === 'string' ? ctx.body : null;
    if (!body) return;

    // ── Step 1: Update CSP header to allow our nonce ────────────────────────
    // Strapi's security middleware sets CSP before we run. We must add the
    // nonce BEFORE injecting scripts so the browser accepts them.
    try {
      const csp = ctx.response.get('Content-Security-Policy');
      if (csp) {
        ctx.set('Content-Security-Policy', _addNonceToCsp(csp, nonce));
      }
    } catch { /* non-fatal — script injection proceeds; browser will block if CSP unchanged */ }

    // ── Step 1b: Stamp nonce on Vite's React Refresh preamble ──────────────
    // @vitejs/plugin-react-swc injects an inline <script type="module"> via
    // transformIndexHtml that imports /@react-refresh and calls
    // injectIntoGlobalHook. Our strict CSP (nonce-only script-src) blocks it
    // because the tag has no nonce, preventing React Refresh from initialising
    // in dev/develop mode and causing "preamble not loaded" / "loaded twice"
    // console errors. Adding the request nonce here lets the preamble through.
    if (body.includes('/@react-refresh')) {
      body = body.replace(
        /(<script(\s[^>]*)?>)([\s\S]*?\/@react-refresh[\s\S]*?)(<\/script>)/gi,
        function(match, openTag, attrs, content, closeTag) {
          if (openTag.includes('nonce=')) return match; // already nonced
          return '<script nonce="' + nonce + '"' + (attrs || '') + '>' + content + closeTag;
        }
      );
    }

    // ── Step 2: Inject scripts with nonce ───────────────────────────────────

    // G11 secondary: form-level autocomplete="off" (defence-in-depth for
    // any server-rendered forms from third-party admin plugins)
    body = body.replace(/<form(\s)/gi, '<form autocomplete="off"$1');
    body = body.replace(/<form>/gi, '<form autocomplete="off">');

    // G11 / VAPT #19: inject MutationObserver script for React-rendered password inputs
    // Guard prevents double-injection if the middleware somehow runs twice (idempotent).
    if (body.includes('</head>') && !body.includes('erp-session-manager: VAPT #19')) {
      body = body.replace('</head>', `${_withNonce(AUTOCOMPLETE_SCRIPT, nonce)}\n</head>`);
    }

    // G12: Inject reCAPTCHA v3 script if configured
    try {
      const pluginConfig = strapi.config.get('plugin::erp-session-manager') || {};
      const recaptcha    = pluginConfig.recaptcha || {};
      if (recaptcha.enabled && recaptcha.siteKey) {
        // External <script src="…"> — nonce added for script-src-elem compliance
        const script = `<script src="https://www.google.com/recaptcha/api.js?render=${recaptcha.siteKey}" async defer nonce="${nonce}"></script>`;
        body = body.replace('</head>', `${script}\n</head>`);
      }
    } catch { /* non-fatal */ }

    // VAPT #20: Inject admin-panel SVG image CAPTCHA script
    // The script itself checks enforceForAdminPanel via the challenge endpoint and
    // silently does nothing when CAPTCHA is disabled — no runtime config check needed here.
    if (body.includes('</head>') && !body.includes('erp-session-manager: Admin Panel SVG CAPTCHA')) {
      body = body.replace('</head>', `${_withNonce(CAPTCHA_SCRIPT, nonce)}\n</head>`);
    }

    ctx.body = body;
  };
};

module.exports = factory;
module.exports.AUTOCOMPLETE_SCRIPT     = AUTOCOMPLETE_SCRIPT;
module.exports.CAPTCHA_SCRIPT          = CAPTCHA_SCRIPT;
module.exports._buildAutocompleteValue = _buildAutocompleteValue;
module.exports._addNonceToCsp          = _addNonceToCsp;
module.exports._withNonce              = _withNonce;
