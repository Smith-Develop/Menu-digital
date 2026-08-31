'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Lock, Mail, Store, User } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { signUp } from '@/app/actions/auth';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n/provider';

export function RegisterForm({ termsUrl }: { termsUrl?: string | null }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();

  const [fullName, setFullName] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);

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

    // Por la acción de servidor: el registro del navegador deja la cuenta a la
    // espera de un correo de confirmación que este despliegue no envía.
    const result = await signUp({
      fullName: fullName.trim(),
      email: email.trim(),
      password,
      kind: 'restaurant',
      restaurantName: restaurantName.trim(),
    });

    if (!result.ok) {
      setError(result.error === 'EMAIL_TAKEN' ? t.auth.emailTaken : t.common.error);
      setLoading(false);
      return;
    }

    // La cuenta queda utilizable: se entra directamente.
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (signInError) {
      setError(t.common.error);
      return;
    }

    toast(t.auth.accountCreated, 'success');
    router.replace(`/onboarding?name=${encodeURIComponent(restaurantName.trim())}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      <Input
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        variant="pill"
        placeholder={t.auth.fullName}
        icon={<User className="h-4 w-4" />}
        autoComplete="name"
        required
      />
      <Input
        value={restaurantName}
        onChange={(e) => setRestaurantName(e.target.value)}
        variant="pill"
        placeholder={t.auth.restaurantName}
        icon={<Store className="h-4 w-4" />}
        required
      />
      <Input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        variant="pill"
        placeholder={t.auth.email}
        icon={<Mail className="h-4 w-4" />}
        autoComplete="email"
        required
      />
      <Input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        variant="pill"
        placeholder={t.auth.password}
        icon={<Lock className="h-4 w-4" />}
        autoComplete="new-password"
        minLength={8}
        required
      />
      <Input
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        variant="pill"
        placeholder={t.auth.confirmPassword}
        icon={<Lock className="h-4 w-4" />}
        autoComplete="new-password"
        required
        error={error}
      />

      {/* Sin aceptar las condiciones no se crea la cuenta: es el propio botón
          el que queda desactivado, para que se vea por qué no avanza. */}
      <label className="flex items-start gap-2.5 pt-1 text-xs text-ink-400">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-surface-line text-brand focus:ring-brand"
        />
        <span>
          {t.auth.agreePrefix}{' '}
          <a href={termsUrl ?? '#'} className="font-bold text-brand" target="_blank" rel="noreferrer">
            {t.auth.termsAndConditions}
          </a>
        </span>
      </label>

      <Button
        type="submit"
        size="block"
        loading={loading}
        disabled={!accepted}
        className="mt-6 rounded-full"
      >
        {t.auth.signUpCta}
      </Button>
    </form>
  );
}
