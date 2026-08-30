'use client';

import { useState, type FormEvent } from 'react';
import { Lock, LogIn, Mail, User, UserPlus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

/**
 * Identificación antes de confirmar el pedido.
 *
 * Se pide cuenta porque sin ella el cliente pierde el seguimiento en cuanto
 * cierra la pestaña: el enlace del pedido vive solo en esa navegación. Con
 * cuenta, el pedido queda en "Mis pedidos" y se puede seguir desde cualquier
 * dispositivo.
 */
export function CheckoutIdentity({
  defaultEmail,
  defaultName,
  defaultPhone,
  onReady,
}: {
  defaultEmail?: string;
  defaultName?: string;
  defaultPhone?: string;
  onReady: () => void;
}) {
  const t = useT();

  const [mode, setMode] = useState<'register' | 'signin'>('register');
  const [fullName, setFullName] = useState(defaultName ?? '');
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [phone, setPhone] = useState(defaultPhone ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (mode === 'register' && password.length < 8) {
      setError(t.auth.passwordTooShort);
      return;
    }

    setLoading(true);
    const supabase = createClient();

    if (mode === 'signin') {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      setLoading(false);

      if (signInError) {
        setError(t.auth.invalidCredentials);
        return;
      }
      onReady();
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim(), phone: phone.trim() } },
    });

    if (signUpError) {
      // Correo ya registrado: se intenta entrar con esa contraseña.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      setLoading(false);

      if (signInError) {
        setError(t.checkout.emailTakenHint);
        setMode('signin');
        return;
      }
      onReady();
      return;
    }

    setLoading(false);

    // Sin sesión inmediata la instancia exige confirmar el correo.
    if (!data.session) {
      setNotice(t.auth.checkEmail);
      return;
    }
    onReady();
  }

  return (
    <section className="rounded-2xl bg-surface-field p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand">
          <UserPlus className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-display text-base font-bold text-ink-700">
            {t.checkout.identityTitle}
          </h2>
          <p className="mt-0.5 text-sm text-ink-300">{t.checkout.identityHint}</p>
        </div>
      </div>

      <div className="mb-4 flex gap-1 rounded-xl bg-white p-1">
        {(['register', 'signin'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setMode(option);
              setError(null);
              setNotice(null);
            }}
            className={cn(
              'flex-1 rounded-lg py-2.5 text-sm font-bold transition-colors',
              mode === option ? 'bg-brand text-brand-contrast' : 'text-ink-400 hover:text-ink',
            )}
          >
            {option === 'register' ? t.auth.signUp : t.auth.signIn}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4">
        {mode === 'register' && (
          <>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              label={t.auth.fullName}
              icon={<User className="h-4 w-4" />}
              autoComplete="name"
              className="bg-white"
              required
            />
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              label={t.auth.phone}
              type="tel"
              autoComplete="tel"
              className="bg-white"
              placeholder="+34 600 000 000"
            />
          </>
        )}

        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          label={t.auth.email}
          icon={<Mail className="h-4 w-4" />}
          autoComplete="email"
          className="bg-white"
          required
        />
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          label={t.auth.password}
          icon={<Lock className="h-4 w-4" />}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          className="bg-white"
          minLength={mode === 'register' ? 8 : undefined}
          required
          error={error}
        />

        {notice && (
          <p className="rounded-xl bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-800">
            {notice}
          </p>
        )}

        <Button type="submit" size="block" loading={loading}>
          <LogIn className="h-4 w-4" />
          {mode === 'register' ? t.checkout.registerAndContinue : t.auth.signIn}
        </Button>
      </form>
    </section>
  );
}
