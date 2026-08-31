'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Camera, KeyRound, Loader2, Mail, MapPin, Phone, User } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { updateOwnProfile } from '@/app/actions/profile';
import { useT } from '@/i18n/provider';
import { initials } from '@/lib/utils';

type Valores = {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  avatarUrl: string | null;
};

/**
 * Datos de la cuenta de un cliente.
 *
 * La contraseña se cambia aparte y pidiendo la actual: es la comprobación de
 * que quien está delante del teclado es el titular, y no alguien que se ha
 * encontrado la sesión abierta.
 */
export function ProfileForm({ initial }: { initial: Valores }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [claves, setClaves] = useState({ actual: '', nueva: '' });
  const [cambiando, setCambiando] = useState(false);

  function set<K extends keyof Valores>(key: K, value: Valores[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function subirFoto(file: File) {
    setUploading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const extension = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
      // Carpeta por usuario: las políticas del almacén sólo dejan escribir en la propia.
      const path = `avatars/${user.id}/${crypto.randomUUID()}.${extension}`;

      const { error } = await supabase.storage.from('restaurants').upload(path, file, {
        cacheControl: '31536000',
        upsert: false,
        contentType: file.type || undefined,
      });
      if (error) {
        toast(`${t.common.error}: ${error.message}`, 'error');
        return;
      }

      const { data } = supabase.storage.from('restaurants').getPublicUrl(path);
      set('avatarUrl', data.publicUrl);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function guardar() {
    setSaving(true);
    const result = await updateOwnProfile(values);
    setSaving(false);

    if (!result.ok) {
      toast(result.error === 'EMAIL_TAKEN' ? t.auth.emailTaken : t.common.error, 'error');
      return;
    }
    toast(t.account.saved, 'success');
    router.refresh();
  }

  async function cambiarClave() {
    if (claves.nueva.length < 8) {
      toast(t.auth.passwordTooShort, 'error');
      return;
    }

    setCambiando(true);
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: claves.actual,
    });

    if (authError) {
      setCambiando(false);
      toast(t.admin.wrongCurrentPassword, 'error');
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: claves.nueva });
    setCambiando(false);

    if (error) {
      toast(t.common.error, 'error');
      return;
    }
    setClaves({ actual: '', nueva: '' });
    toast(t.auth.resetDone, 'success');
  }

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-2xl bg-white p-5 shadow-chip">
        <div className="flex items-center gap-4">
          <span className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-surface-field">
            {values.avatarUrl ? (
              <Image src={values.avatarUrl} alt="" fill sizes="80px" className="object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center font-display text-xl font-bold text-ink-300">
                {initials(values.fullName || values.email)}
              </span>
            )}
            {uploading && (
              <span className="absolute inset-0 flex items-center justify-center bg-white/80">
                <Loader2 className="h-5 w-5 animate-spin text-brand" />
              </span>
            )}
          </span>

          <div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="btn-ghost text-xs"
            >
              <Camera className="h-3.5 w-3.5" />
              {t.account.changePhoto}
            </button>
            {values.avatarUrl && (
              <button
                type="button"
                onClick={() => set('avatarUrl', null)}
                className="ml-1 text-xs font-semibold text-ink-300 hover:text-state-danger"
              >
                {t.common.delete}
              </button>
            )}
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void subirFoto(file);
          }}
        />

        <div className="mt-5 space-y-4">
          <Input
            label={t.auth.fullName}
            value={values.fullName}
            onChange={(e) => set('fullName', e.target.value)}
            icon={<User className="h-4 w-4" />}
          />
          <Input
            label={t.auth.email}
            type="email"
            value={values.email}
            onChange={(e) => set('email', e.target.value)}
            icon={<Mail className="h-4 w-4" />}
            hint={t.team.emailChangeHint}
          />
          <Input
            label={t.auth.phone}
            type="tel"
            value={values.phone}
            onChange={(e) => set('phone', e.target.value)}
            icon={<Phone className="h-4 w-4" />}
          />
          <Input
            label={t.account.deliveryAddress}
            value={values.address}
            onChange={(e) => set('address', e.target.value)}
            icon={<MapPin className="h-4 w-4" />}
            hint={t.account.deliveryAddressHint}
          />
          <Input
            label={t.account.city}
            value={values.city}
            onChange={(e) => set('city', e.target.value)}
          />

          <Button size="block" loading={saving} onClick={guardar} disabled={!values.fullName.trim()}>
            {t.common.save}
          </Button>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-chip">
        <h2 className="mb-1 flex items-center gap-2 font-display text-base font-bold text-ink-700">
          <KeyRound className="h-4 w-4 text-ink-300" />
          {t.admin.changePassword}
        </h2>
        <p className="mb-4 text-xs text-ink-300">{t.admin.changePasswordHint}</p>

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
