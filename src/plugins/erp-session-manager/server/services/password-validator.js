'use strict';

/**
 * PasswordValidator — enforces configurable password complexity rules.
 *
 * Rules evaluated (Req 10.2):
 *   minLength, maxLength, requireUppercase, requireLowercase,
 *   requireDigit, requireSpecial, preventCommonPasswords
 *
 * Common password check uses binary search on the sorted 10k list
 * bundled in server/utils/common-passwords.js (Design §5.5).
 *
 * References: Req 10.1–10.5, Design §5.5
 */

const { isCommonPassword } = require('../utils/common-passwords');

module.exports = ({ strapi: _strapi }) => ({
  /**
   * validate(password, passwordConfig)
   *
   * Evaluates the password against all configured complexity rules.
   *
   * @param {string} password — the plaintext password to validate
   * @param {object} passwordConfig — resolved `password` section of plugin config
   * @returns {{ valid: boolean, violations: Array<{ rule: string, message: string }> }}
   */
  validate(password, passwordConfig) {
    const cfg = passwordConfig || {};
    const violations = [];

    const minLength              = typeof cfg.minLength === 'number' ? cfg.minLength : 12;
    const maxLength              = typeof cfg.maxLength === 'number' ? cfg.maxLength : 128;
    const preventCommonPasswords = cfg.preventCommonPasswords !== false;

    if (typeof password !== 'string' || password.length === 0) {
      violations.push({ rule: 'required', message: 'Password is required.' });
      return { valid: false, violations };
    }

    if (password.length < minLength) {
      violations.push({ rule: 'minLength', message: `Password must be at least ${minLength} characters long.` });
    }

    if (password.length > maxLength) {
      violations.push({ rule: 'maxLength', message: `Password must not exceed ${maxLength} characters.` });
    }

    checkCharacterRules(password, cfg, violations);

    // preventCommonPasswords
    if (preventCommonPasswords && isCommonPassword(password)) {
      violations.push({
        rule: 'preventCommonPasswords',
        message: 'Password is too common. Please choose a more unique password.',
      });
    }

    return { valid: violations.length === 0, violations };
  },
});
