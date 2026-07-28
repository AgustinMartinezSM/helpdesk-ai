import {
  createProxyMiddleware,
  fixRequestBody,
  type RequestHandler,
} from 'http-proxy-middleware';

/**
 * Pass-through proxy for authentication traffic: /api/auth/* -> auth-service
 * /auth/*.
 *
 * The gateway owns traffic policy, not domain behavior, so this is plain
 * Express-level middleware rather than a Nest controller: requests are
 * streamed through untouched (correlation headers included — the
 * correlation middleware runs first and normalizes them onto the request).
 *
 * fixRequestBody re-serializes bodies that Nest's global body parser already
 * consumed; without it, proxied POSTs hang with empty bodies.
 */
export function createAuthProxy(authServiceUrl: string): RequestHandler {
  // Mounted at the app root with pathFilter (not app.use('/api/auth', ...)):
  // Express strips the mount path from req.url, which would leave pathRewrite
  // nothing to match.
  return createProxyMiddleware({
    target: authServiceUrl,
    changeOrigin: true,
    pathFilter: '/api/auth',
    pathRewrite: { '^/api/auth': '/auth' },
    on: {
      proxyReq: fixRequestBody,
    },
  });
}
