'use strict';
const { encryptRsa, decrptRsa, generateHash } = require("../../../utility/encryption");
const { sanitizeDeep } = require('../../../middlewares/xss-input-sanitizer');
// include form-schema/inquire.json
// const inquireFormSchema = require("../form-schema/inquire.json");

/**
 * form-submission controller
 *
 * All four public lead forms (contact / became-dealer / newsletter / electrician)
 * ran as four ~70-line copies of the same routine. They were byte-identical
 * apart from three knobs, which is how the electrician handler silently drifted
 * (its own decrypt loop, and PII that never reached the encryption change).
 *
 * `handleFormSubmission` is now the single implementation; each exported action
 * supplies its config. Add a new lead form by adding a config, not a copy.
 */


const PII_KEYS = new Set(['email', 'mobile', 'number', 'name']);
// Fallback recipients when the page single type has no `emails` set.
const DEFAULT_NOTIFY_EMAIL = process.env.FORM_NOTIFY_EMAIL || '';

/**
 * Decrypt the RSA-encrypted PII fields of a payload, passing everything else
 * through untouched.
 *
 * `lenient` controls what happens when a value will not decrypt:
 *   - false (contact / dealer / newsletter): the value becomes null, so an
 *     unencrypted or corrupt field fails validation.
 *   - true  (electrician): the original value is kept, so a payload that
 *     arrived unencrypted still reaches validation.
 *
 * This difference is pre-existing behaviour and is preserved deliberately —
 * changing it would alter what each live endpoint accepts.
 *
 * @param {Record<string, unknown>} formData
 * @param {boolean} lenient
 * @returns {Record<string, unknown>}
 */
function decryptPiiFields(formData, lenient) {
  const out = {};
  for (const key in formData) {
    if (!PII_KEYS.has(key)) {
      out[key] = formData[key];
      continue;
    }
    const decrypted = decrptRsa(formData[key]);
    if (lenient) {
      out[key] = (decrypted != null && decrypted !== '') ? decrypted : formData[key];
    } else {
      out[key] = decrypted;
    }
  }
  return out;
}

/**
 * Shared implementation for every public lead form.
 *
 * Flow: verify CSRF -> issue replacement token -> parse payload -> decrypt PII
 * -> load the page single-type for its form schema and notification emails ->
 * validate against that schema -> store.
 *
 * Every response carries a fresh `token`, because the CSRF token is single-use:
 * `isTokenValid()` deletes it, so a client that does not take the replacement
 * cannot submit again.
 *
 * @param {object} ctx                Koa context
 * @param {object} cfg
 * @param {string} cfg.singleTypeUid  page single-type holding form_schema + emails
 * @param {string} cfg.storeFn        method name on api::form-submission.form-submission
 * @param {boolean} [cfg.lenientDecrypt=false]
 */
async function handleFormSubmission(ctx, { singleTypeUid, storeFn, lenientDecrypt = false }) {
  const csrfService = strapi.service('api::csrf-token.csrf-token');
  const formService = strapi.service('api::form-submission.form-submission');

  try {
    const { data: jsonStringFormData, token } = ctx.request.body;

    const tokenStatus = await csrfService.isTokenValid(token);
    const newToken = await csrfService.tokenCreation();
    if (!tokenStatus.status) {
      ctx.status = 400;
      return { status: false, "message": "Session has been expired.", token: newToken?.token }
    }

    let formData;
    try {
      formData = JSON.parse(jsonStringFormData);
    } catch (error) {
      console.log(error);
      ctx.status = 400;
      return { status: false, "message": "Invalid request.", token: newToken?.token, "error_message": error.message, }
    }

    const decrptedFormData = decryptPiiFields(formData, lenientDecrypt);
    if (decrptedFormData.mobile == null && decrptedFormData.number != null) {
      decrptedFormData.mobile = decrptedFormData.number;
    }

    const singleTypeData = await strapi.service(singleTypeUid).find();
    if (!singleTypeData) {
      ctx.status = 400;
      return { status: false, "message": "Invalid request.", token: newToken?.token }
    }

    const form_schema = singleTypeData?.form_schema ?? {};
    if (form_schema && Object.keys(form_schema).length == 0) {
      ctx.status = 500;
      return { status: false, "message": "Internal server issue.", "error": "Form schema is empty.", token: newToken?.token }
    }

    if (form_schema && Object.keys(form_schema).length > 0) {
      // dynamic validation using yup, driven by the page's form_schema
      const validateForm = await formService.validateForm(ctx, decrptedFormData, form_schema);
      if (!(validateForm?.status ?? false)) {
        ctx.status = 400;
        return { ...validateForm, token: newToken?.token }
      }
    }


    // After validation passes, sanitize the data for safe storage
    const sanitizedFormData = sanitizeDeep(decrptedFormData);
    const emails = (singleTypeData?.emails ?? DEFAULT_NOTIFY_EMAIL);

    const result = await formService[storeFn](formData, sanitizedFormData, emails ?? '');
    if (!(result?.status ?? false)) {
      ctx.status = 500;
      return { status: false, "message": "Internal server issue.", "error": result?.error, token: newToken?.token }
    }

    ctx.status = 200;
    return { status: true, message: "Submitted successfully", token: newToken?.token }
  } catch (err) {
    console.log(err);
    ctx.status = 500;
    const newToken = csrfService.tokenCreation();
    return { status: false, "message": "Internal server issue.", "error_message": err.message, token: newToken?.token }
  }
}

module.exports = {
  /**
   * Contact form submission
   */
  async contactFormSubmission(ctx) {
    return handleFormSubmission(ctx, {
      singleTypeUid: 'api::contact-page.contact-page',
      storeFn: 'storeContactForm',
    });
  },

};
