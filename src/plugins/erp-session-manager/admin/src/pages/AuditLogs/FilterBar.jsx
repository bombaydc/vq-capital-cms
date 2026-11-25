import { useState } from 'react';
import {
  Box, Flex, Button, TextInput, SingleSelect, SingleSelectOption, Tag, Typography,
} from '@strapi/design-system';
import { Search, ArrowDown, Cross } from '@strapi/icons';

const EVENT_TYPES = [
  'LOGIN_SUCCESS','LOGIN_FAILURE','LOGOUT','TOKEN_REFRESH',
  'SESSION_EXPIRED','SESSION_EVICTED','SESSION_REVOKED',
  'TOKEN_REUSE_ATTEMPT','REVOKED_TOKEN_USE',
  'ANOMALY_IP_CHANGE','ANOMALY_UA_CHANGE','ANOMALY_IMPOSSIBLE_TRAVEL',
  'LOGIN_REJECTED_CONCURRENT_LIMIT','PASSWORD_CHANGED','PASSWORD_REJECTED',
];

const FilterBar = ({ onFilterChange, onExportCsv }) => {
  const [draft, setDraft] = useState({ eventTypes: [], email: '', ip: '', outcome: 'all', from: '', to: '' });

  const set = (field, value) => setDraft(prev => ({ ...prev, [field]: value }));

  const toggleEventType = (et) => {
    setDraft(prev => {
      const current = prev.eventTypes || [];
      const next = current.includes(et) ? current.filter(t => t !== et) : [...current, et];
      return { ...prev, eventTypes: next };
    });
  };

  const removeEventType = (et) => {
    setDraft(prev => ({ ...prev, eventTypes: prev.eventTypes.filter(t => t !== et) }));
  };

  const handleApply = () => onFilterChange?.(draft);

  const handleClear = () => {
    const cleared = { eventTypes: [], email: '', ip: '', outcome: 'all', from: '', to: '' };
    setDraft(cleared);
    onFilterChange?.(cleared);
  };

  return (
    <Box background="neutral0" borderRadius="4px" padding={5} shadow="filterShadow" marginBottom={4}>
      {/* Event type tags */}
      {draft.eventTypes.length > 0 && (
        <Flex gap={2} wrap="wrap" marginBottom={3}>
          {draft.eventTypes.map(et => (
            <Tag
              key={et}
              icon={<Cross />}
              onClick={() => removeEventType(et)}
            >
              {et}
            </Tag>
          ))}
        </Flex>
      )}

      {/* Event type selector */}
      <Box marginBottom={3} maxWidth="300px">
        <SingleSelect
          label="Add Event Type Filter"
          placeholder="Select event type…"
          value=""
          onChange={toggleEventType}
        >
          {EVENT_TYPES.map(et => (
            <SingleSelectOption key={et} value={et}>{et}</SingleSelectOption>
          ))}
        </SingleSelect>
      </Box>

      <Flex gap={4} wrap="wrap" alignItems="flex-end">
        <Box flex="1" minWidth="180px">
          <TextInput
            label="Email"
            placeholder="user@example.com"
            value={draft.email}
            onChange={e => set('email', e.target.value)}
            startAction={<Search fill="neutral500" />}
          />
        </Box>

        <Box flex="1" minWidth="160px">
          <TextInput
            label="IP Address"
            placeholder="e.g. 10.0.0.1"
            value={draft.ip}
            onChange={e => set('ip', e.target.value)}
          />
        </Box>

        <Box flex="1" minWidth="160px">
          <SingleSelect
            label="Outcome"
            value={draft.outcome}
            onChange={v => set('outcome', v)}
          >
            <SingleSelectOption value="all">All</SingleSelectOption>
            <SingleSelectOption value="SUCCESS">SUCCESS</SingleSelectOption>
            <SingleSelectOption value="FAILURE">FAILURE</SingleSelectOption>
          </SingleSelect>
        </Box>

        <Box flex="1" minWidth="160px">
          <TextInput label="From" type="date" value={draft.from} onChange={e => set('from', e.target.value)} />
        </Box>

        <Box flex="1" minWidth="160px">
          <TextInput label="To" type="date" value={draft.to} onChange={e => set('to', e.target.value)} />
        </Box>

        <Flex gap={2} alignItems="flex-end" paddingBottom={1}>
          <Button onClick={handleApply} startIcon={<Search />}>Apply</Button>
          <Button variant="tertiary" onClick={handleClear}>Clear</Button>
          <Button variant="secondary" startIcon={<ArrowDown />} onClick={onExportCsv}>Export CSV</Button>
        </Flex>
      </Flex>
    </Box>
  );
};

export default FilterBar;
