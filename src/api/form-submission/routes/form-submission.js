'use strict';

/**
 * form-submission router
 *
 * Add a new public form by adding a route here, a config entry in the
 * controller and a store function in the service.
 */

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/contact-form-submission',
      handler: 'form-submission.contactFormSubmission',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
