'use strict';

const bootstrap = require('./server/src/bootstrap');
const controllers = require('./server/src/controllers');
const services = require('./server/src/services');
const routes = require('./server/src/routes');

module.exports = () => ({
  bootstrap,
  controllers,
  services,
  routes,
});
