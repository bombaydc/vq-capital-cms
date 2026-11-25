import { Box, Flex, Typography } from '@strapi/design-system';
import { CheckCircle, WarningCircle, Clock } from '@strapi/icons';

const StatCard = ({ icon: Icon, iconColor, iconBg, count, label }) => (
  <Box
    background="neutral0"
    borderRadius="4px"
    padding={5}
    shadow="filterShadow"
    flex="1"
    minWidth="160px"
  >
    <Flex gap={4} alignItems="center">
      <Box
        background={iconBg}
        borderRadius="50%"
        padding={3}
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Icon width="20px" height="20px" fill={iconColor} />
      </Box>
      <Box>
        <Typography variant="alpha" as="p" textColor="neutral800">
          {count}
        </Typography>
        <Typography variant="pi" textColor="neutral500">
          {label}
        </Typography>
      </Box>
    </Flex>
  </Box>
);

const SummaryCards = ({ activeSessions = 0, anomalySessions = 0, expiringSessions = 0 }) => (
  <Flex gap={4} wrap="wrap" marginBottom={6}>
    <StatCard
      icon={CheckCircle}
      iconColor="success600"
      iconBg="success100"
      count={activeSessions}
      label="Active Sessions"
    />
    <StatCard
      icon={WarningCircle}
      iconColor="warning600"
      iconBg="warning100"
      count={anomalySessions}
      label="Anomaly Sessions"
    />
    <StatCard
      icon={Clock}
      iconColor="primary600"
      iconBg="primary100"
      count={expiringSessions}
      label="Expiring < 30 min"
    />
  </Flex>
);

export default SummaryCards;
