'use strict';

module.exports = ({ strapi }) => {
  strapi.admin.services.permission.actionProvider.registerMany([
    {
      section: 'plugins',
      displayName: 'Access Leads Dashboard',
      uid: 'access',
      pluginName: 'leads-dashboard',
    },
    {
      section: 'plugins',
      displayName: 'Export Leads Excel',
      uid: 'export',
      pluginName: 'leads-dashboard',
    },
  ]);
};
