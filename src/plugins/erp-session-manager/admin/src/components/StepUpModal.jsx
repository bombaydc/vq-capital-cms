/**
 * StepUpModal — reusable TOTP challenge modal for step-up authenticated actions (G21).
 *
 * Props:
 *   isOpen       — controls visibility
 *   onClose()    — called when the user cancels
 *   onSuccess(token) — called with the step-up token on successful challenge
 *   actionLabel  — human-readable description shown in the modal
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  Button, TextInput, Alert, Typography, Flex, Box,
} from '@strapi/design-system';
import { useApiClient } from '../api/client.js';

const StepUpModal = ({ isOpen, onClose, onSuccess, actionLabel = 'this action' }) => {
  const [code, setCode]       = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const client = useApiClient();

  // Reset state when the modal opens
  useEffect(() => {
    if (isOpen) {
      setCode('');
      setError('');
      setLoading(false);
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (code.length < 6) {
      setError('Please enter a 6-digit TOTP code.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await client.challengeStepUp(code);
      const token = data?.data?.token || data?.token;
      if (!token) throw new Error('No step-up token returned.');
      onSuccess(token);
    } catch (err) {
      const msg = err?.response?.data?.error?.message || err.message || 'Verification failed.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content>
        <Dialog.Header>{`Verify identity to ${actionLabel}`}</Dialog.Header>
        <Dialog.Body>
          <Flex direction="column" gap={4}>
            <Typography variant="omega">
              Enter the 6-digit code from your authenticator app to continue.
            </Typography>
            {error && (
              <Alert variant="danger" title="Verification failed" closeLabel="Dismiss" onClose={() => setError('')}>
                {error}
              </Alert>
            )}
            <TextInput
              label="TOTP Code"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength={6}
              autoComplete="one-time-code"
              inputMode="numeric"
            />
          </Flex>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="tertiary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} loading={loading} disabled={code.length < 6}>
            Verify
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
};

export default StepUpModal;
