import {
  createProxyMiddleware,
  fixRequestBody,
  type RequestHandler,
} from 'http-proxy-middleware';

/**
 * The service credential's header (SECURITY.md). The gateway knows the name
 * only to refuse it: see the strip in createServiceProxy.
 */
export const INTERNAL_SERVICE_TOKEN_HEADER = 'x-internal-service-token';

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
 *
 * One header does not pass: `x-internal-service-token`. Everything else is
 * forwarded verbatim, which was safe while no host behind the gateway had an
 * internal surface. organizations-service is routed from Sprint 9.8 and its
 * /internal/* routes authenticate a PROCESS, so an inbound request must never
 * be able to present that credential — stripping it here keeps the property
 * the design already depended on (ADR 0019). Strip before fixRequestBody:
 * that call writes the body and can end the request.
 */
export function createServiceProxy(route: ServiceRoute): RequestHandler {
  return createProxyMiddleware({
    target: route.target,
    changeOrigin: true,
    pathFilter: route.pathFilter,
    pathRewrite: { [`^${route.pathFilter}`]: route.rewriteTo },
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.removeHeader(INTERNAL_SERVICE_TOKEN_HEADER);
        fixRequestBody(proxyReq, req);
      },
    },
  });
}
