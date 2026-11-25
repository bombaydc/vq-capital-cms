'use strict';

/**
 * Email template utility for formatting form data
 * @module email-template
 */

const generateEmailTemplate = (data, templateType = 'default') => {
    const templates = {
        default: generateDefaultTemplate,
        inquire: generateInquireTemplate,
        contact: generateContactTemplate,
        refer_a_friend: generateReferAFriendTemplate,
    };

    const template = templates[templateType] || templates.default;
    return template(data);
};

const generateDefaultTemplate = (data) => {
    const formattedData = formatFormData(data);

    return `
    <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
    <html xmlns="http://www.w3.org/1999/xhtml" lang="en">
    <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <meta name="color-scheme" content="light dark"/>
        <meta name="supported-color-schemes" content="light dark"/>
        <title>New Form Submission</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, Arial, sans-serif; background-color: #f8f9fa; color: #212529; line-height: 1.6;">
        <div role="main" style="width: 100%; background-color: #f8f9fa;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                <tr>
                    <td align="center" style="padding: 40px 20px;">
                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #e9ecef; border-collapse: collapse;">
                            <tr>
                                <td style="background-color: #6c5ce7; color: #ffffff; padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
                                    <h1 style="margin: 0 0 8px 0; font-size: 28px; font-weight: 600; letter-spacing: -0.5px;">New Form Submission</h1>
                                    <p style="margin: 0; font-size: 16px; opacity: 0.9;">Received on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 32px 24px;">
                                    <div role="region" aria-label="Form submission details">
                                        ${formattedData}
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 24px; border-top: 1px solid #e9ecef; background-color: #f8f9fa; border-radius: 0 0 12px 12px; text-align: center;">
                                    <p style="margin: 0; font-size: 14px; color: #6c757d;">This email was automatically generated from your website form submission.</p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </div>
    </body>
    </html>`;
};

const generateContactTemplate = (data) => {
    return `
    <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
    <html xmlns="http://www.w3.org/1999/xhtml" lang="en">
    <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <meta name="color-scheme" content="light dark"/>
        <title>Contact Form Submission</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, Arial, sans-serif; background-color: #f8f9fa; color: #212529; line-height: 1.6;">
        <div role="main" style="width: 100%; background-color: #f8f9fa;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                <tr>
                    <td align="center" style="padding: 40px 20px;">
                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #e9ecef; border-collapse: collapse;">
                            <tr>
                                <td style="background-color: #007bff; color: #ffffff; padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
                                    <h1 style="margin: 0 0 8px 0; font-size: 28px; font-weight: 600; letter-spacing: -0.5px;">📧 New Contact Request</h1>
                                    <p style="margin: 0; font-size: 16px; opacity: 0.9;">Someone has reached out through your contact form</p>
                                    <p style="margin: 0; font-size: 16px; opacity: 0.9;">Received on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 32px 24px;">
                                    <div role="region" aria-label="Contact form details">
                                        ${formatFormData(data)}
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 24px; border-top: 1px solid #e9ecef; background-color: #f8f9fa; border-radius: 0 0 12px 12px; text-align: center;">
                                    <p style="margin: 0; font-size: 14px; color: #6c757d;">This email was automatically generated from your website form submission.</p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </div>
    </body>
    </html>`;
};

const generateInquireTemplate = (data) => {
    return `
    <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
    <html xmlns="http://www.w3.org/1999/xhtml" lang="en">
    <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <meta name="color-scheme" content="light dark"/>
        <title>Contact Form Submission</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, Arial, sans-serif; background-color: #f8f9fa; color: #212529; line-height: 1.6;">
        <div role="main" style="width: 100%; background-color: #f8f9fa;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                <tr>
                    <td align="center" style="padding: 40px 20px;">
                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #e9ecef; border-collapse: collapse;">
                            <tr>
                                <td style="background-color: #007bff; color: #ffffff; padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
                                    <h1 style="margin: 0 0 8px 0; font-size: 28px; font-weight: 600; letter-spacing: -0.5px;">📧 New Inquire Request</h1>
                                    <p style="margin: 0; font-size: 16px; opacity: 0.9;">Someone has reached out through your inquire form</p>
                                    <p style="margin: 0; font-size: 16px; opacity: 0.9;">Received on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 32px 24px;">
                                    <div role="region" aria-label="Contact form details">
                                        ${formatFormData(data)}
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 24px; border-top: 1px solid #e9ecef; background-color: #f8f9fa; border-radius: 0 0 12px 12px; text-align: center;">
                                    <p style="margin: 0; font-size: 14px; color: #6c757d;">This email was automatically generated from your website form submission.</p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </div>
    </body>
    </html>`;
};

const generateReferAFriendTemplate = (data) => {
    return `
    <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
    <html xmlns="http://www.w3.org/1999/xhtml" lang="en">
    <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <meta name="color-scheme" content="light dark"/>
        <title>Contact Form Submission</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, Arial, sans-serif; background-color: #f8f9fa; color: #212529; line-height: 1.6;">
        <div role="main" style="width: 100%; background-color: #f8f9fa;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                <tr>
                    <td align="center" style="padding: 40px 20px;">
                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #e9ecef; border-collapse: collapse;">
                            <tr>
                                <td style="background-color: #007bff; color: #ffffff; padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
                                    <h1 style="margin: 0 0 8px 0; font-size: 28px; font-weight: 600; letter-spacing: -0.5px;">📧 New Refer a friend Request</h1>
                                    <p style="margin: 0; font-size: 16px; opacity: 0.9;">Someone has reached out through your refer a friend form</p>
                                    <p style="margin: 0; font-size: 16px; opacity: 0.9;">Received on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 32px 24px;">
                                    <div role="region" aria-label="Contact form details">
                                        ${formatFormData(data)}
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 24px; border-top: 1px solid #e9ecef; background-color: #f8f9fa; border-radius: 0 0 12px 12px; text-align: center;">
                                    <p style="margin: 0; font-size: 14px; color: #6c757d;">This email was automatically generated from your website form submission.</p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </div>
    </body>
    </html>`
}




const formatFormData = (formData) => {
    let result = '';

    for (const [key, value] of Object.entries(formData)) {
        if (!value || (Array.isArray(value) && value.length === 0)) {
            continue; // Skip empty values
        };

        const label = formatLabel(key);
        const formattedValue = formatValue(value, key);

        result += `
        <div style="margin: 0 0 16px 0; padding: 16px; background-color: #f8f9fa; border-radius: 8px; border-left: 4px solid #007bff;">
            <div style="font-size: 14px; font-weight: 600; color: #495057; margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.5px;">${label}</div>
            <div style="font-size: 16px; color: #212529; word-wrap: break-word; line-height: 1.5;">${formattedValue}</div>
        </div>`;
    }

    return result;
};

const formatLabel = (key) => {
    // Handle special cases first
    const specialCases = {
        'pageURL': 'Page URL',
        'refererURL': 'Referer URL',
        'pageUrl': 'Page URL',
        'refererUrl': 'Referer URL',
        "isWhatsAppPreferred": 'Is WhatsApp Preferred'
    };

    if (specialCases[key]) {
        return specialCases[key];
    }

    return key
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, str => str.toUpperCase())
        .replace(/_/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase())
        .replace(/U R L/g, 'URL')
        .replace(/D O B/g, 'DOB');
};

const formatListValues = (list) => {
    if (list.length === 1) return list[0];
    if (list.length === 2) return `${list[0]} and ${list[1]}`;
    return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
};

const formatFriendsTable = (friends) => {
    let tableRows = '';
    for (const friend of friends) {
        tableRows += `
            <tr>
                <td style="font-size: 14px; color: #212529; border-top: 1px solid #dee2e6;">${friend.name || ''}</td>
                <td style="font-size: 14px; color: #212529; border-top: 1px solid #dee2e6;">${friend.email || ''}</td>
                <td style="font-size: 14px; color: #212529; border-top: 1px solid #dee2e6;">${friend?.mobile ? (friend.country_code ?? '') + ' ' + (friend.mobile ?? '') : ''}</td>
            </tr>
            `;
    }
    return `
        <table role="presentation" border="1" cellpadding="8" cellspacing="0" width="100%" style="border-collapse: collapse; border-color: #dee2e6;">
            <thead>
                <tr style="background-color: #f1f3f5;">
                    <th style="text-align: left; font-size: 14px; color: #495057;">Name</th>
                    <th style="text-align: left; font-size: 14px; color: #495057;">Email</th>
                    <th style="text-align: left; font-size: 14px; color: #495057;">Phone</th>
                </tr>
            </thead>
            <tbody>
                ${tableRows}
            </tbody>
        </table>
        `;
};

const formatValue = (value, key = '') => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value.toString();
    }

    const isFriendsKey = String(key).toLowerCase() === 'friends';

    if (value && isFriendsKey && Array.isArray(value)) {
        return formatFriendsTable(value);
    }

    if (Array.isArray(value)) {
        return formatListValues(value);
    }

    if (value && typeof value === 'object') {
        const values = Object.values(value).filter(Boolean);
        if (values.length === 0) return '';
        return formatListValues(values);
    }

    return '';
};

module.exports = {
    generateEmailTemplate,
    formatFormData
};