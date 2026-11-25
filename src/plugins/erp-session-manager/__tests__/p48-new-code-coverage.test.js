'use strict';

const policyControllerFactory = require('../server/controllers/admin/policy');
const RedisStore = require('../server/services/store/redis-store');
const adminAuthFactory = require('../server/hooks/admin-auth');
const usersPermissionsFactory = require('../server/hooks/users-permissions');

describe('P48 — New Code Coverage (Refactored Methods)', () => {
  describe('Policy Controller', () => {
    test('getPolicy returns wrapped policy or handles 500 error', async () => {
      const mockPolicy = { idleTimeoutMinutes: 30 };
      const strapi = {
        plugin: () => ({
          service: () => ({
            getPolicy: async () => mockPolicy,
          }),
        }),
      };
      const controller = policyControllerFactory({ strapi });

      const ctxSuccess = { state: {}, set: jest.fn() };
      await controller.getPolicy(ctxSuccess);
      expect(ctxSuccess.body.data).toEqual(mockPolicy);

      const strapiErr = {
        plugin: () => ({
          service: () => ({
            getPolicy: async () => { throw new Error('DB Error'); },
          }),
        }),
      };
      const controllerErr = policyControllerFactory({ strapi: strapiErr });
      const ctxErr = { state: {}, set: jest.fn() };
      await controllerErr.getPolicy(ctxErr);
      expect(ctxErr.status).toBe(500);
      expect(ctxErr.body.error.message).toBe('DB Error');
    });

    test('updatePolicy validates boolean and number types', async () => {
      const strapi = {
        plugin: () => ({
          service: () => ({
            updatePolicy: async () => {},
            getPolicy: async () => ({ idleTimeoutMinutes: 60 }),
          }),
        }),
      };
      const controller = policyControllerFactory({ strapi });

      // Invalid number
      const ctxBadNum = { state: { user: { id: 1 } }, request: { body: { idleTimeoutMinutes: -5 } }, set: jest.fn() };
      await controller.updatePolicy(ctxBadNum);
      expect(ctxBadNum.status).toBe(400);

      // Invalid boolean
      const ctxBadBool = { state: { user: { id: 1 } }, request: { body: { blockOnIpChange: 'not-a-bool' } }, set: jest.fn() };
      await controller.updatePolicy(ctxBadBool);
      expect(ctxBadBool.status).toBe(400);

      // Valid update
      const ctxOk = { state: { user: { id: 1 } }, request: { body: { idleTimeoutMinutes: 60, enforceMaxConcurrent: true } }, set: jest.fn() };
      await controller.updatePolicy(ctxOk);
      expect(ctxOk.body.data.idleTimeoutMinutes).toBe(60);

      // Service throw
      const strapiThrow = {
        plugin: () => ({
          service: () => ({
            updatePolicy: async () => { throw new Error('Update failed'); },
          }),
        }),
      };
      const controllerThrow = policyControllerFactory({ strapi: strapiThrow });
      const ctxThrow = { state: { user: { id: 1 } }, request: { body: { idleTimeoutMinutes: 30 } }, set: jest.fn() };
      await controllerThrow.updatePolicy(ctxThrow);
      expect(ctxThrow.status).toBe(500);
    });
  });


  describe('Redis Store Helpers', () => {
    test('_filterRecords and _sortRecords work correctly', () => {
      const store = new RedisStore({ config: {} });
      const now = Date.now();
      const records = [
        { id: '1', userId: 10, isRevoked: false, expiresAt: now + 10000, lastActive: 100 },
        { id: '2', userId: 20, isRevoked: true, expiresAt: now + 10000, lastActive: 200 },
        { id: '3', userId: 10, isRevoked: false, expiresAt: now + 10000, lastActive: 300 },
      ];

      const filtered = store._filterRecords(records, { userId: 10, status: 'active' }, now);
      expect(filtered).toHaveLength(2);

      const sorted = store._sortRecords(records, 'lastActive', 'desc');
      expect(sorted[0].id).toBe('3');
      expect(sorted[2].id).toBe('1');
    });
  });

  describe('Admin Auth Hook Helpers', () => {
    test('_verifyRecaptcha returns boolean correctly', async () => {
      const hook = adminAuthFactory({ strapi: { log: { warn: jest.fn() } } });

      // Disabled / no secret
      expect(await hook._verifyRecaptcha({}, { enabled: false })).toBe(true);

      // No token in request
      expect(await hook._verifyRecaptcha({ request: { body: {} } }, { enabled: true, secretKey: 'sec' })).toBe(true);
    });

    test('_syncTotpGate and _applyTotpGateForUser work correctly', async () => {
      const mockTotp = { clear: jest.fn(), require: jest.fn(), requireSetup: jest.fn() };
      const mockStepUp = { getStatus: async () => ({ provisioned: true }), provisionSecret: async () => ({}) };
      const strapi = {
        log: { warn: jest.fn(), debug: jest.fn() },
        plugin: () => ({
          service: (s) => {
            if (s === 'stepUpConfig') return { getEnabled: async () => true };
            if (s === 'adminLoginTotp') return mockTotp;
            if (s === 'stepUp') return mockStepUp;
            return null;
          },
        }),
        service: () => ({
          findOne: async () => ({ roles: [{ code: 'strapi-super-admin' }] }),
        }),
      };

      const hook = adminAuthFactory({ strapi });
      await hook._applyTotpGateForUser(123);
      expect(mockTotp.clear).toHaveBeenCalledWith(123);
      expect(mockTotp.require).toHaveBeenCalledWith(123);
    });

    test('_handleAdminPasswordChange and _postAdminPasswordChange work correctly', async () => {
      const revokeAll = jest.fn();
      const recordPw = jest.fn();
      const strapi = {
        log: { warn: jest.fn(), debug: jest.fn() },
        plugin: () => ({
          service: (s) => {
            if (s === 'session') return { revokeAllForUser: revokeAll };
            if (s === 'passwordValidationHook') return { _checkPasswordHistory: async () => false, _recordPasswordHistory: recordPw };
            return null;
          },
        }),
      };

      const hook = adminAuthFactory({ strapi });
      const ctx = {
        status: 200,
        state: { user: { id: 42 } },
        request: { body: { currentPassword: 'old', password: 'new' } },
      };
      const next = jest.fn();

      await hook._handleAdminPasswordChange(ctx, next);
      expect(next).toHaveBeenCalled();
      expect(revokeAll).toHaveBeenCalledWith(42);
      expect(recordPw).toHaveBeenCalledWith(42, 'admin', 'new');
    });

    test('_handleAdminLoginRoute, _handleAdminCaptchaProtectedRoutes and _handleAdminLogoutRoute', async () => {
      const mockBlacklist = { revokeToken: jest.fn() };
      const strapi = {
        log: { warn: jest.fn(), debug: jest.fn() },
        config: { get: () => ({ recaptcha: { enabled: false } }) },
        plugin: () => ({ service: () => mockBlacklist }),
      };

      const hook = adminAuthFactory({ strapi });
      hook._pendingContext = new Map();
      hook._cleanupPendingContext = jest.fn();
      hook._syncTotpGate = jest.fn();

      const next = jest.fn();

      // Login route
      const ctxLogin = { ip: '127.0.0.1', get: () => 'agent' };
      await hook._handleAdminLoginRoute(ctxLogin, next);
      expect(next).toHaveBeenCalled();

      // Captcha protected routes
      const ctxCaptcha = {};
      await hook._handleAdminCaptchaProtectedRoutes(ctxCaptcha, next);

      // Logout route
      const ctxLogout = {
        status: 200,
        ip: '127.0.0.1',
        get: (h) => (h === 'Authorization' ? 'Bearer admin-jwt-token' : 'agent'),
        state: { user: { id: 99 } },
      };
      await hook._handleAdminLogoutRoute(ctxLogout, next);
      expect(mockBlacklist.revokeToken).toHaveBeenCalledWith('admin-jwt-token', 99, 'LOGOUT');
    });

    test('_registerMiddleware registers route interceptors on strapi.server', async () => {
      let registeredMiddleware = null;
      const strapi = {
        log: { warn: jest.fn(), debug: jest.fn() },
        server: {
          use: (fn) => { registeredMiddleware = fn; },
        },
      };

      const hook = adminAuthFactory({ strapi });
      hook._handleAdminLoginRoute = jest.fn().mockResolvedValue('login');
      hook._handleAdminCaptchaProtectedRoutes = jest.fn().mockResolvedValue('captcha');
      hook._handleAdminPasswordChange = jest.fn().mockResolvedValue('pwChange');
      hook._handleAdminLogoutRoute = jest.fn().mockResolvedValue('logout');

      hook._registerMiddleware();
      expect(registeredMiddleware).toBeDefined();

      const next = jest.fn().mockResolvedValue('next');

      expect(await registeredMiddleware({ method: 'POST', path: '/admin/login' }, next)).toBe('login');
      expect(await registeredMiddleware({ method: 'POST', path: '/admin/forgot-password' }, next)).toBe('captcha');
      expect(await registeredMiddleware({ method: 'PUT', path: '/admin/users/me' }, next)).toBe('pwChange');
      expect(await registeredMiddleware({ method: 'POST', path: '/admin/logout' }, next)).toBe('logout');
      expect(await registeredMiddleware({ method: 'GET', path: '/admin/other' }, next)).toBe('next');
    });
  });

  describe('Users-Permissions Hook', () => {
    test('callback wrapper executes post-login logic and logs failure on error', async () => {
      const mockAuthCtrl = { callback: jest.fn() };
      const auditLog = jest.fn();
      const strapi = {
        log: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
        config: { get: () => ({ captcha: { enabled: false } }) },
        plugin: (p) => {
          if (p === 'users-permissions') return { controller: () => mockAuthCtrl };
          if (p === 'erp-session-manager') return { service: () => ({ log: auditLog }) };
          return null;
        },
      };

      const upHook = usersPermissionsFactory({ strapi });
      upHook.register();

      // Test successful callback (200 with jwt)
      const ctxSuccess = { status: 200, body: { jwt: 'token', user: { id: 5 } }, state: {} };
      upHook.onLoginSuccess = jest.fn();
      await mockAuthCtrl.callback(ctxSuccess);
      expect(upHook.onLoginSuccess).toHaveBeenCalled();

      // Test 429 error propagate from onLoginSuccess
      const ctx429 = { status: 200, body: { jwt: 'token', user: { id: 5 } }, state: {} };
      upHook.onLoginSuccess = jest.fn().mockRejectedValue({ status: 429, message: 'Too many concurrent sessions' });
      await mockAuthCtrl.callback(ctx429);
      expect(ctx429.status).toBe(429);

      // Test 400 failure audit log
      const ctx400 = { status: 400, get: () => 'UA', ip: '1.2.3.4' };
      await mockAuthCtrl.callback(ctx400);
      expect(auditLog).toHaveBeenCalled();
    });
  });

  describe('Admin Auth Hook Event Listeners', () => {
    test('_onAdminLoginSuccess handles device tracking, business hours, and session creation', async () => {
      const mockSession = {
        createSession: jest.fn().mockResolvedValue({ sessionId: 's-123', expiresAt: Date.now() + 3600000 }),
        enforceMaxConcurrent: jest.fn().mockResolvedValue(),
      };
      const mockAudit = { log: jest.fn() };
      const mockAlert = { sendNewDeviceAlert: jest.fn(), sendAnomalyAlert: jest.fn() };
      const mockPolicy = { getPolicy: jest.fn().mockResolvedValue({ alertNewDevice: true, businessHoursStart: 9, businessHoursEnd: 18 }) };

      const strapi = {
        log: { error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        documents: () => ({
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        }),
        plugin: (p) => {
          if (p === 'erp-session-manager') {
            return {
              service: (s) => {
                if (s === 'session') return mockSession;
                if (s === 'auditLogger') return mockAudit;
                if (s === 'adminAlert') return mockAlert;
                if (s === 'policy') return mockPolicy;
                return null;
              },
            };
          }
          return null;
        },
      };

      const hook = adminAuthFactory({ strapi });
      hook._pendingContext = new Map();
      hook._pendingContext.set('__latest_login__', { ip: '192.168.1.1', userAgent: 'TestBrowser' });

      await hook._onAdminLoginSuccess({ id: 10, email: 'admin@example.com' });

      expect(mockSession.createSession).toHaveBeenCalledWith({
        userId: 10,
        ipAddress: '192.168.1.1',
        userAgent: 'TestBrowser',
        deviceHash: expect.any(String),
        sessionType: 'admin',
      });
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'LOGIN_SUCCESS',
        userId: 10,
        sessionId: 's-123',
      }));
    });

    test('_onAdminLoginFailure records failed login attempt', async () => {
      const mockAudit = { log: jest.fn() };
      const strapi = {
        log: { error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        plugin: () => ({
          service: () => mockAudit,
        }),
      };

      const hook = adminAuthFactory({ strapi });
      hook._pendingContext = new Map();

      await hook._onAdminLoginFailure({ message: 'Invalid credentials' });
      expect(mockAudit.log).toHaveBeenCalled();
    });

    test('_onAdminLogout revokes session and logs event', async () => {
      const mockSession = { revokeSession: jest.fn().mockResolvedValue() };
      const mockAudit = { log: jest.fn() };
      const mockTotp = { clear: jest.fn() };
      const strapi = {
        log: { error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        plugin: () => ({
          service: (s) => {
            if (s === 'session') return mockSession;
            if (s === 'auditLogger') return mockAudit;
            if (s === 'adminLoginTotp') return mockTotp;
            return null;
          },
        }),
      };

      const hook = adminAuthFactory({ strapi });
      hook._pendingContext = new Map();
      hook._pendingContext.set('session_15', { sessionId: 's-admin-15' });

      await hook._onAdminLogout({ id: 15 });
      expect(mockTotp.clear).toHaveBeenCalledWith(15);
      expect(mockSession.revokeSession).toHaveBeenCalledWith('s-admin-15');
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'LOGOUT',
        userId: 15,
      }));
    });
  });

  describe('Step-Up Auth Middleware', () => {
    const stepUpMiddlewareFactory = require('../server/middlewares/step-up-auth');

    test('passes through unprotected routes', async () => {
      const next = jest.fn().mockResolvedValue();
      const strapi = {
        config: { get: () => ({ stepUp: { enabled: false } }) },
        plugin: () => ({ service: () => ({ getEnabled: async () => false }) }),
      };
      const middleware = stepUpMiddlewareFactory({}, { strapi });
      const ctx = { method: 'GET', path: '/admin/unprotected-route', url: '/admin/unprotected-route', get: () => '' };

      await middleware(ctx, next);
      expect(next).toHaveBeenCalled();
    });

    // NOTE: these two use policy_management. Neither user nor role writes are
    // gated any more, so /admin/users and /admin/roles fall through the inline
    // default protectedRoutes and would never reach the 403 path.
    test('intercepts a protected route group when stepUp enabled', async () => {
      const next = jest.fn();
      const mockStepUpSvc = {
        verifyStepUpToken: jest.fn().mockResolvedValue({ valid: true }),
      };
      const strapi = {
        config: { get: () => ({ stepUp: { enabled: true } }) },
        plugin: (p) => {
          if (p === 'erp-session-manager') {
            return {
              service: (s) => {
                if (s === 'stepUpConfig') return { getEnabled: async () => true, isRouteProtected: () => true };
                if (s === 'stepUp') return mockStepUpSvc;
                return null;
              },
            };
          }
          return null;
        },
      };
      const middleware = stepUpMiddlewareFactory({}, { strapi });
      const ctx = {
        method: 'PUT',
        path: '/erp-session-manager/config',
        url: '/erp-session-manager/config',
        ip: '127.0.0.1',
        request: { ip: '127.0.0.1' },
        get: (h) => (h === 'X-Step-Up-Token' ? 'valid-step-up-token' : ''),
      };

      await middleware(ctx, next);
      expect(next).toHaveBeenCalled();
    });

    test('rejects protected route when stepUp token missing or invalid', async () => {
      const next = jest.fn();
      const mockStepUpSvc = {
        verifyStepUpToken: jest.fn().mockResolvedValue({ valid: false }),
      };
      const strapi = {
        config: { get: () => ({ stepUp: { enabled: true } }) },
        plugin: (p) => {
          if (p === 'erp-session-manager') {
            return {
              service: (s) => {
                if (s === 'stepUpConfig') return { getEnabled: async () => true, isRouteProtected: () => true };
                if (s === 'stepUp') return mockStepUpSvc;
                return null;
              },
            };
          }
          return null;
        },
      };
      const middleware = stepUpMiddlewareFactory({}, { strapi });
      const ctx = {
        method: 'PUT',
        path: '/erp-session-manager/config',
        url: '/erp-session-manager/config',
        ip: '127.0.0.1',
        request: { ip: '127.0.0.1' },
        get: () => '',
      };



      await middleware(ctx, next);
      expect(ctx.status).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Users-Permissions Hook Guard', () => {
    test('logs error when users-permissions plugin is not installed', () => {
      const strapi = {
        log: { error: jest.fn() },
        plugin: () => null,
      };
      const hook = usersPermissionsFactory({ strapi });
      hook.register();
      expect(strapi.log.error).toHaveBeenCalledWith(expect.stringContaining('is not installed'));
    });
  });

  describe('Password Validation Hook Helpers', () => {
    const passwordValidationFactory = require('../server/hooks/password-validation');

    test('_validatePassword returns true on failure and sets status 400', () => {
      const mockValidator = {
        validate: () => ({ valid: false, violations: [{ rule: 'minLength', message: 'Too short' }] }),
      };
      const mockAudit = { log: jest.fn() };
      const strapi = {
        log: { warn: jest.fn() },
        config: { get: () => ({ password: {} }) },
        plugin: () => ({
          service: (s) => {
            if (s === 'passwordValidator') return mockValidator;
            if (s === 'auditLogger') return mockAudit;
            return null;
          },
        }),
      };

      const hook = passwordValidationFactory({ strapi });
      const ctx = { ip: '127.0.0.1', get: () => '' };
      const rejected = hook._validatePassword(ctx, 'short');

      expect(rejected).toBe(true);
      expect(ctx.status).toBe(400);
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'PASSWORD_REJECTED' }));
    });

    test('_checkPasswordHistory detects reuse and returns true', async () => {
      const mockHistorySvc = { checkReuse: jest.fn().mockResolvedValue(true) };
      const mockAudit = { log: jest.fn() };
      const strapi = {
        config: { get: () => ({ password: { passwordHistory: 5 } }) },
        plugin: () => ({
          service: (s) => {
            if (s === 'passwordHistory') return mockHistorySvc;
            if (s === 'auditLogger') return mockAudit;
            return null;
          },
        }),
      };

      const hook = passwordValidationFactory({ strapi });
      const ctx = { ip: '127.0.0.1', get: () => '' };
      const rejected = await hook._checkPasswordHistory(ctx, 10, 'content-api', 'OldPassword123!');

      expect(rejected).toBe(true);
      expect(ctx.status).toBe(400);
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'PASSWORD_HISTORY_VIOLATION' }));
    });
  });


  describe('Session Auth Middleware', () => {
    const sessionAuthMiddlewareFactory = require('../server/middlewares/session-auth');

    test('exempts AUTH_EXEMPT_PATHS', async () => {
      const next = jest.fn().mockResolvedValue();
      const middleware = sessionAuthMiddlewareFactory({}, { strapi: {} });
      const ctx = { path: '/admin/login', get: () => '' };

      await middleware(ctx, next);
      expect(next).toHaveBeenCalled();
    });

    test('passes through anonymous requests (no token, no user state)', async () => {
      const next = jest.fn().mockResolvedValue();
      const middleware = sessionAuthMiddlewareFactory({}, { strapi: {} });
      const ctx = { path: '/api/posts', get: () => '' };

      await middleware(ctx, next);
      expect(next).toHaveBeenCalled();
    });

    test('handles revoked token from tokenRevocation service', async () => {
      const next = jest.fn();
      const mockTokenRevocation = {
        isRevokedByHash: () => true,
        isUserRevoked: () => false,
      };
      const strapi = {
        plugin: (p) => {
          if (p === 'erp-session-manager') return { service: () => mockTokenRevocation };
          return null;
        },
      };

      const middleware = sessionAuthMiddlewareFactory({}, { strapi });
      const ctx = {
        path: '/api/protected',
        get: (h) => (h === 'Authorization' ? 'Bearer some-revoked-token' : ''),
        state: { user: { id: 100 } },
      };

      await middleware(ctx, next);
      expect(ctx.status).toBe(401);
      expect(ctx.body.error.message).toBe('Token has been revoked.');
      expect(next).not.toHaveBeenCalled();
    });

    test('handles active session with normal passthrough', async () => {
      const next = jest.fn().mockResolvedValue();
      const storeModule = require('../server/services/store');

      const mockSessionService = { checkTimeouts: async () => ({ valid: true }) };
      const mockAudit = { log: jest.fn() };
      const mockAnomaly = { check: async () => ({ anomalies: [], shouldBlock: false }), evaluate: async () => ({ anomalies: [], shouldBlock: false }) };
      const mockTotp = { isRequired: () => false };

      const mockStore = {
        getByUser: async () => [{
          sessionId: 's-active',
          userId: 50,
          sessionType: 'content',
          isRevoked: false,
          expiresAt: Date.now() + 3600000,
          lastActive: Date.now(),
        }],
        updateLastActive: jest.fn().mockResolvedValue(),
      };
      jest.spyOn(storeModule, 'getStore').mockReturnValue(mockStore);

      const strapi = {
        plugin: (p) => {
          if (p === 'erp-session-manager') {
            return {
              service: (s) => {
                if (s === 'session') return mockSessionService;
                if (s === 'auditLogger') return mockAudit;
                if (s === 'anomalyDetector') return mockAnomaly;
                if (s === 'tokenRevocation') return { isRevokedByHash: () => false, isUserRevoked: () => false };
                if (s === 'adminLoginTotp') return mockTotp;
                return null;
              },
            };
          }
          return null;
        },
      };

      const middleware = sessionAuthMiddlewareFactory({}, { strapi });
      const ctx = {
        path: '/api/protected',
        get: () => '',
        ip: '127.0.0.1',
        request: { ip: '127.0.0.1' },
        state: { user: { id: 50 } },
      };

      await middleware(ctx, next);
      expect(next).toHaveBeenCalled();
      expect(mockStore.updateLastActive).toHaveBeenCalledWith('s-active', expect.any(Number));
    });
  });
});



