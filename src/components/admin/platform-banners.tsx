'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ImageIcon, Pencil, Pin, Plus, Trash2 } from 'lucide-react';
import { Input, Switch } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Sheet, ConfirmDialog } from '@/components/ui/sheet';
import { Badge, EmptyState } from '@/components/ui/misc';
import { ImagePicker } from '@/components/ui/image-picker';
import { useToast } from '@/components/ui/toast';
import {
  savePlatformBanner,
  deletePlatformBanner,
  updateBannerRotation,
} from '@/app/admin/actions';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

type Banner = {
  id: string;
  title: string | null;
  subtitle: string | null;
  imageUrl: string;
  linkUrl: string | null;
  isActive: boolean;
  isPinned: boolean;
  pinnedCities: string[];
  position: number;
};

type Ciudad = { slug: string; name: string };

const VACIO = {
  id: undefined as string | undefined,
  title: '',
  subtitle: '',
  imageUrl: '',
  linkUrl: '',
  isActive: true,
  isPinned: false,
  pinnedCities: [] as string[],
  position: 0,
};

export function PlatformBanners({
  banners,
  cities,
  rotationSeconds,
}: {
  banners: Banner[];
  cities: Ciudad[];
  rotationSeconds: number;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  const [draft, setDraft] = useState<typeof VACIO | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(rotationSeconds);

  function abrir(banner?: Banner) {
    setDraft(
      banner
        ? {
            id: banner.id,
            title: banner.title ?? '',
            subtitle: banner.subtitle ?? '',
            imageUrl: banner.imageUrl,
            linkUrl: banner.linkUrl ?? '',
            isActive: banner.isActive,
            isPinned: banner.isPinned,
            pinnedCities: banner.pinnedCities,
            position: banner.position,
          }
        : { ...VACIO },
    );
  }

  async function guardar() {
    if (!draft?.imageUrl) return;
    setSaving(true);
    const result = await savePlatformBanner({
      id: draft.id,
      title: draft.title || null,
      subtitle: draft.subtitle || null,
      image_url: draft.imageUrl,
      link_url: draft.linkUrl || null,
      is_active: draft.isActive,
      is_pinned: draft.isPinned,
      pinned_cities: draft.pinnedCities,
      position: draft.position,
    });
    setSaving(false);

    if (!result.ok) {
      toast(result.error ?? t.common.error, 'error');
      return;
    }
    setDraft(null);
    router.refresh();
  }

  async function borrar() {
    if (!confirmId) return;
    setSaving(true);
    const result = await deletePlatformBanner(confirmId);
    setSaving(false);
    setConfirmId(null);
    if (!result.ok) {
      toast(result.error ?? t.common.error, 'error');
      return;
    }
    router.refresh();
  }

  async function guardarRotacion(valor: number) {
    setSegundos(valor);
    const result = await updateBannerRotation(valor);
    if (!result.ok) toast(t.common.error, 'error');
  }

  function alternarCiudad(slug: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      pinnedCities: draft.pinnedCities.includes(slug)
        ? draft.pinnedCities.filter((c) => c !== slug)
        : [...draft.pinnedCities, slug],
    });
  }

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-4 rounded-2xl bg-white p-5 shadow-chip">
        <div className="w-full max-w-[220px]">
          <Input
            type="number"
            min={2}
            max={30}
            label={t.admin.rotationSeconds}
            value={segundos}
            onChange={(e) => setSegundos(Number(e.target.value))}
            onBlur={(e) => guardarRotacion(Number(e.target.value))}
            hint={t.admin.rotationHint}
          />
        </div>

        <Button onClick={() => abrir()}>
          <Plus className="h-4 w-4" />
          {t.admin.newBanner}
        </Button>
      </section>

      {banners.length === 0 ? (
        <EmptyState icon={<ImageIcon className="h-7 w-7" />} title={t.admin.noBanners} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {banners.map((banner) => (
            <li key={banner.id} className="overflow-hidden rounded-2xl bg-white shadow-chip">
              <div className="relative aspect-[16/8] bg-surface-muted">
                <Image
                  src={banner.imageUrl}
                  alt={banner.title ?? ''}
                  fill
                  sizes="(max-width: 640px) 100vw, 380px"
                  className="object-cover"
                />
                {banner.isPinned && (
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-[11px] font-bold text-brand-contrast">
                    <Pin className="h-3 w-3" />
                    {t.admin.pinFirst}
                  </span>
                )}
              </div>

              <div className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink-700">
                      {banner.title || '—'}
                    </p>
                    <p className="truncate text-xs text-ink-300">
                      {banner.pinnedCities.length === 0
                        ? t.admin.pinnedAllCities
                        : banner.pinnedCities
                            .map((slug) => cities.find((c) => c.slug === slug)?.name ?? slug)
                            .join(' · ')}
                    </p>
                  </div>
                  <Badge tone={banner.isActive ? 'success' : 'neutral'}>
                    {banner.isActive ? t.common.active : t.common.inactive}
                  </Badge>
                </div>

                <div className="flex gap-1 pt-1">
                  <button
                    type="button"
                    onClick={() => abrir(banner)}
                    className="btn-ghost text-xs"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {t.common.edit}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(banner.id)}
                    className="btn text-xs text-state-danger hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? t.common.edit : t.admin.newBanner}
        footer={
          <Button size="block" loading={saving} onClick={guardar} disabled={!draft?.imageUrl}>
            {t.common.save}
          </Button>
        }
      >
        {draft && (
          <div className="space-y-5">
            <ImagePicker
              bucket="restaurants"
              folder="app"
              label={t.common.image}
              value={draft.imageUrl || null}
              onChange={(url) => setDraft({ ...draft, imageUrl: url ?? '' })}
              recommended={{ width: 1200, height: 600 }}
            />

            <Input
              label={t.common.title}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <Input
              label={t.common.subtitle}
              value={draft.subtitle}
              onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
            />
            <Input
              label={t.common.link}
              value={draft.linkUrl}
              onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })}
              placeholder="https://"
            />

            <Switch
              checked={draft.isActive}
              onChange={(isActive) => setDraft({ ...draft, isActive })}
              label={t.common.active}
            />
            <Switch
              checked={draft.isPinned}
              onChange={(isPinned) => setDraft({ ...draft, isPinned })}
              label={t.admin.pinFirst}
            />

            <div>
              <span className="label">{t.admin.pinnedCities}</span>
              <p className="mb-2 text-xs text-ink-300">{t.admin.pinnedAllCities}</p>
              <div className="flex flex-wrap gap-2">
                {cities.map((ciudad) => {
                  const activa = draft.pinnedCities.includes(ciudad.slug);
                  return (
                    <button
                      key={ciudad.slug}
                      type="button"
                      onClick={() => alternarCiudad(ciudad.slug)}
                      className={cn(
                        'rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors',
                        activa
                          ? 'border-brand bg-brand text-brand-contrast'
                          : 'border-surface-line text-ink-400 hover:border-brand hover:text-brand',
                      )}
                    >
                      {ciudad.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={borrar}
        title={t.common.delete}
        message={t.common.confirm}
        confirmLabel={t.common.delete}
        cancelLabel={t.common.cancel}
        loading={saving}
      />
    </>
  );
}
