import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: "https://legibilitytest.onedaybuilt.com", changeFrequency: "weekly", priority: 1 }];
}
