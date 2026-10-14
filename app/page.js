import HomeClient from './HomeClient';
import { getPublicPricing } from '@/lib/public-pricing';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }) {
  let initialItems = [];
  try {
    initialItems = await getPublicPricing();
  } catch (err) {
    console.error('[home] public pricing failed:', err?.message || err);
  }
  const handoffQuery = Boolean(searchParams?.intent || searchParams?.resume_pdf === '1');
  return <HomeClient initialItems={initialItems} handoffQuery={handoffQuery} />;
}
