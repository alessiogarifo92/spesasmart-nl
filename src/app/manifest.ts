import type { MetadataRoute } from "next";

/** Colours match the dark tokens in globals.css: the installed app opens dark. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "SpesaSmart NL",
    short_name: "SpesaSmart",
    description:
      "Vergelijk supermarktaanbiedingen in Nederland en vind de goedkoopste route voor je boodschappenlijst.",
    lang: "nl",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f1412",
    theme_color: "#0f1412",
    categories: ["shopping", "food"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
