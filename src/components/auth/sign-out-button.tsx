'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export function SignOutButton({ label }: { label: string }) {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      className="flex w-full items-center gap-4 rounded-2xl bg-surface-field px-4 py-4 text-left transition-colors hover:bg-red-50"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-state-danger">
        <LogOut className="h-4 w-4" />
      </span>
      <span className="flex-1 text-sm font-semibold text-state-danger">{label}</span>
    </button>
  );
}
