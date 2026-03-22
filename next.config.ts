import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // sql.js uses WASM for SQLite
  webpack: (config) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
  turbopack: {
    resolveAlias: {},
  },
  // Include data files and WASM in serverless function bundle
  outputFileTracingIncludes: {
    '/**': [
      './data/**',
      './node_modules/sql.js/dist/sql-wasm.wasm',
    ],
  },
};

export default nextConfig;
