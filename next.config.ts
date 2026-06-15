import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@cloudscape-design/components',
    '@cloudscape-design/component-toolkit',
    '@cloudscape-design/global-styles',
  ],
};

export default nextConfig;
