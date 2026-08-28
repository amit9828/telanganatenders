import { MongoClient } from 'mongodb';

export default async function sitemap() {
  const baseUrl = 'https://www.tgtenders.in';

  // 1. Static Routes (Main Pages of your website)
  const staticRoutes = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 1.0,
    }
  ];

  try {
    if (!process.env.MONGO_URL) {
       console.warn("MONGO_URL is missing. Returning only static routes.");
       return staticRoutes;
    }

    // 2. Fetch Active Tenders from Database (Dynamic Routes)
    const client = await MongoClient.connect(process.env.MONGO_URL);
    const db = client.db(process.env.DB_NAME || 'tender_portal');
    
    // Fetching latest 1000 tenders to keep sitemap fast and efficient
    const tenders = await db.collection('tenders')
      .find({})
      .sort({ _id: -1 })
      .limit(1000)
      .toArray();

    const dynamicRoutes = tenders.map((tender) => ({
      url: `${baseUrl}/tenders/${tender._id}`,
      lastModified: tender.created_at ? new Date(tender.created_at) : new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    }));

    // Close DB connection
    await client.close();

    // 3. Return combined routes to Next.js
    return [...staticRoutes, ...dynamicRoutes];

  } catch (error) {
    console.error("Sitemap generation error:", error);
    // Fallback: If DB fails, at least return the home page to Google
    return staticRoutes;
  }
}
