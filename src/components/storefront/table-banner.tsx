'use client';

import Link from 'next/link';
import { ConciergeBell, QrCode } from 'lucide-react';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

/** Aviso persistente de "estás pidiendo desde la mesa X". */
export function TableBanner({
  tableName,
  slug,
  className,
}: {
  tableName: string;
  slug: string;
  className?: string;
}) {
  const t = useT();

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-2xl bg-brand-50 px-4 py-3 text-brand-700',
        className,
      )}
    >
      <QrCode className="h-5 w-5 shrink-0" />
      <p className="flex-1 text-sm font-semibold">
        {t.table.youAreAt} <span className="font-bold">{tableName}</span>
      </p>
      <Link
        href={`/r/${slug}/table`}
        className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold"
      >
        <ConciergeBell className="h-3.5 w-3.5" />
        {t.table.callWaiter}
      </Link>
    </div>
  );
}
