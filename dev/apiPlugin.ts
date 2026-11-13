/**
 * Runs the real API (server/router.ts) inside the Vite dev and preview
 * servers, so `npm run dev` gives a complete working site without Netlify.
 *
 * Orders are stored as JSON files in .data/. When no payment provider is
 * configured, the built-in sandbox is switched on so the full checkout flow
 * can be tried immediately. This file is never part of the production build.
 */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, loadEnv, type Connect, type Plugin, type ViteDevServer } from 'vite';
import { SECURITY_HEADERS } from './securityHeaders.ts';

function toRequest(req: IncomingMessage, body: Buffer): Request {
  const host = req.headers.host || 'localhost';
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach(x => headers.append(k, x));
    else if (v != null) headers.set(k, v);
  }
  const method = (req.method || 'GET').toUpperCase();
  return new Request(`http://${host}${req.url}`, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(body),
  });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await response.arrayBuffer()));
}

type Handle = (req: Request) => Promise<Response>;

export function apiPlugin(): Plugin {
  const prepareEnv = (mode: string, root: string, log: (msg: string) => void): void => {
    // make the variables from .env files visible to the server code
    const env = loadEnv(mode, root, '');
    for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

    if (!process.env.PAYMENT_PROVIDER) {
      process.env.PAYMENT_PROVIDER = 'sandbox';
      process.env.SANDBOX_WEBHOOK_SECRET ||= randomBytes(24).toString('hex');
      log('[api] no PAYMENT_PROVIDER set: using the built-in sandbox (test payments only)');
    }
    if (!process.env.ORDER_STORE) process.env.ORDER_STORE = 'file';
  };

  const middleware =
    (load: () => Promise<Handle>): Connect.NextHandleFunction =>
    (req, res, next) => {
      if (!req.url || !req.url.startsWith('/api/')) return next();
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        load()
          .then(handle => handle(toRequest(req, Buffer.concat(chunks))))
          .then(response => send(res, response))
          .catch(err => {
            console.error('[api]', err);
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end('{"error":"internal_error"}');
          });
      });
    };

  // the server code is loaded through Vite, so it is transpiled on the fly
  // and picks up edits without restarting the dev server
  const viaVite = (server: ViteDevServer) => async (): Promise<Handle> => {
    const mod = (await server.ssrLoadModule('/server/router.ts')) as { handleApi: Handle };
    return mod.handleApi;
  };

  return {
    name: 'nightwntr-dev-api',
    configureServer(server) {
      prepareEnv(server.config.mode, server.config.root, msg => server.config.logger.info(msg));
      server.middlewares.use(middleware(viaVite(server)));
    },
    async configurePreviewServer(server) {
      prepareEnv(server.config.mode, server.config.root, msg => server.config.logger.info(msg));
      // `vite preview` has no module loader of its own: start a silent one just for the API
      const loader = await createServer({
        configFile: false,
        root: server.config.root,
        appType: 'custom',
        logLevel: 'silent',
        server: { middlewareMode: true, hmr: false, ws: false, watch: null },
        optimizeDeps: { noDiscovery: true, include: [] },
      });
      server.httpServer.once('close', () => void loader.close());
      // the built site is previewed with the production headers (see securityHeaders.ts)
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
        next();
      });
      server.middlewares.use(middleware(viaVite(loader)));
    },
  };
}
