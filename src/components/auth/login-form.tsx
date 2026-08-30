'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Lock, Mail } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { useT } from '@/i18n/provider';

export function LoginForm({ nextPath }: { nextPath: string }) {
  const t = useT();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(t.auth.invalidCredentials);
      setLoading(false);
      return;
    }

    // refresh() para que el middleware vea la cookie de sesión recién escrita.
    router.replace(nextPath);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      <Input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        label={t.auth.email}
        placeholder="tu@restaurante.com"
        icon={<Mail className="h-4 w-4" />}
        autoComplete="email"
        required
      />
      <Input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        label={t.auth.password}
        placeholder="••••••••"
        icon={<Lock className="h-4 w-4" />}
        autoComplete="current-password"
        required
        error={error}
      />

      <Button type="submit" size="block" loading={loading} className="mt-6">
        {t.auth.signIn}
      </Button>
    </form>
  );
}
