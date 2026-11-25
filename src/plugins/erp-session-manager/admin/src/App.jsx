import { Routes, Route, NavLink } from 'react-router-dom';
import { Box, Flex, Typography } from '@strapi/design-system';
import { Shield } from '@strapi/icons';
import { useAuth } from '@strapi/strapi/admin';

import SessionsPage from './pages/Sessions/index.jsx';
import AuditLogsPage from './pages/AuditLogs/index.jsx';
import SettingsPage from './pages/Settings/index.jsx';
import ActivityLogPage from './pages/ActivityLog/index.jsx';

const PLUGIN_ID = 'erp-session-manager';

/**
 * Returns true if the current admin user holds the Super Admin role.
 * Strapi Super Admins have role.code === 'strapi-super-admin'.
 */
function isSuperAdmin(user) {
  if (!user) return false;
  const roles = user.roles || [];
  return roles.some((r) => r.code === 'strapi-super-admin');
}

/**
 * Tab link styled to match Strapi's design system tab appearance.
 * Uses CSS custom properties so it automatically adapts to light/dark theme.
 */
const TabLink = ({ to, end, children }) => (
  <NavLink
    to={to}
    end={end}
    style={({ isActive }) => ({
      display: 'inline-block',
      padding: '0.75rem 1.25rem',
      textDecoration: 'none',
      fontSize: '0.875rem',
      fontWeight: isActive ? '600' : '400',
      color: isActive ? 'var(--strapi-primary-600, #4945ff)' : 'var(--strapi-neutral-600, #666687)',
      borderBottom: isActive
        ? '2px solid var(--strapi-primary-600, #4945ff)'
        : '2px solid transparent',
      marginBottom: '-2px',
      transition: 'color 0.1s, border-color 0.1s',
    })}
  >
    {children}
  </NavLink>
);

const App = () => {
  // Guard: check the current user's role directly.
  // useAuth provides the authenticated admin user object including their roles.
  // This is reliable because Super Admins always have role.code === 'strapi-super-admin',
  // unlike custom permissions which require server-side registration to work.
  const { user } = useAuth('ErpSessionManager', (auth) => auth);

  if (!user) {
    return (
      <Box padding={10}>
        <Typography textColor="neutral500">Loading…</Typography>
      </Box>
    );
  }

  if (!isSuperAdmin(user)) {
    return (
      <Box padding={10}>
        <Flex direction="column" gap={4} alignItems="flex-start">
          <Typography variant="alpha" as="h1" textColor="danger600">
            Access Denied
          </Typography>
          <Typography textColor="neutral500">
            You do not have permission to access the ERP Session Manager.
            This area is restricted to Super Administrators only.
          </Typography>
        </Flex>
      </Box>
    );
  }

  return (
    <Box background="neutral100" minHeight="100vh">
      {/* Page header */}
      <Box
        background="neutral0"
        borderColor="neutral150"
        borderStyle="solid"
        borderWidth="0 0 1px 0"
        paddingTop={6}
        paddingBottom={0}
        paddingLeft={10}
        paddingRight={10}
        shadow="filterShadow"
      >
        {/* Title row */}
        <Flex gap={3} alignItems="center" paddingBottom={4}>
          <Box
            background="primary100"
            borderRadius="50%"
            padding={2}
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <Shield width="20px" height="20px" fill="primary600" />
          </Box>
          <Box>
            <Typography variant="alpha" as="h1">
              ERP Session Manager
            </Typography>
            <Typography variant="epsilon" textColor="neutral500">
              Monitor and manage user sessions, audit logs, and security settings
            </Typography>
          </Box>
        </Flex>

        {/* Tab navigation */}
        <Box
          borderColor="neutral150"
          borderStyle="solid"
          borderWidth="0 0 2px 0"
          display="flex"
          gap={0}
        >
          <TabLink to={`/plugins/${PLUGIN_ID}`} end>Sessions</TabLink>
          <TabLink to={`/plugins/${PLUGIN_ID}/audit-logs`}>Audit Logs</TabLink>
          <TabLink to={`/plugins/${PLUGIN_ID}/activity-log`}>Activity Log</TabLink>
          <TabLink to={`/plugins/${PLUGIN_ID}/settings`}>Settings</TabLink>
        </Box>
      </Box>

      {/* Page content */}
      <Box padding={10}>
        <Routes>
          <Route index element={<SessionsPage />} />
          <Route path="audit-logs" element={<AuditLogsPage />} />
          <Route path="activity-log" element={<ActivityLogPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Routes>
      </Box>
    </Box>
  );
};

export default App;
