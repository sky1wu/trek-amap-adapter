export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly infocode?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const rateLimits = new Set([
  '10003',
  '10004',
  '10010',
  '10014',
  '10015',
  '10019',
  '10020',
  '10021',
  '10029',
  '10044',
  '10045',
]);
const badParameters = new Set(['20000', '20001', '20002', '20012']);
const permissions = new Set([
  '10001',
  '10002',
  '10005',
  '10006',
  '10007',
  '10008',
  '10009',
  '10012',
  '10013',
  '10026',
  '10041',
  '20011',
  '40000',
  '40002',
  '40003',
]);

export function upstreamError(infocode: string): ApiError {
  // Never echo upstream `info`, URLs, fetch exceptions or response fragments.
  if (rateLimits.has(infocode))
    return new ApiError(429, 'AMap upstream rate limit exceeded', infocode);
  if (badParameters.has(infocode))
    return new ApiError(400, 'AMap rejected request parameters', infocode);
  if (permissions.has(infocode))
    return new ApiError(503, 'AMap key, permission or quota unavailable', infocode);
  return new ApiError(502, 'AMap upstream error', infocode);
}
