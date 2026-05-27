/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/ajentify/:path*',
        destination: `${process.env.AJENTIFY_BACKEND_URL ?? 'http://localhost:4000'}/api/ajentify/:path*`,
      },
    ];
  },
};

export default nextConfig;
