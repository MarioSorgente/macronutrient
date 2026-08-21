/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * The app used to be a builder at `/` with a separate client roster. Everything
   * a diner does now lives under `/plan`, and `/` is the public landing page.
   * These keep old links and bookmarks working; they are permanent because the
   * old shape is not coming back.
   */
  async redirects() {
    return [
      { source: "/dishes", destination: "/plan/dishes", permanent: true },
      { source: "/house-items", destination: "/admin/house-items", permanent: true },
      { source: "/clients", destination: "/plan", permanent: true },
      { source: "/clients/:id", destination: "/plan", permanent: true },
      { source: "/clients/:id/report", destination: "/plan/report", permanent: true },
    ];
  },
};

export default nextConfig;
