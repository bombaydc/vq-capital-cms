"use strict";

/**
 * A set of functions called "actions" for `csrf-token`
 */

module.exports = {
    generateToken: async (ctx) => {
        try {
            const formBody = ctx.request.body;

            if (Object.keys(formBody).length != 0) {
                const response = await strapi
                    .service("api::csrf-token.csrf-token")
                    .tokenCreation();
                // console.log("response", response);
                return ctx.send(response);
            } else {
                return { status: false, message: "payload should have value" };
            }
        } catch (err) {
            return ctx.badRequest("Unable to generate csrf token", { moreDetails: err });
        }
    },
};