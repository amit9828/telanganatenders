import HomeClient from './HomeClient';
import { getPublicPricing } from '@/lib/public-pricing';

export const dynamic = 'force-dynamic';

export default async function Page() {
  let initialItems = [];
  try {
    initialItems = await getPublicPricing();
  } catch (err) {
    console.error('[home] public pricing failed:', err?.message || err);
  }
  return <HomeClient initialItems={initialItems} />;
}
