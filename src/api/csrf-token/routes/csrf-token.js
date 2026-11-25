module.exports = {
    routes: [
        {
            method: "POST",
            path: "/csrf-token",
            handler: "csrf-token.generateToken",
            config: {
                policies: [],
                middlewares: [],
            },
        },
    ],
};