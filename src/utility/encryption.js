"use strict";
const forge = require("node-forge");
const crypto = require("crypto");

function generateHash(data) {
    if (!data) {
        return null;
    }
    return crypto.createHash("sha256").update(data).digest("hex");
}



/**
 * Decrypts data that was encrypted using the corresponding public key.
 *
 * @param {string} encrptedData - The data to decrypt.
 * @returns {string|null} The decrypted data, or null if decryption fails.
 */
function decrptRsa(encrptedData) {
    if (encrptedData == null) {
        return null;
    }
    const privateKey = process.env.TOKEN_PRIVATE_FORM;
    const privateKeyForge = forge.pki.privateKeyFromPem(privateKey);
    try {
        const decryptedValue = privateKeyForge.decrypt(
            forge.util.decode64(encrptedData),
            'RSA-OAEP',
            {
                md: forge.md.sha256.create(),
                mgf1: { md: forge.md.sha256.create() },
            }
        );
        return decryptedValue;
    } catch (error) {
        console.error("Error decrypting data:", error);
        return null;
    }
}
/**
 * Ecrypts data using the corresponding public key.
 *
 * @param {string} data - The data to encrypt.
 * @returns {string|null} The encrypted data, or null if encryption fails.
 */
function encryptRsa(data) {
    if (data == null || data == undefined || data == "") {
        return null;
    }
    const publicKey = process.env.TOKEN_PUBLIC_FORM;
    const publicKeyForge = forge.pki.publicKeyFromPem(publicKey);
    try {
        const encryptedValue = publicKeyForge.encrypt(data, 'RSA-OAEP', {
            md: forge.md.sha256.create(),
            mgf1: { md: forge.md.sha256.create() },
        });
        return forge.util.encode64(encryptedValue);
    } catch (error) {
        console.error("Error encrypting data:", error);
        return null;
    }
}

module.exports = {
    encryptRsa,
    decrptRsa,
    generateHash
}


