import { Box, Flex, TextInput, SingleSelect, SingleSelectOption, Button } from '@strapi/design-system';

const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const FilterBar = ({ filters, onChange, onReset }) => {
  const handleChange = (key, value) => onChange({ ...filters, [key]: value });

  return (
    <Box padding={4} background="neutral100" borderRadius="4px">
      <Flex gap={3} wrap="wrap" alignItems="flex-end">
        <Box>
          <TextInput
            label="Session ID"
            placeholder="Filter by session ID"
            value={filters.sessionId || ''}
            onChange={(e) => handleChange('sessionId', e.target.value)}
            size="S"
          />
        </Box>
        <Box>
          <TextInput
            label="User ID"
            placeholder="Filter by user ID"
            value={filters.userId || ''}
            onChange={(e) => handleChange('userId', e.target.value)}
            size="S"
            type="number"
          />
        </Box>
        <Box minWidth="140px">
          <SingleSelect
            label="Method"
            placeholder="All methods"
            value={filters.method || ''}
            onChange={(v) => handleChange('method', v)}
            size="S"
          >
            <SingleSelectOption value="">All methods</SingleSelectOption>
            {METHOD_OPTIONS.map((m) => (
              <SingleSelectOption key={m} value={m}>{m}</SingleSelectOption>
            ))}
          </SingleSelect>
        </Box>
        <Box>
          <Button variant="tertiary" size="S" onClick={onReset}>
            Reset
          </Button>
        </Box>
      </Flex>
    </Box>
  );
};

export default FilterBar;
