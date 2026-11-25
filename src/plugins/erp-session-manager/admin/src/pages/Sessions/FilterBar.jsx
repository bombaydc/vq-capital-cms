import { useState } from 'react';
import {
  Box, Flex, Button, TextInput, SingleSelect, SingleSelectOption, Typography,
} from '@strapi/design-system';
import { Search } from '@strapi/icons';

const FilterBar = ({ onFilterChange, onAutoRefreshChange }) => {
  const [draft, setDraft] = useState({ email: '', ip: '', status: 'all', from: '', to: '' });
  const [autoRefresh, setAutoRefresh] = useState(false);

  const set = (field, value) => setDraft(prev => ({ ...prev, [field]: value }));

  const handleApply = () => onFilterChange?.(draft);

  const handleClear = () => {
    const cleared = { email: '', ip: '', status: 'all', from: '', to: '' };
    setDraft(cleared);
    onFilterChange?.(cleared);
  };

  const handleAutoRefresh = () => {
    const next = !autoRefresh;
    setAutoRefresh(next);
    onAutoRefreshChange?.(next);
  };

  return (
    <Box
      background="neutral0"
      borderRadius="4px"
      padding={5}
      shadow="filterShadow"
      marginBottom={4}
    >
      <Flex gap={4} wrap="wrap" alignItems="flex-end">
        <Box flex="1" minWidth="180px">
          <TextInput
            label="Email"
            placeholder="user@example.com"
            value={draft.email}
            onChange={e => set('email', e.target.value)}
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
            label="Status"
            value={draft.status}
            onChange={value => set('status', value)}
          >
            <SingleSelectOption value="all">All</SingleSelectOption>
            <SingleSelectOption value="active">Active</SingleSelectOption>
            <SingleSelectOption value="anomaly">Anomaly</SingleSelectOption>
            <SingleSelectOption value="expiring">Expiring Soon</SingleSelectOption>
          </SingleSelect>
        </Box>

        <Box flex="1" minWidth="160px">
          <TextInput
            label="Login From"
            type="date"
            value={draft.from}
            onChange={e => set('from', e.target.value)}
          />
        </Box>

        <Box flex="1" minWidth="160px">
          <TextInput
            label="Login To"
            type="date"
            value={draft.to}
            onChange={e => set('to', e.target.value)}
          />
        </Box>

        <Flex gap={2} alignItems="flex-end" paddingBottom={1}>
          <Button onClick={handleApply} startIcon={<Search />}>
            Apply
          </Button>
          <Button variant="tertiary" onClick={handleClear}>
            Clear
          </Button>
        </Flex>

        {/* Auto-refresh toggle — plain label+checkbox to avoid onlyChild issues with Switch */}
        <Flex
          gap={2}
          alignItems="center"
          paddingBottom={1}
          style={{ cursor: 'pointer' }}
          onClick={handleAutoRefresh}
        >
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={handleAutoRefresh}
            id="auto-refresh-toggle"
            style={{ cursor: 'pointer', width: '16px', height: '16px' }}
          />
          <label htmlFor="auto-refresh-toggle" style={{ cursor: 'pointer' }}>
            <Typography variant="omega" textColor="neutral600">
              Auto-refresh (30s)
            </Typography>
          </label>
        </Flex>
      </Flex>
    </Box>
  );
};

export default FilterBar;
