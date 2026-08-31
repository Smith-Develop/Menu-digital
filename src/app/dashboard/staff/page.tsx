import { getI18n } from '@/i18n';
import { requireSection } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { StaffManager } from '@/components/dashboard/staff-manager';
import { getPublicOrigin } from '@/lib/request-url';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Equipo' };

export default async function StaffPage() {
  const { restaurant, subscription, profile } = await requireSection('staff');
  const { t } = await getI18n();
  const supabase = await createServerSupabase();

  const siteUrl = await getPublicOrigin();

  const { data: invitations } = await supabase
    .from('staff_invitations')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .is('accepted_at', null)
    .order('created_at', { ascending: false });

  const { data: staff } = await supabase
    .from('restaurant_staff')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .order('created_at');

  const userIds = (staff ?? []).map((s) => s.user_id);
  const { data: profiles } = userIds.length
    ? await supabase.from('profiles').select('id, full_name, email, avatar_url').in('id', userIds)
    : { data: [] };

  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.dashboard.staff}</h1>
        <p className="mt-1 text-sm text-ink-300">
          {(staff ?? []).length}
          {subscription?.plan?.max_staff ? ` / ${subscription.plan.max_staff}` : ''}
        </p>
      </div>

      <StaffManager
        currentUserId={profile.id}
        ownerId={restaurant.owner_id}
        siteUrl={siteUrl}
        invitations={(invitations ?? []).map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          asCourier: invitation.as_courier,
          token: invitation.token,
          expiresAt: invitation.expires_at,
        }))}
        members={(staff ?? []).map((member) => {
          const person = byId.get(member.user_id);
          return {
            id: member.id,
            userId: member.user_id,
            name: person?.full_name ?? person?.email ?? '—',
            email: person?.email ?? null,
            role: member.role,
            isActive: member.is_active,
          };
        })}
      />
    </div>
  );
}
