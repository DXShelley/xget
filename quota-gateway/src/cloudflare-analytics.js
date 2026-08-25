const GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

const CLASS_A_ACTIONS = new Set([
  'CopyObject',
  'CreateBucket',
  'CreateMultipartUpload',
  'CompleteMultipartUpload',
  'ListBuckets',
  'ListMultipartUploads',
  'ListObjects',
  'ListObjectsV2',
  'ListParts',
  'PutBucketCors',
  'PutBucketLifecycleConfiguration',
  'PutBucketPolicy',
  'PutObject',
  'UploadPart',
  'UploadPartCopy'
]);

const CLASS_B_ACTIONS = new Set(['GetObject', 'HeadBucket', 'HeadObject']);

const WORKERS_QUERY = `query WorkersUsage($accountTag: string!, $start: string!, $end: string!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(limit: 100, filter: { datetime_geq: $start, datetime_leq: $end }) {
        sum { requests }
      }
    }
  }
}`;

const R2_QUERY = `query R2Usage($accountTag: string!, $dayStart: Time!, $monthStart: Time!, $end: Time!, $bucketName: string!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      r2StorageAdaptiveGroups(limit: 10000, filter: { datetime_geq: $dayStart, datetime_leq: $end, bucketName: $bucketName }, orderBy: [datetime_DESC]) {
        max { payloadSize metadataSize }
        dimensions { datetime }
      }
      r2OperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $monthStart, datetime_leq: $end, bucketName: $bucketName }) {
        dimensions { actionType }
        sum { requests }
      }
    }
  }
}`;

/**
 * Reads delayed account aggregates from the same GraphQL dataset used by the Dashboard.
 * @param {{ CLOUDFLARE_ACCOUNT_ID?: string, CLOUDFLARE_ANALYTICS_API_TOKEN?: string, R2_BUCKET_NAME?: string }} env
 * @param {Date} [now]
 * @param {typeof fetch} [request]
 * @returns {Promise<Record<string, number>>}
 */
export async function fetchCloudflareUsage(env, now = new Date(), request = fetch) {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_ANALYTICS_API_TOKEN || !env.R2_BUCKET_NAME) {
    throw new Error('Cloudflare Analytics credentials or R2 bucket name are not configured.');
  }

  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const headers = {
    Authorization: `Bearer ${env.CLOUDFLARE_ANALYTICS_API_TOKEN}`,
    'Content-Type': 'application/json'
  };
  const [workers, r2] = await Promise.all([
    queryAccount(request, headers, WORKERS_QUERY, {
      accountTag: env.CLOUDFLARE_ACCOUNT_ID,
      end: now.toISOString(),
      start: startOfDay.toISOString()
    }),
    queryAccount(request, headers, R2_QUERY, {
      accountTag: env.CLOUDFLARE_ACCOUNT_ID,
      bucketName: env.R2_BUCKET_NAME,
      dayStart: startOfDay.toISOString(),
      end: now.toISOString(),
      monthStart: startOfMonth.toISOString()
    })
  ]);
  return parseUsage({ ...workers, ...r2 });
}

/**
 * Sends one schema-compatible GraphQL query and returns its single account result.
 * @param {typeof fetch} request
 * @param {Record<string, string>} headers
 * @param {string} query
 * @param {Record<string, string>} variables
 * @returns {Promise<Record<string, unknown>>}
 */
async function queryAccount(request, headers, query, variables) {
  const response = await request(GRAPHQL_ENDPOINT, {
    body: JSON.stringify({ query, variables }),
    headers,
    method: 'POST'
  });
  if (!response.ok) {
    throw new Error(`Cloudflare Analytics returned HTTP ${response.status}.`);
  }
  const body = await response.json();
  if (body.errors?.length) {
    throw new Error(`Cloudflare Analytics GraphQL error: ${graphqlError(body.errors)}.`);
  }
  if (!body.data?.viewer?.accounts || body.data.viewer.accounts.length !== 1) {
    throw new Error('Cloudflare Analytics returned an invalid GraphQL response.');
  }
  return body.data.viewer.accounts[0];
}

/** @param {unknown} errors */
function graphqlError(errors) {
  const message =
    Array.isArray(errors) && typeof errors[0]?.message === 'string'
      ? errors[0].message
      : 'unknown error';
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 240);
}

/**
 * @param {unknown} account
 * @returns {Record<string, number>}
 */
export function parseUsage(account) {
  if (!account || typeof account !== 'object') {
    throw new Error('Cloudflare Analytics account result is malformed.');
  }
  const value =
    /** @type {{ workersInvocationsAdaptive?: unknown, r2StorageAdaptiveGroups?: unknown, r2OperationsAdaptiveGroups?: unknown }} */ (
      account
    );
  if (
    !Array.isArray(value.workersInvocationsAdaptive) ||
    !Array.isArray(value.r2StorageAdaptiveGroups) ||
    !Array.isArray(value.r2OperationsAdaptiveGroups)
  ) {
    throw new Error('Cloudflare Analytics result is missing a required dataset.');
  }

  const workerRequests = sumGroups(value.workersInvocationsAdaptive, 'workersInvocationsAdaptive');
  const storage = maximumStorage(value.r2StorageAdaptiveGroups);
  const operations = classifyOperations(value.r2OperationsAdaptiveGroups);
  return {
    'r2.class_a': operations.classA,
    'r2.class_b': operations.classB,
    'r2.storage.bytes': storage,
    'worker.requests': workerRequests
  };
}

/** @param {unknown[]} groups @param {string} name */
function sumGroups(groups, name) {
  return groups.reduce((total, group) => {
    const requests = group?.sum?.requests;
    if (!Number.isSafeInteger(requests) || requests < 0) {
      throw new Error(`Cloudflare Analytics ${name} contains an invalid request count.`);
    }
    return total + requests;
  }, 0);
}

/** @param {unknown[]} groups */
function maximumStorage(groups) {
  if (groups.length === 0) {
    throw new Error('Cloudflare Analytics storage result is invalid.');
  }
  return groups.reduce((maximum, group) => {
    const payload = group?.max?.payloadSize;
    const metadata = group?.max?.metadataSize;
    if (
      !Number.isSafeInteger(payload) ||
      payload < 0 ||
      !Number.isSafeInteger(metadata) ||
      metadata < 0
    ) {
      throw new Error('Cloudflare Analytics storage result is invalid.');
    }
    return Math.max(maximum, payload + metadata);
  }, 0);
}

/** @param {unknown[]} groups */
function classifyOperations(groups) {
  return groups.reduce(
    (totals, group) => {
      const action = group?.dimensions?.actionType;
      const requests = group?.sum?.requests;
      if (typeof action !== 'string' || !Number.isSafeInteger(requests) || requests < 0) {
        throw new Error('Cloudflare Analytics R2 operation result is invalid.');
      }
      if (CLASS_B_ACTIONS.has(action)) {
        totals.classB += requests;
      } else if (CLASS_A_ACTIONS.has(action)) {
        totals.classA += requests;
      } else {
        // Unknown R2 operation types are charged to the stricter class until mapped explicitly.
        totals.classA += requests;
      }
      return totals;
    },
    { classA: 0, classB: 0 }
  );
}
