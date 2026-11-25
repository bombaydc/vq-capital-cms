"use strict";

/**
 * csrf-token service
 */

const jwt = require("jsonwebtoken");

async function checkCSRFTable() {
  const knex = strapi.db.connection;
  const exists = await knex.schema.hasTable("csrf_tokens");
  if (!exists) {
    return knex.schema.createTable("csrf_tokens", (table) => {
      table.increments("id").primary(); // Auto-incrementing ID
      table.text("token").notNullable(); // CSRF token
      table.datetime("expire_time").notNullable(); // Expiration time
      table.datetime("created_at").defaultTo(knex.fn.now()).notNullable(); // Created at timestamp
    });
  }
  return;
}
async function deleteTokenByToken(token) {
  await checkCSRFTable();
  const knex = strapi.db.connection;
  // also check token does not expire by expire_time
  return await knex("csrf_tokens").where("token", token.toString()).del();
}

module.exports = () => ({
  tokenCreation: async () => {
    try {
      const payload = {
        authenticated: true,
        dateTime: new Date(),
      };

      const knex = strapi.db.connection;

      const privateKey = process.env.TOKEN_PRIVATE.replace(/\\n/g, "\n");

      const token = jwt.sign(payload, privateKey, {
        expiresIn: "2m", // ideally should be 2-3 minutes only not more
        algorithm: "RS256",
      });

      const expireTime = new Date();
      // add time in expire time
      expireTime.setMinutes(expireTime.getMinutes() + 2);
      await checkCSRFTable();
      // .returning() so the result is an array on Postgres too (pg resolves a
      // bare insert to a result object, which would fail the length check).
      const entry = await knex("csrf_tokens")
        .insert({ token: token, expire_time: expireTime })
        .returning("id");
      // console.log("token stored: ", entry);
      if (entry?.length > 0) {
        return {
          status: true,
          token: token,
          message: "Token generate successfully.",
        };
      } else {
        return { status: false, message: "Issue in token management." };
      }
    } catch (err) {
      console.log(err);
      return {
        status: false,
        message: "Something went wrong. Please contact to IT support.",
      };
    }
  },

  async isTokenValid(token = "") {
    await checkCSRFTable();
    const knex = strapi.db.connection;
    // also check token does not expire by expire_time
    const check = await knex("csrf_tokens").where("token", token.toString());
    // check token exipre or not
    if (check.length > 0) {
      const expireTime = check[0].expire_time;
      const currentTime = new Date();
      // here exipreTime and currenttime
      if (expireTime < currentTime) {
        return { status: false, message: "Session has been expired." };
      } else {
        await deleteTokenByToken(token);
        return { status: true, message: "Session is valid." };
      }
    }
    return { status: false, message: "Session has been expired." };
  },

  async tokenDelete() {
    await checkCSRFTable();
    const knex = strapi.db.connection;
    // also check token does not expire by expire_time
    return await knex("csrf_tokens")
      .where("expire_time", "<=", new Date())
      .del();
  },
  deleteTokenByToken,
});
