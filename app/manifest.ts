import type { MetadataRoute } from "next";

// Home-screen install (Android "Add to Home screen"). The icon is the clinic's
// tooth-in-hand mark without the wordmark. iPhones use app/apple-icon.png.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SDC Ledger",
    short_name: "SDC Ledger",
    description: "Expense and income tracking for Sarada Dental Care.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0f6e7a",
    icons: [
      { src: "/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
