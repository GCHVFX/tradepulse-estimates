import { MetadataRoute } from "next";
import { CANONICAL_URL } from "@/lib/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: CANONICAL_URL,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: `${CANONICAL_URL}/plumbers`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${CANONICAL_URL}/trades`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${CANONICAL_URL}/electricians`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${CANONICAL_URL}/plumbing-cost`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${CANONICAL_URL}/electrical-cost`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${CANONICAL_URL}/plumbing-estimate-template`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${CANONICAL_URL}/contact`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}
