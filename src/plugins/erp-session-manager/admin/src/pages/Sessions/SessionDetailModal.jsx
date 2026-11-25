import { useEffect, useCallback } from 'react';
import {
  Modal, Box, Flex, Typography, Button, Badge, Divider,
} from '@strapi/design-system';
import { Trash } from '@strapi/icons';

const formatDate = (ts) => {
  if (!ts) return '—';
  try { return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'; } catch { return String(ts); }
};

const getStatus = (session) => {
  if (!session) return 'unknown';
  if (session.isRevoked) return 'Revoked';
  if (session.anomalyFlags?.length) return 'Anomaly';
  const now = Date.now();
  if (session.expiresAt && session.expiresAt - now < 30 * 60 * 1000) return 'Expiring Soon';
  return 'Active';
};

const Row = ({ label, value }) => (
  <Flex gap={4} paddingTop={2} paddingBottom={2}>
    <Box minWidth="140px" flexShrink={0}>
      <Typography variant="sigma" textColor="neutral500">{label}</Typography>
    </Box>
    <Typography variant="omega" textColor="neutral800" style={{ wordBreak: 'break-all' }}>
      {value || '—'}
    </Typography>
  </Flex>
);

const SectionTitle = ({ children }) => (
  <Box marginTop={4} marginBottom={1}>
    <Typography variant="sigma" textColor="neutral500" textTransform="uppercase">
      {children}
    </Typography>
    <Divider marginTop={2} />
  </Box>
);

const SessionDetailModal = ({ session, isOpen, onClose, onRevoke }) => {
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose?.();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen || !session) return null;

  const status = getStatus(session);
  const location = session.geoLocation
    ? [session.geoLocation.city, session.geoLocation.country].filter(Boolean).join(', ') || 'Unknown'
    : 'Unknown';

  return (
    <Modal.Root open={isOpen} onOpenChange={onClose}>
      <Modal.Content>
        <Modal.Header>
          <Typography variant="beta" as="h2">Session Details</Typography>
        </Modal.Header>

        <Modal.Body>
          <Box>
            <SectionTitle>Identity</SectionTitle>
            <Row label="User" value={session.userEmail || `User #${session.userId}`} />
            <Row label="Session ID" value={session.sessionId} />
            <Row label="Status" value={status} />

            <SectionTitle>Network</SectionTitle>
            <Row label="IP Address" value={session.ipAddress} />
            <Row label="Location" value={location} />
            <Row label="User-Agent" value={session.userAgent} />
            {session.deviceId && <Row label="Device ID" value={session.deviceId} />}

            <SectionTitle>Timestamps</SectionTitle>
            <Row label="Login Time" value={formatDate(session.issuedAt)} />
            <Row label="Last Active" value={formatDate(session.lastActive)} />
            <Row label="Expires At" value={formatDate(session.expiresAt)} />

            {session.anomalyFlags?.length > 0 && (
              <Box>
                <SectionTitle>Anomaly Flags</SectionTitle>
                <Flex gap={2} wrap="wrap" marginTop={2}>
                  {session.anomalyFlags.map(flag => (
                    <Badge key={flag} backgroundColor="warning100" textColor="warning700">
                      {flag}
                    </Badge>
                  ))}
                </Flex>
              </Box>
            )}
          </Box>
        </Modal.Body>

        {/* Footer: single Flex child to avoid onlyChild error */}
        <Modal.Footer>
          <Flex gap={2} justifyContent="flex-end" width="100%">
            <Modal.Close>
              <Button variant="tertiary">Cancel</Button>
            </Modal.Close>
            {!session.isRevoked && (
              <Button
                variant="danger"
                startIcon={<Trash />}
                onClick={() => { onRevoke?.(session.sessionId); onClose?.(); }}
              >
                Revoke Session
              </Button>
            )}
          </Flex>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default SessionDetailModal;
