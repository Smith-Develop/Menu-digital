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
 * El enlace trae el token en la propia URL (`token_hash`) y se canjea aquí por
 * una sesión de recuperación. Se hace así, y no dejando que GoTrue redirija,
 * porque GoTrue sólo acepta destinos que estén en su lista blanca: si no lo
 * están —y en este despliegue no lo están— devuelve al usuario a la dirección
 * de la base de datos, donde no hay ninguna pantalla para escribir la clave.
 *
 * Se sigue admitiendo la sesión ya abierta y el token en el fragmento, que es
 * como llegan los enlaces antiguos y los de un despliegue bien configurado.
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
    let cancelled = false;

    async function open() {
      const tokenHash = new URLSearchParams(window.location.search).get('token_hash');

      if (tokenHash) {
        const { error: otpError } = await supabase.auth.verifyOtp({
          type: 'recovery',
          token_hash: tokenHash,
        });
        if (cancelled) return;
        setValid(!otpError);
        setReady(true);
        // El token ya está canjeado: se borra de la barra de direcciones para
        // que no quede en el historial ni se comparta por accidente.
        window.history.replaceState(null, '', window.location.pathname);
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        setValid(true);
        setReady(true);
        return;
      }

      // Enlaces que traen el token en el fragmento: la sesión llega algo después.
      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        if (cancelled) return;
        setValid(Boolean(session));
        setReady(true);
      });
      setTimeout(() => !cancelled && setReady(true), 2000);
      return () => listener.subscription.unsubscribe();
    }

    void open();
    return () => {
      cancelled = true;
    };
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
