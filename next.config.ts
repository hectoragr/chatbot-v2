import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@cloudscape-design/components',
    '@cloudscape-design/component-toolkit',
    '@cloudscape-design/global-styles',
  ],
  // The lib/* modules use ESM `.js` import specifiers that point at `.ts` source
  // (e.g. `import { ddb } from './ddb.js'`). tsc (bundler resolution) and vitest
  // resolve these, but Next's webpack build needs an extensionAlias to map a
  // `.js` specifier to the `.ts`/`.tsx` source. Without this, any route handler
  // importing the DDB lib chain fails to build with "Can't resolve './usage.js'".
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
