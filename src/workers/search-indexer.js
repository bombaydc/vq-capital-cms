'use strict';
const { optionalRequire, isTrue } = require('../utils/optional-deps'); // on-demand SDKs — see src/utils/optional-deps.js

const { parentPort, workerData } = require('worker_threads');
const indexableContentTypes = require('../search-utility/priority-map');

// Set environment variables from workerData
if (workerData?.env) {
    Object.assign(process.env, workerData.env);
}

// Shared sync flag — set to 1 after a successful sync so the cron task can apply cache-control headers
const syncFlag = workerData?.sharedBuffer ? new Int8Array(workerData.sharedBuffer) : null;




/**
 * Search Indexer Worker
 * This file runs in a separate thread.
 * CRITICAL: The global 'strapi' object is NOT available here.
 * * You should use this for:
 * 1. Heavy data transformation (CPU intensive tasks)
 * 2. External API calls (Algolia, Elasticsearch, external db etc.)
 * 3. Independent DB operations (using a separate Knex connection if needed)
 */


const parseDate = (dateStr) => (dateStr ? new Date(dateStr) : null);


parentPort.on('message', async (task) => {
    try {


        // check task datatype
        if (typeof task !== 'object' || task === null) {
            throw new Error('Invalid task format');
        }
        // const { action, modelName, data, params } = task;
        // Simulate heavy processing or network delay
        // console.log(`[Worker] Processing ${action} for ${modelName} on thread ${threadId}`);

        await performSyncMeiliSearch(task);

        // Signal main thread that a sync completed — cron will apply cache-control headers
        if (syncFlag) {
            syncFlag[0] = 1;
            console.log('[Search Worker] Sync flag set to 1 — cache-control update pending');
        }

        // Notify main thread of success
        parentPort.postMessage({ status: 'success', documentId: task.data?.documentId, model: task.modelName });
    } catch (error) {
        // Send error back to main thread to be logged by Strapi
        parentPort.postMessage({ status: 'error', error: error.message, model: task.modelName });
    }
});

async function performSyncMeiliSearch(task) {
    const { syncJSON } = require('./upload-s3');
    const uid = task?.modelName;
    const contentTypeData = await syncJSON(uid);
    console.log("uid: ", uid, " action: ", task.action);
    if (!contentTypeData.status || !contentTypeData.data) {
        throw new Error(`JSON sync failed for UID: ${uid} (${contentTypeData.message})`);
    }

    // MEILI_ENABLE arrives as a string ("false" is truthy) — parse it explicitly.
    const meiliEnabled = isTrue(process.env.MEILI_ENABLE);
    if (!meiliEnabled || !["publish", "unpublish"].includes(task.action)) {
        return;
    }

    const data = contentTypeData.data.data;
    const meiliIndexName = contentTypeData.fileName.replace('.json', '');
    try {
        const { MeiliSearch } = optionalRequire('meilisearch');
        const meiliClient = new MeiliSearch({
            host: process.env.MEILI_HOST || 'http://127.0.0.1:7700',
            apiKey: process.env.MEILI_API_KEY || '',
        });
        try {
            await meiliClient.deleteIndex(meiliIndexName);
            console.log(`MeiliSearch: Deleted existing index: ${meiliIndexName}`);
        } catch (e) {
            console.log(`MeiliSearch: Index ${meiliIndexName} does not exist or could not be deleted`);
        }
        const index = meiliClient.index(meiliIndexName);
        const result = await index.addDocuments(Array.isArray(data) ? data : [data], { primaryKey: 'documentId' });
        console.log(`MeiliSearch: Indexed records into index: ${meiliIndexName}`, result);
    } catch (err) {
        console.error("MeiliSearch indexing error: ", err.message || err);
    }
}
