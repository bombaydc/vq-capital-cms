const { putObject, getProvider } = require('./object-storage');
const jsonRoutes = require('./json-routes');

/**
 * Look up which Strapi REST call produces the JSON file for a content type.
 * The per-project map lives in ./json-routes.js.
 *
 * @param {string} uid e.g. 'api::home.home'
 * @returns {{ apiPath: string, isCollection: boolean, jsonFile: string } | null}
 */
function getApiEndpointFromUid(uid = '') {
    const [, modelName] = uid.split('.');
    return jsonRoutes[modelName] ?? null;
}

async function fetchStrapiData(apiPath, isCollection = false) {
    if (!isCollection) {
        const fullUrl = `${process.env.STRAPI_API_BASE}/${apiPath}`;
        const response = await fetch(fullUrl, {
            headers: {
                Authorization: `Bearer ${process.env.STRAPI_API_TOKEN}`,
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed API call to ${fullUrl}:`, errorText);
            console.error(`Headers:`, {
                Authorization: `Bearer ${process.env.STRAPI_API_TOKEN}`,
            });
            throw new Error(`Failed to fetch data from Strapi (${response.status})`);
        }

        return await response.json();
    }

    // For collections, fetch all pages
    const allData = [];
    let currentPage = 1;
    let totalPages = 1;

    do {
        const query = `&pagination[page]=${currentPage}&pagination[pageSize]=25`;
        const fullUrl = `${process.env.STRAPI_API_BASE}/${apiPath}${query}`;

        const response = await fetch(fullUrl, {
            headers: {
                Authorization: `Bearer ${process.env.STRAPI_API_TOKEN}`,
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed API call to ${fullUrl}:`, errorText);
            throw new Error(`Failed to fetch data from Strapi (${response.status})`);
        }

        const data = await response.json();
        totalPages = data?.meta?.pagination?.pageCount ?? 1;
        allData.push(...(data?.data ?? []));
        currentPage++;
    } while (currentPage <= totalPages);

    return { data: allData };
}

module.exports = {
    syncJSON: async (uid) => {
        try {

            if (!uid) {
                return { status: false, status_code: 400, "message": "Content type UID is required" };
            }

            const routeInfo = getApiEndpointFromUid(uid);
            if (!routeInfo) {
                return { status: false, status_code: 400, "message": "Invalid Content type UID" };
            }
            // Provider-agnostic: GCS (if GCS_BUCKET set) → S3 (if AWS_BUCKET set) → local
            const provider = getProvider();


            const { apiPath, isCollection, jsonFile } = routeInfo;
            const data = await fetchStrapiData(apiPath, isCollection);

            const fileName = jsonFile;

            let uploadResult = {};
            try {
                uploadResult = await putObject({
                    key:         `data/${fileName}`,
                    body:        JSON.stringify(data, null, 2),
                    contentType: 'application/json',
                });
                // console.log(`${provider} upload resp: `, uploadResult);
            } catch (err) {
                console.error(`${provider} upload failed:`, err);
            }



            return {
                status: true, status_code: 200, "message": "Data fetched and uploaded successfully", resp: uploadResult, "data": data, fileName
            };
        } catch (err) {
            console.error('Issue handler failed:', err);
            return { status: false, status_code: 500, "message": "Internal Server Error" };
        }
    }
}
