import { BottomNav } from '@/components/storefront/bottom-nav';

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mobile-shell flex flex-col">
      <div className="flex-1">{children}</div>
      <BottomNav />
    </div>
  );
}
