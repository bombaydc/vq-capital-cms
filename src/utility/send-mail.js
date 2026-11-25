
'use strict';

const { generateEmailTemplate } = require('./email-template');

/**
 * Utility function to send email using Strapi email plugin
 * @module send-mail
 */

module.exports = {
    /**
     * Send an email using the email plugin
     * @param {Object} options - Email options
     * @param {string} options.to - The recipient's email address
     * @param {string} options.subject - The email subject
     * @param {string} options.template - Template type (default, contact, donation, volunteer)
     * @param {string} options.html - Custom HTML content (optional)
     * @param {string} options.cc - CC email address (optional)
     * @param {Object} data - Form data to be formatted
     * @param {string} mode - Email mode (internal/external)
     * 
     * @returns {Promise<void>}
     */
    sendMail: async (options, data, mode = 'internal') => {
        // check env to enable send mail
        const enableEmail = (process?.env?.ENABLE_EMAIL || "OFF") === 'ON';
        console.log("Email sending enabled:", enableEmail, process?.env?.ENABLE_EMAIL);
        if (!enableEmail) {
            console.log("Email sending is disabled via environment settings.");
            return;
        }
        try {
            const templateType = options.template || 'default';
            const emailHtml = options.html || generateEmailTemplate(data, templateType);

            const defaultOptions = {
                to: options.to,
                from: process.env.FROM_EMAIL || process.env.EMAIL_FROM || '',
                subject: options.subject,
                html: emailHtml,
                cc: options.cc || undefined,
            }
            // cc and bcc can be added here in future if required
            // email debugging can be done here using env variables
            const internalEmail = process.env.INTERNAL_EMAIL || null;
            // added internal email in cc or bcc based on requirement
            if (internalEmail) {
                // options.cc = internalEmail; // uncomment this line to add internal email in cc
                defaultOptions.bcc = internalEmail; // uncomment this line to add internal email in bcc
            }

            await strapi.plugin('email').service('email').send(defaultOptions);
            //strapi.log.info(`Email sent ${JSON.stringify(defaultOptions)}`);
            //console.log(`Email sent`);
        } catch (error) {
            //console.error("Error sending email:", error);
            strapi.log.error(`Error sending email: ${error}`);
        }
    }
}