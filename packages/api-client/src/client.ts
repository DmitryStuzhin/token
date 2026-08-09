import createClient, { type ClientOptions } from 'openapi-fetch';
import type { paths } from './generated.js';

export function createTokenApiClient(options: ClientOptions = {}) {
  return createClient<paths>({
    baseUrl: '/api/v1',
    credentials: 'same-origin',
    ...options,
  });
}

export type TokenApiClient = ReturnType<typeof createTokenApiClient>;
