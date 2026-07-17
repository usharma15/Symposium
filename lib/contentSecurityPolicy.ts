export const clerkContentSecurityPolicyDirectives: Record<string, string[]> = {
  "base-uri": ["self"],
  "connect-src": ["self", "https:", "wss:"],
  "font-src": ["self", "data:", "https:"],
  "frame-ancestors": ["self"],
  "frame-src": ["self", "blob:", "https:"],
  "img-src": ["self", "blob:", "data:", "https:"],
  "manifest-src": ["self"],
  "media-src": ["self", "blob:", "data:", "https:"],
  "object-src": ["none"],
  "script-src-attr": ["none"],
  "worker-src": ["self", "blob:"]
};

export const createLocalContentSecurityPolicy = (development: boolean) =>
  [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "media-src 'self' blob: data: https:",
    "font-src 'self' data: https:",
    `connect-src 'self' https: wss:${development ? " http: ws:" : ""}`,
    "frame-src 'self' blob: https:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(development ? [] : ["upgrade-insecure-requests"])
  ].join("; ");
