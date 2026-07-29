const defaultPublicAttachmentBaseUrl = "https://pub-ea6988f92ec843349eacdfdb08deb5cf.r2.dev";

const normalizePublicAttachmentBaseUrl = (value) => {
  try {
    const url = new URL(value || defaultPublicAttachmentBaseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      return defaultPublicAttachmentBaseUrl;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return defaultPublicAttachmentBaseUrl;
  }
};

const publicAttachmentBaseUrl = normalizePublicAttachmentBaseUrl(
  process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {},
  env: {
    NEXT_PUBLIC_R2_PUBLIC_BASE_URL: publicAttachmentBaseUrl
  },
  rewrites: async () => [
    {
      source: "/attachment-assets/:path*",
      destination: `${publicAttachmentBaseUrl}/:path*`
    }
  ],
  headers: async () => [
    {
      source: "/symposium-artifacts/v1/:path*",
      headers: [
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" }
      ]
    },
    {
      source: "/symposium-renders/:path*.avif",
      headers: [
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" }
      ]
    },
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }
      ]
    }
  ],
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...(config.watchOptions ?? {}),
        poll: 1000,
        aggregateTimeout: 300,
        ignored: [
          "**/.git/**",
          "**/.next/**",
          "**/.data/**",
          "**/.npm-cache/**",
          "**/node_modules/**",
          "**/*.tsbuildinfo"
        ]
      };
    }

    return config;
  }
};

export default nextConfig;
