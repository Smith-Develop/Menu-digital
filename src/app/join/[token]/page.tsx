import { notFound } from 'next/navigation';
import { createPublicSupabase } from '@/lib/supabase/server';
import { getSessionProfile } from '@/lib/auth';
import { JoinTeam, type InvitationPreview } from '@/components/auth/join-team';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Unirse al equipo' };

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const supabase = createPublicSupabase();
  const { data } = await supabase.rpc('invitation_preview', { p_token: token });
  if (!data) notFound();

  const profile = await getSessionProfile();

  return (
    <JoinTeam
      token={token}
      invitation={data as unknown as InvitationPreview}
      currentEmail={profile?.email ?? null}
    />
  );
}
