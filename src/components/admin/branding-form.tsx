'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { ImageIcon, Loader2, ShoppingBag, Trash2, Upload } from 'lucide-react';
import { Input, Textarea, Switch } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ColorInput } from '@/components/ui/color-input';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { updateBranding } from '@/app/admin/actions';
import { brandCssVariables } from '@/lib/brand-theme';
import type { Brand } from '@/lib/brand';
import type { AuthScreens } from '@/lib/auth-screens';
import { useT } from '@/i18n/provider';

export function BrandingForm({
  initial,
  initialScreens,
}: {
  initial: Brand;
  initialScreens: AuthScreens;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  const [values, setValues] = useState(initial);
  const [screens, setScreens] = useState(initialScreens);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof Brand>(key: K, value: Brand[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function setScreen(patch: Partial<AuthScreens>) {
    setScreens((current) => ({ ...current, ...patch }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);

    const result = await updateBranding({
      app_name: values.appName,
      tagline: values.tagline,
      description: values.description,
      logo_url: values.logoUrl,
      icon_url: values.iconUrl,
      primary_color: values.primaryColor,
      accent_color: values.accentColor,
      text_color: values.textColor,

      login_image_url: screens.loginImageUrl,
      login_title: screens.loginTitle || null,
      login_subtitle: screens.loginSubtitle || null,
      register_image_url: screens.registerImageUrl,
      register_title: screens.registerTitle || null,
      register_subtitle: screens.registerSubtitle || null,
      splash_image_url: screens.splashImageUrl,
      splash_title: screens.splashTitle || null,
      splash_subtitle: screens.splashSubtitle || null,
      splash_enabled: screens.splashEnabled,
    });

    setSaving(false);
    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    toast(t.common.save, 'success');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 xl:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <section className="space-y-5 rounded-2xl bg-white p-6 shadow-chip">
          <h2 className="font-display text-base font-bold text-ink-700">{t.admin.appName}</h2>

          <Input
            value={values.appName}
            onChange={(e) => set('appName', e.target.value)}
            label={t.admin.appName}
            maxLength={40}
            required
          />
          <Input
            value={values.tagline}
            onChange={(e) => set('tagline', e.target.value)}
            label={t.admin.tagline}
            maxLength={120}
            required
          />
          <Textarea
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            label={t.admin.appDescription}
            rows={3}
            maxLength={400}
            required
            hint="Se usa en los buscadores, al compartir el enlace y en la ficha de instalación."
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <BrandAsset
              label={t.admin.logo}
              value={values.logoUrl}
              onChange={(url) => set('logoUrl', url)}
            />
            <BrandAsset
              label={t.admin.appIcon}
              value={values.iconUrl}
              onChange={(url) => set('iconUrl', url)}
              hint="Cuadrado, mínimo 512 × 512"
            />
          </div>
        </section>

        <section className="space-y-5 rounded-2xl bg-white p-6 shadow-chip">
          <h2 className="font-display text-base font-bold text-ink-700">{t.admin.colors}</h2>
          <div className="grid gap-5 sm:grid-cols-3">
            <ColorInput
              label={t.admin.primaryColor}
              value={values.primaryColor}
              onChange={(v) => set('primaryColor', v)}
              hint="Botones y acentos"
            />
            <ColorInput
              label={t.admin.accentColor}
              value={values.accentColor}
              onChange={(v) => set('accentColor', v)}
              hint="Chips y destacados"
            />
            <ColorInput
              label={t.admin.textColor}
              value={values.textColor}
              onChange={(v) => set('textColor', v)}
              hint="Titulares"
            />
          </div>
        </section>

        <section className="space-y-6 rounded-2xl bg-white p-6 shadow-chip">
          <div>
            <h2 className="font-display text-base font-bold text-ink-700">
              {t.admin.authScreens}
            </h2>
            <p className="mt-1 text-xs text-ink-300">{t.admin.authScreensHint}</p>
          </div>

          {(
            [
              ['splash', t.admin.splashScreen, 'splashImageUrl', 'splashTitle', 'splashSubtitle'],
              ['login', t.admin.loginScreen, 'loginImageUrl', 'loginTitle', 'loginSubtitle'],
              ['register', t.admin.registerScreen, 'registerImageUrl', 'registerTitle', 'registerSubtitle'],
            ] as const
          ).map(([clave, titulo, campoImagen, campoTitulo, campoSubtitulo]) => (
            <div key={clave} className="space-y-4 rounded-xl bg-surface-field p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-ink-700">{titulo}</h3>
                {clave === 'splash' && (
                  <Switch
                    checked={screens.splashEnabled}
                    onChange={(splashEnabled) => setScreen({ splashEnabled })}
                    label={t.common.active}
                  />
                )}
              </div>

              <BrandAsset
                label={t.admin.screenImage}
                value={screens[campoImagen]}
                onChange={(url) => setScreen({ [campoImagen]: url } as Partial<AuthScreens>)}
                hint={t.admin.screenImageHint}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label={t.admin.screenTitle}
                  value={screens[campoTitulo] ?? ''}
                  onChange={(e) => setScreen({ [campoTitulo]: e.target.value } as Partial<AuthScreens>)}
                  placeholder={t.admin.screenTitlePlaceholder}
                />
                <Input
                  label={t.admin.screenSubtitle}
                  value={screens[campoSubtitulo] ?? ''}
                  onChange={(e) => setScreen({ [campoSubtitulo]: e.target.value } as Partial<AuthScreens>)}
                />
              </div>
            </div>
          ))}
        </section>

        <Button type="submit" size="lg" loading={saving}>
          {t.common.save}
        </Button>
      </div>

      {/* Vista previa en vivo: usa las mismas variables CSS que la app real. */}
      <aside className="xl:sticky xl:top-6 xl:self-start">
        <p className="label">{t.admin.preview}</p>
        <div
          className="overflow-hidden rounded-2xl border border-surface-line bg-white shadow-chip"
          style={brandCssVariables(values) as React.CSSProperties}
        >
          <div className="flex items-center gap-2.5 border-b border-surface-line px-4 py-3">
            {values.logoUrl ? (
              <Image src={values.logoUrl} alt="" width={28} height={28} className="rounded-lg" />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-xs font-bold text-brand-contrast">
                {values.appName.charAt(0) || '?'}
              </span>
            )}
            <span className="font-display text-sm font-bold text-ink">{values.appName}</span>
          </div>

          <div className="space-y-3 p-4">
            <p className="text-sm font-semibold text-ink">{values.tagline}</p>
            <div className="flex flex-wrap gap-2">
              <span className="chip bg-accent text-accent-contrast">Pizza</span>
              <span className="chip bg-white shadow-chip">Sushi</span>
            </div>
            <button type="button" className="btn-primary w-full">
              <ShoppingBag className="h-4 w-4" />
              {t.product.addToCart}
            </button>
            <button type="button" className="btn-outline w-full">
              {t.storefront.viewMenu}
            </button>
            <p className="text-xs text-ink-300">{values.description.slice(0, 110)}…</p>
          </div>
        </div>
      </aside>
    </form>
  );
}

/** Subida de logotipo/icono al bucket público de la aplicación. */
function BrandAsset({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  hint?: string;
}) {
  const t = useT();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const supabase = createClient();
      const extension = file.name.split('.').pop()?.toLowerCase() ?? 'png';
      // Carpeta "app": las políticas de storage la reservan al superadmin.
      const path = `app/${crypto.randomUUID()}.${extension}`;

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
      onChange(data.publicUrl);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-center gap-3">
        <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-field text-ink-300">
          {value ? (
            <Image src={value} alt="" fill sizes="80px" className="object-contain p-2" />
          ) : (
            <ImageIcon className="h-6 w-6" />
          )}
          {uploading && (
            <span className="absolute inset-0 flex items-center justify-center bg-white/80">
              <Loader2 className="h-5 w-5 animate-spin text-brand" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="btn-ghost text-xs"
            >
              <Upload className="h-3.5 w-3.5" />
              {value ? t.common.edit : t.dashboard.uploadImage}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="btn text-xs text-state-danger hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {hint && <p className="mt-2 text-xs text-ink-300">{hint}</p>}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </div>
  );
}
