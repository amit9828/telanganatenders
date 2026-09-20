import { getDb } from '@/lib/db';
import { liveTenderQuery } from '@/lib/tender-expiry';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function sitemap() {
  const baseUrl = 'https://www.tgtenders.in';

  // 1. Static Routes (Main Pages of your website)
  const staticRoutes = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/archive`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/legal`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ];

  try {
    if (!process.env.MONGO_URL || process.env.NEXT_PHASE === 'phase-production-build') {
       console.warn("Skipping dynamic sitemap during build or when MONGO_URL is missing.");
       return staticRoutes;
    }

    // 2. Fetch Active Tenders from Database (Dynamic Routes)
    const db = await getDb();
    
    // Fetching latest 1000 tenders to keep sitemap fast and efficient
    const tenders = await db.collection('tenders')
      .find(liveTenderQuery())
      .project({ _id: 1, created_at: 1 })
      .sort({ _id: -1 })
      .limit(1000)
      .toArray();

    const dynamicRoutes = tenders.map((tender) => ({
      url: `${baseUrl}/tenders/${tender._id}`,
      lastModified: tender.created_at ? new Date(tender.created_at) : new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    }));

    // 3. Return combined routes to Next.js
    return [...staticRoutes, ...dynamicRoutes];

  } catch (error) {
    console.error("Sitemap generation error:", error);
    // Fallback: If DB fails, at least return the home page to Google
    return staticRoutes;
  }
}
