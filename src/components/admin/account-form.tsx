'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { KeyRound, Mail } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { updateOwnAdminAccount } from '@/app/admin/actions';
import { useT } from '@/i18n/provider';

/**
 * Datos de acceso del superadmin.
 *
 * El cambio de contraseña se hace desde el navegador y exige la actual: sin esa
 * comprobación, cualquiera que encontrara la sesión abierta en un ordenador
 * podría quedarse con la cuenta que gobierna toda la plataforma.
 */
export function AdminAccountForm({ fullName, email }: { fullName: string; email: string }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  const [datos, setDatos] = useState({ fullName, email });
  const [guardando, setGuardando] = useState(false);

  const [claves, setClaves] = useState({ actual: '', nueva: '', repetida: '' });
  const [cambiando, setCambiando] = useState(false);
  const [errorClave, setErrorClave] = useState<string | null>(null);

  async function guardarDatos() {
    setGuardando(true);
    const result = await updateOwnAdminAccount(datos);
    setGuardando(false);

    if (!result.ok) {
      toast(result.error === 'EMAIL_TAKEN' ? t.admin.emailTaken : t.common.error, 'error');
      return;
    }
    toast(t.admin.accountSaved, 'success');
    router.refresh();
  }

  async function cambiarClave() {
    setErrorClave(null);

    if (claves.nueva.length < 8) {
      setErrorClave(t.auth.passwordTooShort);
      return;
    }
    if (claves.nueva !== claves.repetida) {
      setErrorClave(t.auth.passwordsDontMatch);
      return;
    }

    setCambiando(true);
    const supabase = createClient();

    // Entrar de nuevo con la contraseña actual es lo que confirma que quien
    // está delante del teclado es el titular de la cuenta.
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: datos.email,
      password: claves.actual,
    });

    if (authError) {
      setCambiando(false);
      setErrorClave(t.admin.wrongCurrentPassword);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: claves.nueva });
    setCambiando(false);

    if (error) {
      setErrorClave(t.common.error);
      return;
    }

    setClaves({ actual: '', nueva: '', repetida: '' });
    toast(t.auth.resetDone, 'success');
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl bg-white p-6 shadow-chip">
        <h2 className="mb-1 flex items-center gap-2 font-display text-base font-bold text-ink-700">
          <Mail className="h-4 w-4 text-ink-300" />
          {t.admin.accountData}
        </h2>
        <p className="mb-5 text-xs text-ink-300">{t.team.emailChangeHint}</p>

        <div className="space-y-4">
          <Input
            label={t.common.name}
            value={datos.fullName}
            onChange={(e) => setDatos({ ...datos, fullName: e.target.value })}
          />
          <Input
            label={t.auth.email}
            type="email"
            value={datos.email}
            onChange={(e) => setDatos({ ...datos, email: e.target.value })}
          />
          <Button
            size="block"
            loading={guardando}
            onClick={guardarDatos}
            disabled={!datos.fullName.trim() || !datos.email.trim()}
          >
            {t.common.save}
          </Button>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-chip">
        <h2 className="mb-1 flex items-center gap-2 font-display text-base font-bold text-ink-700">
          <KeyRound className="h-4 w-4 text-ink-300" />
          {t.admin.changePassword}
        </h2>
        <p className="mb-5 text-xs text-ink-300">{t.admin.changePasswordHint}</p>

        <div className="space-y-4">
          <Input
            label={t.admin.currentPassword}
            type="password"
            autoComplete="current-password"
            value={claves.actual}
            onChange={(e) => setClaves({ ...claves, actual: e.target.value })}
          />
          <Input
            label={t.auth.password}
            type="password"
            autoComplete="new-password"
            value={claves.nueva}
            onChange={(e) => setClaves({ ...claves, nueva: e.target.value })}
          />
          <Input
            label={t.auth.confirmPassword}
            type="password"
            autoComplete="new-password"
            value={claves.repetida}
            onChange={(e) => setClaves({ ...claves, repetida: e.target.value })}
            error={errorClave}
          />
          <Button
            size="block"
            variant="outline"
            loading={cambiando}
            onClick={cambiarClave}
            disabled={!claves.actual || !claves.nueva}
          >
            {t.admin.changePassword}
          </Button>
        </div>
      </section>
    </div>
  );
}
