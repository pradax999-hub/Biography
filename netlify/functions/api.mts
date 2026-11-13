/**
 * Netlify Function: the whole backend lives under /api/*.
 * The logic is in /server so it can be tested and run locally without Netlify.
 */
import type { Config } from '@netlify/functions';
import { handleApi } from '../../server/router';

export default async (req: Request): Promise<Response> => handleApi(req);

export const config: Config = {
  path: '/api/*',
  // platform-level limit in front of the function, on top of the per-route limits inside it
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
  },
};
