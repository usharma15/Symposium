/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {},
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
