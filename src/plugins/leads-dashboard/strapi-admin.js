import { ChartPie } from '@strapi/icons';
import dashboardPermissions from './admin/src/permissions.js';

export default {
  register(app) {
    app.addMenuLink({
      to: `/plugins/leads-dashboard`,
      icon: ChartPie,
      intlLabel: {
        id: 'leads-dashboard.plugin.name',
        defaultMessage: 'Leads Dashboard',
      },
      Component: () => import('./admin/src/pages/Dashboard.jsx'),
      permissions: dashboardPermissions.access,
    });

    app.registerPlugin({
      id: 'leads-dashboard',
      name: 'leads-dashboard',
    });
  },
  bootstrap() {},
  registerTrads({ locales }) {
    return [];
  },
};
