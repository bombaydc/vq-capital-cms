'use strict';

// Shared memory flag allocated once at process start.
// 1 = worker completed a sync, cron should run CloudFront invalidation
// 0 = no pending update
const sharedBuffer = new SharedArrayBuffer(1);
const syncFlag = new Int8Array(sharedBuffer);

// Accumulates UIDs of content types that changed since last cron flush
const changedUids = new Set();

module.exports = { sharedBuffer, syncFlag, changedUids };
