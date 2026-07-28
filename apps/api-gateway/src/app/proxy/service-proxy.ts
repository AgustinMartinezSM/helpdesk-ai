import {
  createProxyMiddleware,
  fixRequestBody,
  type RequestHandler,
} from 'http-proxy-middleware';

export interface ServiceRoute {
  /** Public prefix on the gateway, e.g. '/api/tickets'. */
  pathFilter: string;
  /** Prefix the downstream service expects, e.g. '/tickets'. */
  rewriteTo: string;
  /** Base URL of the downstream service. */
  target: string;
}

/**
 * Pass-through proxy for one downstream service.
 *
 * The gateway owns traffic policy, not domain behavior, so routes are plain
 * Express-level middleware rather than Nest controllers: requests stream
 * through untouched, correlation headers included (the correlation
 * middleware runs first and normalizes them onto the request).
 *
 * Mounted at the app root with pathFilter (not app.use(prefix, ...)):
 * Express strips mount paths from req.url, which would leave pathRewrite
 * nothing to match. fixRequestBody re-serializes bodies that Nest's global
 * body parser already consumed; without it proxied POSTs hang.
 */
export function createServiceProxy(route: ServiceRoute): RequestHandler {
  return createProxyMiddleware({
    target: route.target,
    changeOrigin: true,
    pathFilter: route.pathFilter,
    pathRewrite: { [`^${route.pathFilter}`]: route.rewriteTo },
    on: {
      proxyReq: fixRequestBody,
    },
  });
}
