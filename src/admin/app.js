/**
 * Strapi Admin Panel Customization
 *
 * Installs a fetch interceptor that handles two 403 gate types:
 *
 * ── Gate A: Post-login TOTP (totpPending) ────────────────────────────────────
 *   VERIFY flow (totpSetupRequired: false — already provisioned):
 *     1. Admin logs in with username + password.
 *     2. Plugin returns 403 { totpPending: true, totpSetupRequired: false }.
 *     3. Interceptor shows code-entry overlay.
 *     4. Admin enters 6-digit code → POST /step-up/admin-login-totp → gate cleared.
 *     5. Blocked requests retried automatically.
 *
 *   SETUP flow (totpSetupRequired: true — never set up):
 *     1. Admin logs in with username + password.
 *     2. Plugin returns 403 { totpPending: true, totpSetupRequired: true, setup: {...} }.
 *     3. Interceptor shows QR code + manual-entry secret overlay.
 *     4. Admin scans QR with authenticator app.
 *     5. Admin enters first 6-digit code → POST /step-up/setup/verify → gate cleared.
 *     6. Blocked requests retried automatically.
 *
 * ── Gate B: Step-up TOTP (stepUpRequired) ────────────────────────────────────
 *   Triggered when accessing a sensitive operation (change password, user/role
 *   management) that requires a fresh TOTP token.
 *     1. Request hits protected route → 403 { stepUpRequired: true, routeGroup }.
 *     2. Interceptor shows step-up TOTP challenge overlay.
 *     3. Admin enters 6-digit code → POST /step-up/challenge → step-up token issued.
 *     4. Original request retried with X-Step-Up-Token header added.
 *     5. Concurrent requests share the same challenge promise (one overlay shown).
 */

// ---------------------------------------------------------------------------
// React Fast Refresh preamble (dev-mode only)
// ---------------------------------------------------------------------------
// Strapi 5 serves .strapi/client/index.html as a static file — Vite's
// transformIndexHtml hook never runs on it, so the preamble <script> that
// @vitejs/plugin-react-swc normally injects into HTML is absent.
//
// Each SWC-transformed JSX file checks window.$RefreshReg$ at evaluation
// time; without the preamble this throws "React refresh preamble was not
// loaded. Something is wrong."
//
// Fix: dynamically import /@react-refresh so refresh-runtime.js initialises
// first (its module-level "loaded twice" guard sees window.$RefreshReg$ as
// undefined and passes), then set the preamble globals in .then(). Plugin
// JSX components are lazy-loaded on navigation (user interaction required),
// so this dynamic import always resolves well before they are needed.
//
// In production, import.meta.env.DEV === false and Vite's build eliminates
// this block entirely — no runtime cost or broken-import risk.
/* eslint-disable no-underscore-dangle */
if (import.meta.env.DEV) {
  // Strapi 5 does not always run Vite's transformIndexHtml on the admin HTML,
  // so the preamble <script> that @vitejs/plugin-react-swc normally injects
  // (setting window.$RefreshReg$ / window.$RefreshSig$) may fire AFTER some
  // plugin JSX modules have already been evaluated. Those modules check the
  // globals at line 3 and throw "React refresh preamble was not loaded."
  //
  // Fix: stub the globals synchronously here so the check always passes,
  // regardless of preamble timing.
  //
  // We intentionally do NOT call RefreshRuntime.injectIntoGlobalHook() —
  // Vite's own preamble already does that when it loads. Calling it a second
  // time throws "React refresh runtime was loaded twice."
  if (typeof window !== 'undefined' && !window.$RefreshReg$) {
    window.$RefreshReg$ = function() {};
    window.$RefreshSig$ = function() { return function(type) { return type; }; };
    // Some versions of @vitejs/plugin-react-swc check this flag (not $RefreshReg$)
    window.__vite_plugin_react_preamble_installed__ = true;
  }
}
/* eslint-enable no-underscore-dangle */

// ---------------------------------------------------------------------------
// Harden cookies written by the admin bundle
// ---------------------------------------------------------------------------

/**
 * Strapi stores the admin ACCESS token in a `jwtToken` cookie whenever
 * "Remember me" is off, and rewrites it on every silent token refresh
 * (reducer.js login / getFetchClient.js storeToken). Both go through
 * utils/cookies.js, which writes:
 *
 *     document.cookie = name + "=" + encodeURIComponent(value) + "; Path=/";
 *
 * No Secure, no SameSite. The cookie therefore rode along on plaintext
 * requests to this host, which is the same exposure the strapi_admin_refresh
 * finding was about.
 *
 * It cannot be fixed on the server: this cookie is written by JavaScript in
 * the browser and never travels as a Set-Cookie response header, so no
 * middleware ever sees it. Intercepting the document.cookie setter is the only
 * place left to add the attributes.
 *
 * HttpOnly is NOT achievable here, by construction — a cookie written through
 * document.cookie is readable by script by definition. Anything that could set
 * HttpOnly would also stop the admin bundle reading the token back to build its
 * Authorization header. The mitigations that do apply are the CSP already
 * enforced on this origin and the short access-token lifespan.
 */
function hardenCookieString(raw) {
  const value = String(raw);
  const lower = value.toLowerCase();
  let out = value;

  // SameSite=Strict matches the refresh cookie. Never override an explicit one.
  if (!lower.includes('samesite=')) out += '; SameSite=Strict';

  // Secure only over https. Adding it on a plain-http origin makes the browser
  // drop the cookie outright, which would silently break local development.
  if (!lower.includes('secure') && globalThis.location?.protocol === 'https:') {
    out += '; Secure';
  }

  return out;
}

(function installCookieHardener() {
  try {
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (!desc?.get || !desc?.set) return;

    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get() { return desc.get.call(document); },
      set(value) { desc.set.call(document, hardenCookieString(value)); },
    });
  } catch {
    // A browser that will not let us redefine it just keeps Strapi's defaults.
  }
})();

// ---------------------------------------------------------------------------
// Fetch interceptor
// ---------------------------------------------------------------------------

const _nativeFetch = window.fetch.bind(window);

// Shared promises — concurrent blocked requests wait for the same modal
let _totpPromise   = null;  // Gate A: post-login TOTP
let _stepUpPromise = null;  // Gate B: step-up TOTP

async function handle403Response(response, input, init) {
  const details = await get403Details(response);

  // ── Gate A: post-login TOTP gate ─────────────────────────────────────
  if (details.totpPending) {
    if (!_totpPromise) {
      const token = getAuthToken(init);
      _totpPromise = details.totpSetupRequired
        ? showTotpSetupOverlay(token, details.setup)
        : showTotpVerifyOverlay(token);
      _totpPromise = _totpPromise.finally(() => { _totpPromise = null; });
    }
    await _totpPromise;
    return nonceBoundFetch(input, init);
  }

  // ── Gate B: step-up TOTP challenge ───────────────────────────────────
  if (details.stepUpRequired) {
    if (!_stepUpPromise) {
      const token = getAuthToken(init);
      _stepUpPromise = showStepUpChallengeOverlay(token, details.routeGroup);
      _stepUpPromise = _stepUpPromise.finally(() => { _stepUpPromise = null; });
    }
    const stepUpToken = await _stepUpPromise;
    // Cancelled — give the admin UI the original 403 to report.
    if (!stepUpToken) return response;
    return _nativeFetch(input, addStepUpTokenToInit(init, stepUpToken));
  }

  return response;
}

window.fetch = async function erpTotpFetch(input, init) {
  const url = resolveUrl(input);

  // Never intercept auth/step-up calls themselves (prevents infinite loop)
  if (
    url.includes('/step-up/admin-login-totp') ||
    url.includes('/step-up/setup/verify')     ||
    url.includes('/step-up/challenge')
  ) {
    return _nativeFetch(input, init);
  }

  const response = await nonceBoundFetch(input, init);

  // The server ends the session when the post-login TOTP window closes without
  // a code. Without this the panel would sit on a dead token showing errors.
  if (response.status === 401) {
    return handleTotpExpired(response);
  }

  if (response.status === 403) {
    // The step-up retry happens inside, so its success must be checked too —
    // a password change is normally answered 403 first and only succeeds on
    // the retry that carries the X-Step-Up-Token.
    return afterOwnPasswordChange(await handle403Response(response, input, init), url, init);
  }

  return afterOwnPasswordChange(response, url, init);
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof Request) return input.url;
  return String(input);
}

// ---------------------------------------------------------------------------
// Sign-out after the admin changes their own password
// ---------------------------------------------------------------------------

/**
 * Changing your own password on /admin/users/me wipes every session for the
 * account server-side: Strapi's updateMe calls
 * sessionManager('admin').invalidateRefreshToken(userId), which deletes ALL
 * strapi_sessions rows for that user (deviceId is omitted from the criteria, so
 * it is not narrowed to one device), and the ERP hook additionally revokes its
 * own session records. From the next request on, the admin auth strategy's
 * isSessionActive(sessionId) lookup fails and everything answers 401.
 *
 * The panel did not act on that: it showed a success toast and left the user on
 * the page holding a token that no longer authenticates, so the first thing
 * they clicked failed for no visible reason. This signs the tab out to match
 * what the server already did.
 *
 * @param {string} url
 * @param {object} init
 * @returns {boolean}
 */
function isOwnPasswordChange(url, init) {
  const method = ((init && init.method) || 'GET').toUpperCase();
  if (method !== 'PUT') return false;

  let path;
  try {
    path = new URL(url, globalThis.location.origin).pathname;
  } catch {
    return false;
  }
  if (path !== '/admin/users/me') return false;

  // The profile form posts JSON; anything else is not it.
  const body = init && init.body;
  if (typeof body !== 'string') return false;
  try {
    const parsed = JSON.parse(body);
    return Boolean(parsed && (parsed.password || parsed.currentPassword));
  } catch {
    return false;
  }
}

/**
 * Drop the client-side session and go to the login page.
 *
 * Keys mirror Strapi's own STORAGE_KEYS (admin/src/reducer.js): the token lives
 * in localStorage OR a `jwtToken` cookie, and `isLoggedIn` is the status flag.
 * Clearing `isLoggedIn` also signs out every OTHER open tab — Auth.js watches
 * for that key going null on the `storage` event, which only fires in the tabs
 * that did not make the change.
 */
function clearClientSessionAndRedirect() {
  try {
    for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
      store.removeItem('jwtToken');
      store.removeItem('isLoggedIn');
    }
    document.cookie = 'jwtToken=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
  } catch {
    // Storage can throw when blocked — the redirect still has to happen.
  }
  globalThis.location.href = '/admin/auth/login';
}

function showPasswordChangedNotice() {
  const overlay = createOverlay('erp-password-changed');
  if (!overlay) return;                       // already showing
  const release = guardOverlayAgainstModalTraps(overlay);

  const card = document.createElement('div');
  card.setAttribute('style', CARD_STYLE);

  const shieldWrap = document.createElement('div');
  shieldWrap.style.marginBottom = '16px';
  shieldWrap.innerHTML = SHIELD_SVG;

  const title = document.createElement('h2');
  title.setAttribute('style', 'margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #32324d;');
  title.textContent = 'Password changed';

  const subtitle = document.createElement('p');
  subtitle.setAttribute('style', 'margin: 0 0 24px; font-size: 14px; color: #666687; line-height: 1.5;');
  subtitle.textContent =
    'For your security, every session for this account has been signed out. Please sign in again with your new password.';

  const btn = document.createElement('button');
  btn.setAttribute('style', 'display: block; width: 100%; padding: 12px; background: #4945ff; color: #fff; border: none; border-radius: 6px; font-size: 15px; font-weight: 600; cursor: pointer;');
  btn.textContent = 'Go to sign in';

  card.appendChild(shieldWrap);
  card.appendChild(title);
  card.appendChild(subtitle);
  card.appendChild(btn);
  overlay.appendChild(card);

  const go = () => { release(); clearClientSessionAndRedirect(); };
  btn.addEventListener('click', go);
  btn.focus();

  // Redirect on its own so an unattended tab does not sit on a dead session.
  setTimeout(go, 4000);
}

/**
 * Send the tab back to sign-in when the server reports the post-login TOTP
 * window expired. Any other 401 is returned untouched so Strapi's own token
 * refresh still gets its chance.
 *
 * @param {Response} response
 * @returns {Promise<Response>}
 */
async function handleTotpExpired(response) {
  let expired = false;
  try {
    const body = await response.clone().json();
    expired = body?.error?.details?.totpExpired === true;
  } catch { /* not JSON — not our gate */ }

  if (expired) clearClientSessionAndRedirect();
  return response;
}

/**
 * Pass-through that signs the tab out when the response is a successful
 * own-password change. Returns the response untouched in every other case.
 */
function afterOwnPasswordChange(response, url, init) {
  if (response?.ok && isOwnPasswordChange(url, init)) {
    showPasswordChangedNotice();
  }
  return response;
}

// ---------------------------------------------------------------------------
// VAPT #6 — Login nonce binding
// ---------------------------------------------------------------------------

/**
 * nonceBoundFetch(input, init)
 *
 * Wraps _nativeFetch for login endpoints to defend against Login Bypass via
 * Response Manipulation (VAPT #6).
 *
 * For login URLs:
 *   1. Generates a fresh UUID nonce with crypto.randomUUID().
 *   2. Adds it as the X-Login-Nonce request header (does not mutate `init`).
 *   3. Calls _nativeFetch with the augmented headers.
 *   4. On response.ok (2xx): verifies the server echoed back the same nonce.
 *      Mismatch → returns a synthetic 401 so the caller rejects the response.
 *   5. On non-2xx: returns the response unchanged (no nonce check needed).
 *
 * For non-login URLs: calls _nativeFetch unchanged — no overhead.
 *
 * Why a synthetic 401 instead of throwing?
 *   The interceptor and Strapi's admin UI code both handle rejection via
 *   response status, not thrown exceptions. A synthetic 401 causes the admin
 *   UI to display a login-failed state rather than an unhandled error.
 */
function nonceBoundFetch(input, init) {
  const url = resolveUrl(input);
  const isLoginUrl =
    url.includes('/admin/auth/local') ||
    url.includes('/api/auth/local');

  if (!isLoginUrl) {
    return _nativeFetch(input, init);
  }

  // Generate a per-request UUID nonce (crypto.randomUUID available in all
  // modern browsers; the fallback covers very old environments gracefully).
  const getRandomNonce = () => {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      const arr = new Uint8Array(16);
      globalThis.crypto.getRandomValues(arr);
      return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    return `nonce-${Date.now()}`;
  };
  const nonce = getRandomNonce();

  // Attach the nonce header without mutating the caller's init object
  const headers = new Headers((init && init.headers) || {});
  headers.set('X-Login-Nonce', nonce);
  const boundInit = { ...(init || {}), headers };

  return _nativeFetch(input, boundInit).then((response) => {
    // Validate echoed nonce only on 2xx — error responses intentionally carry
    // no nonce so an attacker cannot extract a live nonce from a 401/403.
    if (response.ok) {
      const echoed = response.headers.get('X-Login-Nonce');
      if (echoed !== nonce) {
        // The response does not correspond to this request — could be a
        // captured/replayed success response injected by an attacker.
        // Warn in console (visible in DevTools) and return a synthetic 401
        // that causes the admin UI to reject the login attempt.
        // eslint-disable-next-line no-console
        console.warn('[erp-security] Login nonce mismatch — possible response manipulation attack blocked.');
        return new Response(
          JSON.stringify({
            data:  null,
            error: { status: 401, name: 'UnauthorizedError', message: 'Login response verification failed.' },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
    return response;
  });
}

/**
 * Clone and parse a 403 response to extract all gate details.
 * Returns a descriptor covering both Gate A (totpPending) and Gate B (stepUpRequired).
 */
async function get403Details(response) {
  try {
    const body = await response.clone().json();
    const details = body?.error?.details || {};
    return {
      // Gate A — post-login TOTP
      totpPending:       details.totpPending       === true,
      totpSetupRequired: details.totpSetupRequired === true,
      setup:             details.setup             || null,
      // Gate B — step-up TOTP
      stepUpRequired:    details.stepUpRequired    === true,
      routeGroup:        details.routeGroup        || null,
    };
  } catch {
    return {
      totpPending: false, totpSetupRequired: false, setup: null,
      stepUpRequired: false, routeGroup: null,
    };
  }
}

/**
 * Return a new `init` object with the X-Step-Up-Token header added.
 * Does not mutate the original init.
 */
function addStepUpTokenToInit(init, stepUpToken) {
  if (!stepUpToken) return init;
  const headers = new Headers((init && init.headers) || {});
  headers.set('X-Step-Up-Token', stepUpToken);
  return { ...(init || {}), headers };
}

function getAuthToken(init) {
  try {
    if (init?.headers) {
      const headers = init.headers instanceof Headers
        ? init.headers
        : new Headers(init.headers);
      const auth = headers.get('Authorization') || headers.get('authorization');
      if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
    }
  } catch { /* ignore */ }
  return localStorage.getItem('jwtToken') || '';
}

// ---------------------------------------------------------------------------
// Shared overlay utilities
// ---------------------------------------------------------------------------

const OVERLAY_STYLES = {
  position:       'fixed',
  inset:          '0',
  zIndex:         '99999',
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  background:     'rgba(50, 50, 77, 0.72)',
  backdropFilter: 'blur(4px)',
};

const CARD_STYLE = `
  background: #ffffff;
  border-radius: 8px;
  padding: 40px 48px;
  width: 460px;
  max-width: 94vw;
  box-shadow: 0 8px 32px rgba(50,50,77,0.24);
  text-align: center;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
`;

const SHIELD_SVG = `
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2L4 6v6c0 5.25 3.5 10.15 8 11.35C16.5 22.15 20 17.25 20 12V6l-8-4z"
          fill="#4945ff" opacity="0.15"/>
    <path d="M12 2L4 6v6c0 5.25 3.5 10.15 8 11.35C16.5 22.15 20 17.25 20 12V6l-8-4z"
          stroke="#4945ff" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M9 12l2 2 4-4" stroke="#4945ff" stroke-width="1.5"
          stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

/**
 * Make an overlay usable on top of an open Strapi modal.
 *
 * Strapi's Modal is @radix-ui/react-dialog, which guards the page in two ways
 * while it is open. Both fight a plain overlay appended to <body>:
 *
 *   1. DismissableLayer sets `pointer-events: none` on <body> and re-enables it
 *      only inside the dialog layer. Our overlay inherits `none`, so every
 *      click on Verify / Cancel is swallowed — the modal looks frozen.
 *   2. FocusScope traps focus: a document-level `focusin` handler pulls focus
 *      back into the dialog the moment it lands anywhere else. Our input loses
 *      focus immediately and the digits get typed into whatever field the
 *      create-user modal had focused.
 *
 * Reported as: "unable cancel TOTP modal, it captures background modal input
 * when click, even unable submit and verify".
 *
 * Mounting inside the dialog is NOT an option — Radix positions its content
 * with a `transform`, which makes it the containing block for fixed-position
 * descendants, so the overlay would be laid out against the dialog box instead
 * of the viewport. Instead the overlay stays on <body> and opts itself back in:
 *
 *   • `pointer-events: auto` on the overlay overrides the inherited `none`
 *   • a capture-phase `focusin` guard stops the event before Radix's
 *     bubble-phase handler on document ever sees it, but ONLY when focus landed
 *     inside our overlay — the dialog keeps its trap for everything else
 *   • `pointerdown` is stopped at the overlay so the click does not read as an
 *     outside-press that dismisses the modal underneath
 *
 * Returns a `release()` that removes the overlay and detaches the guard. Every
 * exit path must call it, or focus stays hijacked after the overlay is gone.
 */
function guardOverlayAgainstModalTraps(overlay) {
  // FocusScope refocuses from BOTH ends: `focusin` when focus arrives outside
  // the dialog, and `focusout` when it leaves towards something outside. Guard
  // each with the element that is gaining focus — `target` on the way in,
  // `relatedTarget` on the way out.
  const onFocusIn  = (event) => {
    if (overlay.contains(event.target)) event.stopImmediatePropagation();
  };
  const onFocusOut = (event) => {
    if (event.relatedTarget && overlay.contains(event.relatedTarget)) {
      event.stopImmediatePropagation();
    }
  };

  const onPointerDown = (event) => event.stopPropagation();

  // Capture phase on document runs before Radix's bubble-phase listeners there,
  // and stopImmediatePropagation halts the event outright — so they never fire.
  document.addEventListener('focusin',  onFocusIn,  true);
  document.addEventListener('focusout', onFocusOut, true);
  overlay.addEventListener('pointerdown', onPointerDown);

  return function release() {
    document.removeEventListener('focusin',  onFocusIn,  true);
    document.removeEventListener('focusout', onFocusOut, true);
    overlay.removeEventListener('pointerdown', onPointerDown);
    overlay.remove();
  };
}

function createOverlay(id) {
  if (document.getElementById(id)) return null;
  const overlay = document.createElement('div');
  overlay.id = id;
  Object.assign(overlay.style, OVERLAY_STYLES);
  // Overrides the `pointer-events: none` Radix puts on <body> for modals.
  overlay.style.pointerEvents = 'auto';
  document.body.appendChild(overlay);
  return overlay;
}

function addLogoutButton(overlay, token) {
  const btn = overlay.querySelector('#erp-totp-logout');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      await _nativeFetch('/admin/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* ignore */ }
    overlay.remove();
    window.location.href = '/admin/auth/login';
  });
}

// ---------------------------------------------------------------------------
// Flow 1 — VERIFY overlay (TOTP already provisioned)
// ---------------------------------------------------------------------------

function showTotpVerifyOverlay(token) {
  return new Promise((resolve) => {
    const overlay = createOverlay('erp-totp-overlay');
    if (!overlay) return;

    // Build overlay DOM without innerHTML — defence-in-depth against injection.
    // All values here are static module constants (CARD_STYLE, SHIELD_SVG, literal text).
    const card = document.createElement('div');
    card.setAttribute('style', CARD_STYLE);

    // SHIELD_SVG is a static compile-time constant — safe to use as innerHTML
    // on a freshly created, never-attached wrapper div.
    const shieldWrap = document.createElement('div');
    shieldWrap.style.marginBottom = '16px';
    shieldWrap.innerHTML = SHIELD_SVG;

    const title = document.createElement('h2');
    title.setAttribute('style', 'margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #32324d;');
    title.textContent = 'Two-Factor Authentication';

    const subtitle = document.createElement('p');
    subtitle.setAttribute('style', 'margin: 0 0 28px; font-size: 14px; color: #666687; line-height: 1.5;');
    subtitle.textContent = 'Open your authenticator app and enter the 6-digit code for this account.';

    const input = document.createElement('input');
    input.id = 'erp-totp-input';
    input.type = 'text';
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('autocomplete', 'one-time-code');
    input.maxLength = 6;
    input.placeholder = '000 000';
    input.setAttribute('style', 'width: 160px; padding: 12px 0; font-size: 28px; font-weight: 600; text-align: center; letter-spacing: 10px; border: 2px solid #dcdce4; border-radius: 8px; color: #32324d; outline: none; transition: border-color 0.15s;');

    const errorEl = document.createElement('p');
    errorEl.id = 'erp-totp-error';
    errorEl.setAttribute('style', 'display:none; margin: 12px 0 0; font-size: 13px; color: #d02b20;');

    const attemptsEl = document.createElement('p');
    attemptsEl.id = 'erp-totp-attempts';
    attemptsEl.setAttribute('style', 'display:none; margin: 4px 0 0; font-size: 12px; color: #8e8ea9;');

    const submitBtn = document.createElement('button');
    submitBtn.id = 'erp-totp-submit';
    submitBtn.setAttribute('style', 'display: block; width: 100%; margin-top: 24px; padding: 12px; background: #4945ff; color: #fff; border: none; border-radius: 6px; font-size: 15px; font-weight: 600; cursor: pointer; transition: opacity 0.15s;');
    submitBtn.textContent = 'Verify and continue';

    const logoutBtn = document.createElement('button');
    logoutBtn.id = 'erp-totp-logout';
    logoutBtn.setAttribute('style', 'display: block; width: 100%; margin-top: 10px; padding: 10px; background: transparent; color: #8e8ea9; border: 1px solid #dcdce4; border-radius: 6px; font-size: 13px; cursor: pointer;');
    logoutBtn.textContent = 'Cancel and log out';

    card.appendChild(shieldWrap);
    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(input);
    card.appendChild(errorEl);
    card.appendChild(attemptsEl);
    card.appendChild(submitBtn);
    card.appendChild(logoutBtn);
    overlay.appendChild(card);

    input.focus();
    input.addEventListener('focus', () => { input.style.borderColor = '#4945ff'; });
    input.addEventListener('blur',  () => { input.style.borderColor = '#dcdce4'; });
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
      errorEl.style.display = 'none';
    });

    async function handleVerify() {
      const code = input.value.trim();
      if (code.length !== 6) {
        showError(errorEl, input, 'Please enter all 6 digits of your authenticator code.');
        input.focus();
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Verifying…';
      submitBtn.style.opacity = '0.7';
      errorEl.style.display = 'none';

      try {
        const resp = await _nativeFetch('/erp-session-manager/step-up/admin-login-totp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ totpCode: code }),
        });

        if (resp.ok) { overlay.remove(); resolve(); return; }

        const data = await resp.json().catch(() => ({}));
        const msg  = data?.error?.message || 'Invalid code. Please try again.';
        const rem  = data?.error?.details?.remainingAttempts;

        showError(errorEl, input, msg);
        if (typeof rem === 'number') {
          attemptsEl.textContent = `${rem} attempt${rem !== 1 ? 's' : ''} remaining`;
          attemptsEl.style.display = 'block';
        }
        if (resp.status === 429) {
          submitBtn.textContent = 'Too many attempts';
        } else {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Verify and continue';
          submitBtn.style.opacity = '1';
          input.value = '';
          input.focus();
        }
      } catch {
        showError(errorEl, input, 'Network error. Please check your connection and try again.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Verify and continue';
        submitBtn.style.opacity = '1';
      }
    }

    submitBtn.addEventListener('click', handleVerify);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleVerify(); });
    addLogoutButton(overlay, token);
  });
}

// ---------------------------------------------------------------------------
// Flow 2 — SETUP overlay (TOTP not yet provisioned)
// ---------------------------------------------------------------------------

/**
 * sanitizeDataUri(uri)
 *
 * Validates that a server-supplied URI is a safe image data URI before
 * it is assigned to img.src. Accepts only strings that start with
 * "data:image/" — rejects javascript:, data:text/html, and anything else.
 *
 * @param {unknown} uri
 * @returns {string|null}
 */
function sanitizeDataUri(uri) {
  if (typeof uri === 'string' && uri.startsWith('data:image/')) return uri;
  return null;
}

/**
 * Shows a two-step setup overlay:
 *   Step 1 — display the QR code (and manual secret) so the user can scan.
 *   Step 2 — ask for first TOTP code to confirm setup and clear the login gate.
 *
 * @param {string} token    — admin JWT
 * @param {{ qrCodeDataUri: string|null, base32Secret: string, provisioningUri: string }|null} setup
 */
function showTotpSetupOverlay(token, setup) {
  return new Promise((resolve) => {
    const overlay = createOverlay('erp-totp-setup-overlay');
    if (!overlay) return;

    // Build overlay DOM without innerHTML — setup.qrCodeDataUri and setup.base32Secret
    // are server-supplied values and must never be injected into a template string.
    const card = document.createElement('div');
    card.setAttribute('style', CARD_STYLE);

    // ── Step 1 — Scan ──────────────────────────────────────────────────────────
    const step1 = document.createElement('div');
    step1.id = 'erp-setup-step1';

    // SHIELD_SVG is a static compile-time constant — safe on an isolated wrapper div
    const shieldWrap1 = document.createElement('div');
    shieldWrap1.style.marginBottom = '14px';
    shieldWrap1.innerHTML = SHIELD_SVG;

    const title1 = document.createElement('h2');
    title1.setAttribute('style', 'margin: 0 0 6px; font-size: 20px; font-weight: 700; color: #32324d;');
    title1.textContent = 'Set Up Two-Factor Authentication';

    const subtitle1 = document.createElement('p');
    subtitle1.setAttribute('style', 'margin: 0 0 20px; font-size: 13px; color: #666687; line-height: 1.5;');
    subtitle1.textContent = 'Your organisation requires 2FA. Scan the QR code below with Google Authenticator, Authy, or any TOTP app.';

    // QR image — validate URI before assigning to src
    const qrContainer = document.createElement('div');
    const safeUri = sanitizeDataUri(setup && setup.qrCodeDataUri);
    if (safeUri) {
      const img = document.createElement('img');
      img.src = safeUri;
      img.alt = 'TOTP QR Code';
      img.setAttribute('style', 'width: 180px; height: 180px; display: block; margin: 0 auto 12px;');
      qrContainer.appendChild(img);
    } else {
      const qrFallback = document.createElement('p');
      qrFallback.setAttribute('style', 'color:#d02b20; font-size:13px;');
      qrFallback.textContent = 'QR code unavailable — use the manual key below.';
      qrContainer.appendChild(qrFallback);
    }

    const manualKeyLabel = document.createElement('p');
    manualKeyLabel.setAttribute('style', 'margin: 0 0 6px; font-size: 12px; color: #8e8ea9;');
    manualKeyLabel.textContent = "Can't scan? Enter this key manually in your app:";

    step1.appendChild(shieldWrap1);
    step1.appendChild(title1);
    step1.appendChild(subtitle1);
    step1.appendChild(qrContainer);
    step1.appendChild(manualKeyLabel);

    // base32Secret — use textContent to prevent any HTML interpretation
    if (setup && setup.base32Secret) {
      const secretEl = document.createElement('div');
      secretEl.setAttribute('style', "display: inline-block; margin: 0 auto 20px; padding: 8px 16px; background: #f6f6f9; border-radius: 6px; font-family: 'Courier New', monospace; font-size: 15px; font-weight: 700; letter-spacing: 4px; color: #32324d; word-break: break-all; user-select: all; cursor: text;");
      secretEl.title = 'Click to select all';
      secretEl.textContent = setup.base32Secret;
      step1.appendChild(secretEl);
    }

    const nextBtn = document.createElement('button');
    nextBtn.id = 'erp-setup-next';
    nextBtn.setAttribute('style', 'display: block; width: 100%; padding: 12px; background: #4945ff; color: #fff; border: none; border-radius: 6px; font-size: 15px; font-weight: 600; cursor: pointer;');
    nextBtn.textContent = "I've scanned the code →";

    const setupLogoutBtn = document.createElement('button');
    setupLogoutBtn.id = 'erp-setup-logout';
    setupLogoutBtn.setAttribute('style', 'display: block; width: 100%; margin-top: 10px; padding: 10px; background: transparent; color: #8e8ea9; border: 1px solid #dcdce4; border-radius: 6px; font-size: 13px; cursor: pointer;');
    setupLogoutBtn.textContent = 'Cancel and log out';

    step1.appendChild(nextBtn);
    step1.appendChild(setupLogoutBtn);

    // ── Step 2 — Verify first code ────────────────────────────────────────────
    const step2 = document.createElement('div');
    step2.id = 'erp-setup-step2';
    step2.style.display = 'none';

    const shieldWrap2 = document.createElement('div');
    shieldWrap2.style.marginBottom = '14px';
    shieldWrap2.innerHTML = SHIELD_SVG;

    const title2 = document.createElement('h2');
    title2.setAttribute('style', 'margin: 0 0 6px; font-size: 20px; font-weight: 700; color: #32324d;');
    title2.textContent = 'Confirm Your Authenticator';

    const subtitle2 = document.createElement('p');
    subtitle2.setAttribute('style', 'margin: 0 0 24px; font-size: 14px; color: #666687; line-height: 1.5;');
    subtitle2.textContent = 'Enter the 6-digit code now shown in your authenticator app to confirm setup.';

    const codeInput = document.createElement('input');
    codeInput.id = 'erp-setup-code';
    codeInput.type = 'text';
    codeInput.setAttribute('inputmode', 'numeric');
    codeInput.setAttribute('autocomplete', 'one-time-code');
    codeInput.maxLength = 6;
    codeInput.placeholder = '000 000';
    codeInput.setAttribute('style', 'width: 160px; padding: 12px 0; font-size: 28px; font-weight: 600; text-align: center; letter-spacing: 10px; border: 2px solid #dcdce4; border-radius: 8px; color: #32324d; outline: none; transition: border-color 0.15s;');

    const errorEl = document.createElement('p');
    errorEl.id = 'erp-setup-error';
    errorEl.setAttribute('style', 'display:none; margin: 12px 0 0; font-size: 13px; color: #d02b20;');

    const verifyBtn = document.createElement('button');
    verifyBtn.id = 'erp-setup-verify';
    verifyBtn.setAttribute('style', 'display: block; width: 100%; margin-top: 24px; padding: 12px; background: #4945ff; color: #fff; border: none; border-radius: 6px; font-size: 15px; font-weight: 600; cursor: pointer; transition: opacity 0.15s;');
    verifyBtn.textContent = 'Confirm and continue';

    const backBtn = document.createElement('button');
    backBtn.id = 'erp-setup-back';
    backBtn.setAttribute('style', 'display: block; width: 100%; margin-top: 10px; padding: 10px; background: transparent; color: #8e8ea9; border: 1px solid #dcdce4; border-radius: 6px; font-size: 13px; cursor: pointer;');
    backBtn.textContent = '← Back to QR code';

    step2.appendChild(shieldWrap2);
    step2.appendChild(title2);
    step2.appendChild(subtitle2);
    step2.appendChild(codeInput);
    step2.appendChild(errorEl);
    step2.appendChild(verifyBtn);
    step2.appendChild(backBtn);

    card.appendChild(step1);
    card.appendChild(step2);
    overlay.appendChild(card);

    // Step 1 → Step 2
    nextBtn.addEventListener('click', () => {
      step1.style.display = 'none';
      step2.style.display = 'block';
      codeInput.focus();
    });

    // Step 2 → Step 1
    backBtn.addEventListener('click', () => {
      step2.style.display = 'none';
      step1.style.display = 'block';
      errorEl.style.display = 'none';
      codeInput.value = '';
    });

    codeInput.addEventListener('focus', () => { codeInput.style.borderColor = '#4945ff'; });
    codeInput.addEventListener('blur',  () => { codeInput.style.borderColor = '#dcdce4'; });
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
      errorEl.style.display = 'none';
    });

    async function handleVerify() {
      const code = codeInput.value.trim();
      if (code.length !== 6) {
        showError(errorEl, codeInput, 'Please enter all 6 digits.');
        codeInput.focus();
        return;
      }
      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Confirming…';
      verifyBtn.style.opacity = '0.7';
      errorEl.style.display = 'none';

      try {
        const resp = await _nativeFetch('/erp-session-manager/step-up/setup/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ totpCode: code }),
        });

        if (resp.ok) { overlay.remove(); resolve(); return; }

        const data = await resp.json().catch(() => ({}));
        const msg  = data?.error?.message || 'Invalid code. Please try again.';

        showError(errorEl, codeInput, msg);
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Confirm and continue';
        verifyBtn.style.opacity = '1';
        codeInput.value = '';
        codeInput.focus();
      } catch {
        showError(errorEl, codeInput, 'Network error. Please check your connection and try again.');
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Confirm and continue';
        verifyBtn.style.opacity = '1';
      }
    }

    verifyBtn.addEventListener('click', handleVerify);
    codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleVerify(); });

    // Logout from step 1
    const logoutBtn = overlay.querySelector('#erp-setup-logout');
    logoutBtn.addEventListener('click', async () => {
      try {
        await _nativeFetch('/admin/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch { /* ignore */ }
      overlay.remove();
      window.location.href = '/admin/auth/login';
    });
  });
}

// ---------------------------------------------------------------------------
// Flow 3 — STEP-UP challenge overlay (sensitive operation gate)
// ---------------------------------------------------------------------------

/**
 * Shows a TOTP challenge overlay for step-up authenticated operations
 * (e.g. change password, user/role management).
 *
 * Resolves with the step-up token string on success.
 * Rejects (with overlay removed) if the user cancels.
 *
 * @param {string} token      — admin JWT (for Authorization header)
 * @param {string|null} routeGroup — route group name shown in the subtitle
 * @returns {Promise<string>}
 */
function showStepUpChallengeOverlay(token, routeGroup) {
  return new Promise((resolve, reject) => {
    const overlay = createOverlay('erp-stepup-overlay');
    if (!overlay) {
      // Overlay already open (shouldn't happen because of _stepUpPromise guard)
      reject(new Error('Step-up overlay already open'));
      return;
    }

    const actionLabel = routeGroup === 'password_change' ? 'change your password'
      : routeGroup === 'user_management'  ? 'manage users'
      : routeGroup === 'role_management'  ? 'manage roles'
      : 'perform this action';

    const card = document.createElement('div');
    card.setAttribute('style', CARD_STYLE);

    const shieldWrap = document.createElement('div');
    shieldWrap.style.marginBottom = '16px';
    shieldWrap.innerHTML = SHIELD_SVG;

    const title = document.createElement('h2');
    title.setAttribute('style', 'margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #32324d;');
    title.textContent = 'Verify Your Identity';

    const subtitle = document.createElement('p');
    subtitle.setAttribute('style', 'margin: 0 0 28px; font-size: 14px; color: #666687; line-height: 1.5;');
    subtitle.textContent = `Enter the 6-digit code from your authenticator app to ${actionLabel}.`;

    const input = document.createElement('input');
    input.id = 'erp-stepup-input';
    input.type = 'text';
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('autocomplete', 'one-time-code');
    input.maxLength = 6;
    input.placeholder = '000 000';
    input.setAttribute('style', 'width: 160px; padding: 12px 0; font-size: 28px; font-weight: 600; text-align: center; letter-spacing: 10px; border: 2px solid #dcdce4; border-radius: 8px; color: #32324d; outline: none; transition: border-color 0.15s;');

    const errorEl = document.createElement('p');
    errorEl.id = 'erp-stepup-error';
    errorEl.setAttribute('style', 'display:none; margin: 12px 0 0; font-size: 13px; color: #d02b20;');

    const attemptsEl = document.createElement('p');
    attemptsEl.id = 'erp-stepup-attempts';
    attemptsEl.setAttribute('style', 'display:none; margin: 4px 0 0; font-size: 12px; color: #8e8ea9;');

    const submitBtn = document.createElement('button');
    submitBtn.id = 'erp-stepup-submit';
    submitBtn.setAttribute('style', 'display: block; width: 100%; margin-top: 24px; padding: 12px; background: #4945ff; color: #fff; border: none; border-radius: 6px; font-size: 15px; font-weight: 600; cursor: pointer; transition: opacity 0.15s;');
    submitBtn.textContent = 'Verify and continue';

    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'erp-stepup-cancel';
    cancelBtn.setAttribute('style', 'display: block; width: 100%; margin-top: 10px; padding: 10px; background: transparent; color: #8e8ea9; border: 1px solid #dcdce4; border-radius: 6px; font-size: 13px; cursor: pointer;');
    cancelBtn.textContent = 'Cancel';

    card.appendChild(shieldWrap);
    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(input);
    card.appendChild(errorEl);
    card.appendChild(attemptsEl);
    card.appendChild(submitBtn);
    card.appendChild(cancelBtn);
    overlay.appendChild(card);

    // Must be installed BEFORE focusing, or the create-user modal's focus trap
    // takes the focus straight back and the digits land in its own fields.
    const release = guardOverlayAgainstModalTraps(overlay);

    input.focus();
    input.addEventListener('focus', () => { input.style.borderColor = '#4945ff'; });
    input.addEventListener('blur',  () => { input.style.borderColor = '#dcdce4'; });
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
      errorEl.style.display = 'none';
      attemptsEl.style.display = 'none';
    });

    async function handleVerify() {
      const code = input.value.trim();
      if (code.length !== 6) {
        showError(errorEl, input, 'Please enter all 6 digits of your authenticator code.');
        input.focus();
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Verifying…';
      submitBtn.style.opacity = '0.7';
      errorEl.style.display = 'none';

      try {
        const resp = await _nativeFetch('/erp-session-manager/step-up/challenge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ totpCode: code }),
        });

        if (resp.ok) {
          const data = await resp.json().catch(() => ({}));
          const stepUpToken = data?.data?.token || data?.token;
          if (!stepUpToken) throw new Error('No step-up token in response.');
          release();
          resolve(stepUpToken);
          return;
        }

        const data = await resp.json().catch(() => ({}));
        const msg  = data?.error?.message || 'Invalid code. Please try again.';
        const rem  = data?.error?.details?.remainingAttempts;

        showError(errorEl, input, msg);
        if (typeof rem === 'number') {
          attemptsEl.textContent = `${rem} attempt${rem !== 1 ? 's' : ''} remaining`;
          attemptsEl.style.display = 'block';
        }
        if (resp.status === 429) {
          submitBtn.textContent = 'Too many attempts';
        } else {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Verify and continue';
          submitBtn.style.opacity = '1';
          input.value = '';
          input.focus();
        }
      } catch (err) {
        showError(errorEl, input, 'Network error. Please try again.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Verify and continue';
        submitBtn.style.opacity = '1';
      }
    }

    // Resolves null rather than rejecting: the caller then hands the original
    // 403 back to the admin UI, which reports it like any other failed save.
    // Rejecting would surface as an unhandled fetch error instead.
    function handleCancel() {
      release();
      resolve(null);
    }

    submitBtn.addEventListener('click', handleVerify);
    cancelBtn.addEventListener('click', handleCancel);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleVerify(); });

    // Escape must work even if the pointer guards ever regress — without a way
    // out, a stuck overlay leaves the panel unusable until a page reload.
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') handleCancel(); });
  });
}

// ---------------------------------------------------------------------------
// Shared error helper
// ---------------------------------------------------------------------------

function showError(errorEl, input, msg) {
  errorEl.textContent   = msg;
  errorEl.style.display = 'block';
  if (input) input.style.borderColor = '#d02b20';
}

// ---------------------------------------------------------------------------
// VAPT #8 — Session Inactivity Timeout
//
// Client-side idle detection as belt-and-suspenders on top of the server-side
// idleTimeout enforced by plugin::erp-session-manager.session-auth.
//
// Timeline (window length = Settings → Policy "Idle Timeout"; warning appears
// 2 min before the end, or at 80% of the window for short timeouts):
//   0 ──────────── normal activity ──────────┤ warning ├── auto-logout
//
// Warning overlay shows a countdown timer and two buttons:
//   • "Stay logged in" — pings /admin/auth/me to reset server idle timer,
//     hides the overlay, resets the client-side idle clock.
//   • "Logout now" — calls /admin/logout then redirects to /admin/auth/login.
//
// Any mouse/keyboard/touch activity during the warning window dismisses it
// automatically and resets the idle clock.
//
// The last-activity timestamp is mirrored to localStorage. The in-memory clock
// dies with the page, so before that a reload handed the user a brand-new idle
// window — the "still on the same page after reload" bypass from the VAPT
// report. It also lets sibling tabs share one clock.
// ---------------------------------------------------------------------------

const _IDLE_CHECK_INTERVAL = 5 * 1000;          // poll every 5 s
const _IDLE_HEARTBEAT_PATH = '/admin/auth/me';  // lightweight auth ping
const _IDLE_STORAGE_KEY    = 'erpLastActivityAt';
const _IDLE_PERSIST_THROTTLE_MS = 2000;         // cap localStorage writes on mousemove

// Defaults; replaced at bootstrap by Settings → Policy idleTimeoutMinutes so a
// value edited in the panel (including a deliberately short one for testing)
// actually governs the client-side clock.
let _idleLogoutMs   = 15 * 60 * 1000;
let _idleWarnLeadMs = 2 * 60 * 1000;   // how long before logout the warning appears

let _lastActivityAt  = Date.now();
let _lastPersistAt   = 0;
let _idleCheckTimer  = null;
let _idleWarningEl   = null;
let _loggingOut      = false;

/**
 * Last-activity timestamp is mirrored to localStorage because the in-memory
 * clock dies with the page. Without this, reloading reset the idle countdown to
 * zero — so an expired session survived indefinitely as long as the user kept
 * pressing refresh, which is exactly the bypass the VAPT report flagged.
 */
function _readStoredActivity() {
  try {
    const v = Number(globalThis.localStorage.getItem(_IDLE_STORAGE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}

function _writeStoredActivity(ts) {
  try { globalThis.localStorage.setItem(_IDLE_STORAGE_KEY, String(ts)); } catch { /* private mode */ }
}

function _clearStoredActivity() {
  try { globalThis.localStorage.removeItem(_IDLE_STORAGE_KEY); } catch { /* private mode */ }
}

/** Milliseconds the user has been idle, taking other tabs into account. */
function _idleFor() {
  const stored = _readStoredActivity();
  const last   = stored && stored > _lastActivityAt ? stored : _lastActivityAt;
  return Date.now() - last;
}

/** Record user activity and dismiss the warning overlay if it's visible. */
function _recordActivity() {
  const now = Date.now();
  _lastActivityAt = now;
  if (now - _lastPersistAt >= _IDLE_PERSIST_THROTTLE_MS) {
    _lastPersistAt = now;
    _writeStoredActivity(now);
  }
  if (_idleWarningEl) {
    _idleWarningEl.remove();
    _idleWarningEl = null;
  }
}

/** Install passive capture listeners for common user-interaction events. */
function _installActivityListeners() {
  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach((evt) => {
    document.addEventListener(evt, _recordActivity, { passive: true, capture: true });
  });
}

/**
 * Get the current admin access token.
 *
 * Strapi stores it two different ways (see @strapi/admin utils/getFetchClient):
 *   • "remember me" on  → localStorage 'jwtToken', JSON.stringify'd (quoted!)
 *   • "remember me" off → a plain 'jwtToken' cookie
 * Reading localStorage raw therefore yielded a quoted token in the first case
 * (producing a malformed `Bearer "eyJ…"` header) and nothing at all in the
 * second — so the idle logout never actually reached the server.
 */
function _getAdminToken() {
  let raw = '';
  try { raw = globalThis.localStorage.getItem('jwtToken') || ''; } catch { /* private mode */ }
  if (!raw) {
    try { raw = globalThis.sessionStorage.getItem('jwtToken') || ''; } catch { /* private mode */ }
  }
  if (!raw) {
    try {
      const match = document.cookie
        .split(';')
        .map((c) => c.trim().split('='))
        .find(([k]) => k === 'jwtToken');
      raw = match ? decodeURIComponent(match[1] || '') : '';
    } catch { /* non-fatal */ }
  }
  if (!raw) return '';

  // Unwrap JSON.stringify'd values ("eyJ…" → eyJ…)
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
  } catch { /* not JSON — already a bare token */ }
  return raw;
}

/** Remove every copy of the admin token the panel may hold. */
function _clearAdminToken() {
  try { globalThis.localStorage.removeItem('jwtToken'); } catch { /* non-fatal */ }
  try { globalThis.sessionStorage.removeItem('jwtToken'); } catch { /* non-fatal */ }
  try { document.cookie = 'jwtToken=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;'; } catch { /* non-fatal */ }
}

/** Ping the server to reset its server-side idle timestamp without navigating. */
async function _heartbeat() {
  const token = _getAdminToken();
  if (!token) return;
  try {
    await _nativeFetch(_IDLE_HEARTBEAT_PATH, {
      method:  'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch { /* ignore — heartbeat failure is non-fatal */ }
}

/** Perform a graceful logout: call /admin/logout, then redirect to login page. */
async function _doIdleLogout() {
  if (_loggingOut) return;      // a reload can race the interval — only log out once
  _loggingOut = true;

  if (_idleCheckTimer) { clearInterval(_idleCheckTimer); _idleCheckTimer = null; }
  if (_idleWarningEl)  { _idleWarningEl.remove(); _idleWarningEl = null; }

  // Clear before the redirect so the next login starts with a fresh clock
  // rather than inheriting this session's stale timestamp.
  _clearStoredActivity();

  const token = _getAdminToken();
  try {
    if (token) {
      await _nativeFetch('/admin/logout', {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  } catch { /* ignore logout errors — redirect regardless */ }

  _clearAdminToken();

  window.location.href = '/admin/auth/login?reason=idle';
}

/**
 * Pull the live idle timeout from Settings → Policy.
 * Any authenticated admin may read it; on failure the defaults above stand.
 */
async function _loadIdlePolicy() {
  const token = _getAdminToken();
  if (!token) return;
  try {
    const res = await _nativeFetch('/erp-session-manager/policy', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const json = await res.json();
    const mins = Number(json?.data?.idleTimeoutMinutes);
    if (Number.isFinite(mins) && mins > 0) {
      _idleLogoutMs = mins * 60 * 1000;
      // Warn 2 min ahead, or 20% of the window for short timeouts, floor 15 s.
      _idleWarnLeadMs = Math.min(2 * 60 * 1000, Math.max(15 * 1000, _idleLogoutMs * 0.2));
    }
  } catch { /* keep defaults */ }
}

/** Format remaining milliseconds as "M:SS". */
function _fmtCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Show the idle-warning overlay.
 * Displays a countdown timer and two buttons.
 * Dismissed automatically if the user interacts with the page (_recordActivity).
 */
function _showIdleWarning() {
  if (_idleWarningEl) return;   // already visible

  const overlay = createOverlay('erp-idle-warning');
  if (!overlay) return;
  _idleWarningEl = overlay;

  const card = document.createElement('div');
  card.setAttribute('style', CARD_STYLE);

  // SHIELD_SVG is a static compile-time constant — safe as innerHTML on
  // a freshly created, never-attached wrapper div.
  const shieldWrap = document.createElement('div');
  shieldWrap.style.marginBottom = '12px';
  shieldWrap.innerHTML = SHIELD_SVG;

  const title = document.createElement('h2');
  title.setAttribute('style', 'margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #32324d;');
  title.textContent = 'Session Expiring Soon';

  const msg = document.createElement('p');
  msg.setAttribute('style', 'margin: 0 0 6px; font-size: 14px; color: #666687; line-height: 1.5;');
  msg.textContent = 'Your session will expire due to inactivity in:';

  const countdown = document.createElement('div');
  countdown.id = 'erp-idle-countdown';
  countdown.setAttribute('style',
    'font-size: 44px; font-weight: 700; color: #d02b20; margin: 8px 0 24px; ' +
    'letter-spacing: 2px; font-variant-numeric: tabular-nums;'
  );

  const remaining = () => Math.max(0, _idleLogoutMs - _idleFor());
  countdown.textContent = _fmtCountdown(remaining());

  const stayBtn = document.createElement('button');
  stayBtn.id = 'erp-idle-stay';
  stayBtn.setAttribute('style',
    'display: block; width: 100%; padding: 12px; background: #4945ff; color: #fff; ' +
    'border: none; border-radius: 6px; font-size: 15px; font-weight: 600; cursor: pointer; ' +
    'margin-bottom: 10px; transition: opacity 0.15s;'
  );
  stayBtn.textContent = 'Stay logged in';

  const logoutBtn = document.createElement('button');
  logoutBtn.id = 'erp-idle-logout';
  logoutBtn.setAttribute('style',
    'display: block; width: 100%; padding: 10px; background: transparent; ' +
    'color: #8e8ea9; border: 1px solid #dcdce4; border-radius: 6px; font-size: 13px; cursor: pointer;'
  );
  logoutBtn.textContent = 'Logout now';

  card.appendChild(shieldWrap);
  card.appendChild(title);
  card.appendChild(msg);
  card.appendChild(countdown);
  card.appendChild(stayBtn);
  card.appendChild(logoutBtn);
  overlay.appendChild(card);

  // Tick the countdown every second; auto-logout when it hits 0
  const ticker = setInterval(() => {
    const rem = remaining();
    countdown.textContent = _fmtCountdown(rem);
    if (rem === 0) {
      clearInterval(ticker);
      _doIdleLogout();
    }
  }, 1000);

  stayBtn.addEventListener('click', async () => {
    clearInterval(ticker);
    _recordActivity();   // dismisses overlay + resets idle clock
    await _heartbeat();  // reset server-side idle timer
  });

  logoutBtn.addEventListener('click', () => {
    clearInterval(ticker);
    _doIdleLogout();
  });
}

let _policyLoaded = false;

/**
 * Reconcile the tracker with the panel's auth state.
 *
 * bootstrap() runs once when the admin app mounts — which may be on the login
 * page, before any token exists. Logging in is a client-side transition with no
 * remount, so the policy has to be (re)loaded lazily once a token appears.
 *
 * @returns {Promise<boolean>} whether a session is currently active
 */
async function _syncAuthState() {
  if (!_getAdminToken()) {
    // Logged out or still on the login screen: drop the stored clock so the
    // next session cannot inherit the previous one's idle time.
    _policyLoaded = false;
    _clearStoredActivity();
    _lastActivityAt = Date.now();
    return false;
  }
  if (!_policyLoaded) {
    _policyLoaded = true;
    await _loadIdlePolicy();
    if (!_readStoredActivity()) _recordActivity();  // first load of a new session
  }
  return true;
}

/** Evaluate idle state once. */
async function _checkIdle() {
  if (_loggingOut) return;
  if (!(await _syncAuthState())) return;

  const idle = _idleFor();
  if (idle >= _idleLogoutMs) {
    _doIdleLogout();
  } else if (idle >= _idleLogoutMs - _idleWarnLeadMs) {
    _showIdleWarning();
  }
}

/** Periodic idle-state checker. */
function _startIdleChecker() {
  _idleCheckTimer = setInterval(_checkIdle, _IDLE_CHECK_INTERVAL);
}

/** Keep sibling tabs in sync — activity in one tab counts for all of them. */
function _installStorageSync() {
  globalThis.addEventListener('storage', (e) => {
    if (e.key !== _IDLE_STORAGE_KEY || !e.newValue) return;
    const ts = Number(e.newValue);
    if (Number.isFinite(ts) && ts > _lastActivityAt) {
      _lastActivityAt = ts;
      if (_idleWarningEl) { _idleWarningEl.remove(); _idleWarningEl = null; }
    }
  });
}

// ---------------------------------------------------------------------------
// Strapi admin bootstrap export
// ---------------------------------------------------------------------------

const bootstrap = () => {
  // VAPT #8: start idle tracker after admin panel mounts (DOM is ready here).
  //
  // Read the persisted timestamp BEFORE installing activity listeners: a stray
  // mousemove or scroll fired during page load would otherwise refresh the
  // clock and hand a reload a brand-new idle window — the bypass being fixed.
  const bootStoredActivity = _readStoredActivity();

  _installActivityListeners();
  _installStorageSync();
  _startIdleChecker();

  (async () => {
    if (!(await _syncAuthState())) return;
    if (bootStoredActivity && Date.now() - bootStoredActivity >= _idleLogoutMs) {
      _doIdleLogout();
    }
  })();
};

export default {
  config: {},
  bootstrap,
};
