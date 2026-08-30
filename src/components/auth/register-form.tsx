'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Lock, Mail, Store, User } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n/provider';

export function RegisterForm() {
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
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim(), role: 'restaurant' } },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // Sin sesión inmediata → la instancia exige confirmar el correo.
    if (!data.session) {
      toast(t.auth.checkEmail, 'info');
      setLoading(false);
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
        label={t.auth.fullName}
        icon={<User className="h-4 w-4" />}
        autoComplete="name"
        required
      />
      <Input
        value={restaurantName}
        onChange={(e) => setRestaurantName(e.target.value)}
        label={t.auth.restaurantName}
        icon={<Store className="h-4 w-4" />}
        placeholder="La Trattoria"
        required
      />
      <Input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        label={t.auth.email}
        icon={<Mail className="h-4 w-4" />}
        autoComplete="email"
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
        {t.auth.signUpCta}
      </Button>
    </form>
  );
}
