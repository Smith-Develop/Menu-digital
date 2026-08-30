'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { useT } from '@/i18n/provider';

/**
 * Elección de contraseña nueva tras seguir el enlace del correo.
 *
 * Supabase abre una sesión de recuperación al llegar con el token, así que
 * aquí basta con actualizar la contraseña del usuario que ya está identificado.
 */
export function ResetPasswordForm() {
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [valid, setValid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    // El token puede llegar como sesión ya abierta o en el fragmento de la URL.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setValid(true);
        setReady(true);
        return;
      }
      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        setValid(Boolean(session));
        setReady(true);
      });
      // Si en dos segundos no llega sesión, el enlace ya no sirve.
      setTimeout(() => setReady(true), 2000);
      return () => listener.subscription.unsubscribe();
    });
  }, []);

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
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(t.common.error);
      return;
    }

    toast(t.auth.resetDone, 'success');
    router.replace('/login');
  }

  if (!ready) {
    return <p className="mt-8 text-center text-sm text-ink-300">{t.common.loading}</p>;
  }

  if (!valid) {
    return (
      <div className="mt-8 rounded-2xl bg-red-50 p-5 text-center">
        <p className="text-sm font-semibold text-red-800">{t.auth.resetExpired}</p>
        <a href="/forgot-password" className="btn-ghost mt-4">
          {t.auth.forgotCta}
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-7 space-y-4">
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
      <Button type="submit" size="block" loading={loading}>
        {t.auth.resetCta}
      </Button>
    </form>
  );
}
