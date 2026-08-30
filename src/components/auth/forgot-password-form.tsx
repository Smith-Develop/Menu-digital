'use client';

import { useState, type FormEvent } from 'react';
import { CheckCircle2, Mail } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { requestPasswordReset } from '@/app/actions/password';
import { useT } from '@/i18n/provider';

export function ForgotPasswordForm() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    await requestPasswordReset(email);
    setLoading(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="mt-8 flex flex-col items-center gap-3 rounded-2xl bg-emerald-50 p-6 text-center">
        <CheckCircle2 className="h-9 w-9 text-emerald-600" />
        <p className="font-display text-base font-bold text-emerald-800">{t.auth.forgotSent}</p>
        <p className="text-sm text-emerald-700">{t.auth.forgotSentHint}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      <Input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        label={t.auth.email}
        icon={<Mail className="h-4 w-4" />}
        autoComplete="email"
        required
      />
      <Button type="submit" size="block" loading={loading}>
        {t.auth.forgotCta}
      </Button>
    </form>
  );
}
