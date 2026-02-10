/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@kakao-cs-bot/config'],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
