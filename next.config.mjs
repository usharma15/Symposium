/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {},
  headers: async () => [
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
