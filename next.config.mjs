/** @type {import('next').NextConfig} */
const nextConfig = {
  // Bank statements and PappyJoe exports are uploaded through a server action.
  // Vercel caps a request at 4.5 MB; one month of files is well under 1 MB.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};
export default nextConfig;
