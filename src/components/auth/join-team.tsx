'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { CheckCircle2, Lock, Store, User, XCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { staffRoleLabel } from '@/lib/staff-roles';
import { useT } from '@/i18n/provider';
import type { Enums } from '@/types/database';

export type InvitationPreview = {
  email: string;
  role: Enums<'staff_role'>;
  as_courier: boolean;
  expired: boolean;
  accepted: boolean;
  restaurant: { name: string; slug: string; logo_url: string | null };
};

/**
 * Alta de un miembro del equipo por invitación.
 *
 * La persona crea su propia cuenta con la contraseña que quiera —el restaurante
 * nunca la ve— y al terminar queda vinculada al local con el rol invitado.
 * Si ya tiene cuenta, basta con iniciar sesión con ese mismo correo.
 */
export function JoinTeam({
  token,
  invitation,
  currentEmail,
}: {
  token: string;
  invitation: InvitationPreview;
  currentEmail: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();

  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const emailMatches = currentEmail?.toLowerCase() === invitation.email.toLowerCase();

  if (invitation.accepted || invitation.expired) {
    return (
      <Shell restaurant={invitation.restaurant}>
        <div className="flex flex-col items-center gap-3 text-center">
          <XCircle className="h-10 w-10 text-state-danger" />
          <p className="font-display text-lg font-bold text-ink">
            {invitation.accepted ? t.team.alreadyAccepted : t.team.invitationExpired}
          </p>
          <Link href="/login" className="btn-ghost mt-3">
            {t.auth.signIn}
          </Link>
        </div>
      </Shell>
    );
  }

  async function accept() {
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc('accept_staff_invitation', { p_token: token });

    if (rpcError) {
      const mismatch = rpcError.message.includes('INVITATION_EMAIL_MISMATCH');
      setError(mismatch ? t.team.emailMismatch : t.common.error);
      return false;
    }
    return true;
  }

  /** Ya tiene sesión con el correo invitado: solo hay que aceptar. */
  async function onAcceptOnly() {
    setLoading(true);
    setError(null);
    const ok = await accept();
    setLoading(false);

    if (!ok) return;
    toast(t.team.joined, 'success');
    router.replace('/dashboard');
    router.refresh();
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError(t.auth.passwordTooShort);
      return;
    }
    if (password !== confirm) {
      setError(t.auth.passwordsDontMatch);
      return;
    }

    setLoading(true);
    const supabase = createClient();

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: invitation.email,
      password,
      options: { data: { full_name: fullName.trim(), role: 'restaurant' } },
    });

    if (signUpError) {
      // Si ya existía la cuenta, se intenta entrar con esa contraseña.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: invitation.email,
        password,
      });
      if (signInError) {
        setError(signUpError.message);
        setLoading(false);
        return;
      }
    } else if (!data.session) {
      toast(t.auth.checkEmail, 'info');
      setLoading(false);
      return;
    }

    const ok = await accept();
    setLoading(false);

    if (!ok) return;
    toast(t.team.joined, 'success');
    router.replace('/dashboard');
    router.refresh();
  }

  return (
    <Shell restaurant={invitation.restaurant}>
      <p className="text-center text-sm text-ink-300">
        {t.team.invitedAs}{' '}
        <span className="font-bold text-ink-700">{staffRoleLabel(invitation.role, t)}</span>
        {invitation.as_courier && ` · ${t.courier.becomeCourier}`}
      </p>
      <p className="mt-1 text-center font-mono text-sm font-bold text-brand">{invitation.email}</p>

      {emailMatches ? (
        <div className="mt-8">
          <div className="mb-5 flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            {t.team.alreadySignedIn}
          </div>
          <Button size="block" loading={loading} onClick={onAcceptOnly}>
            {t.team.joinCta}
          </Button>
          {error && <p className="mt-3 text-center text-xs font-semibold text-state-danger">{error}</p>}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            label={t.auth.fullName}
            icon={<User className="h-4 w-4" />}
            autoComplete="name"
            required
          />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            label={t.auth.password}
            icon={<Lock className="h-4 w-4" />}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            label={t.auth.confirmPassword}
            icon={<Lock className="h-4 w-4" />}
            autoComplete="new-password"
            required
            error={error}
          />

          <Button type="submit" size="block" loading={loading} className="mt-6">
            {t.team.joinCta}
          </Button>

          {currentEmail && !emailMatches && (
            <p className="text-center text-xs text-ink-300">{t.team.signedInAsOther}</p>
          )}
        </form>
      )}
    </Shell>
  );
}

function Shell({
  restaurant,
  children,
}: {
  restaurant: InvitationPreview['restaurant'];
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-surface-soft px-5 py-10">
      <div className="w-full max-w-md rounded-sheet bg-white p-7 shadow-card animate-scale-in">
        <div className="flex flex-col items-center gap-3">
          <span className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-surface-muted">
            {restaurant.logo_url ? (
              <Image src={restaurant.logo_url} alt={restaurant.name} fill sizes="64px" className="object-cover" />
            ) : (
              <Store className="h-7 w-7 text-ink-300" />
            )}
          </span>
          <h1 className="text-center font-display text-xl font-bold text-ink">{restaurant.name}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}
