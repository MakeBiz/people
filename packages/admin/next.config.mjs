/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @hr/db — рабочий воркспейс, его нужно транспилировать
  transpilePackages: ["@hr/db"],
  experimental: {
    // Prisma и bcrypt не бандлим, грузим из node_modules в рантайме
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs"],
  },
};

export default nextConfig;
