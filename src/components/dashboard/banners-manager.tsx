'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ImageIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { Sheet, ConfirmDialog } from '@/components/ui/sheet';
import { Input, Switch } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ImagePicker } from '@/components/ui/image-picker';
import { saveBanner, deleteBanner } from '@/app/dashboard/actions';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

export type ManagedBanner = {
  id: string;
  title: string | null;
  subtitle: string | null;
  imageUrl: string;
  linkUrl: string | null;
  position: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
};

type Draft = Omit<ManagedBanner, 'id' | 'imageUrl'> & { id?: string; imageUrl: string | null };

/** Convierte un timestamp ISO al valor que espera <input type="datetime-local">. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function BannersManager({
  restaurantId,
  restaurantSlug,
  banners,
}: {
  restaurantId: string;
  restaurantSlug: string;
  banners: ManagedBanner[];
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!draft?.imageUrl) {
      toast(t.common.image, 'error');
      return;
    }
    setSaving(true);

    const result = await saveBanner({
      id: draft.id,
      title: draft.title || null,
      subtitle: draft.subtitle || null,
      image_url: draft.imageUrl,
      link_url: draft.linkUrl || `/r/${restaurantSlug}`,
      position: draft.position,
      is_active: draft.isActive,
      starts_at: draft.startsAt,
      ends_at: draft.endsAt,
    });

    setSaving(false);
    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    toast(t.common.save, 'success');
    setDraft(null);
    router.refresh();
  }

  async function remove() {
    if (!confirmId) return;
    setSaving(true);
    const result = await deleteBanner(confirmId);
    setSaving(false);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    setConfirmId(null);
    router.refresh();
  }

  return (
    <>
      <div className="flex justify-end">
        <Button
          onClick={() =>
            setDraft({
              title: '',
              subtitle: '',
              imageUrl: null,
              linkUrl: `/r/${restaurantSlug}`,
              position: banners.length,
              isActive: true,
              startsAt: null,
              endsAt: null,
            })
          }
        >
          <Plus className="h-4 w-4" />
          {t.dashboard.newBanner}
        </Button>
      </div>

      {banners.length === 0 ? (
        <EmptyState
          icon={<ImageIcon className="h-7 w-7" />}
          title={t.common.empty}
          description={t.dashboard.bannerHint}
          className="rounded-2xl bg-white shadow-chip"
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {banners.map((banner) => (
            <li key={banner.id} className="overflow-hidden rounded-2xl bg-white shadow-chip">
              <div className="relative aspect-[16/8] bg-surface-muted">
                <Image
                  src={banner.imageUrl}
                  alt={banner.title ?? ''}
                  fill
                  sizes="(max-width: 768px) 100vw, 400px"
                  className={cn('object-cover', !banner.isActive && 'opacity-50 grayscale')}
                />
                <span className="absolute inset-0 bg-gradient-to-t from-ink/80 to-transparent" />
                <span className="absolute inset-x-0 bottom-0 p-4">
                  {banner.title && (
                    <span className="block font-display text-base font-bold text-white">
                      {banner.title}
                    </span>
                  )}
                  {banner.subtitle && (
                    <span className="mt-0.5 block line-clamp-1 text-xs text-white/75">
                      {banner.subtitle}
                    </span>
                  )}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 p-4">
                <div className="flex flex-wrap gap-1.5">
                  {!banner.isActive && <Badge tone="neutral">{t.common.inactive}</Badge>}
                  {banner.endsAt && (
                    <Badge tone="warning">
                      {t.admin.expiresOn} {new Date(banner.endsAt).toLocaleDateString()}
                    </Badge>
                  )}
                </div>

                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        id: banner.id,
                        title: banner.title,
                        subtitle: banner.subtitle,
                        imageUrl: banner.imageUrl,
                        linkUrl: banner.linkUrl,
                        position: banner.position,
                        isActive: banner.isActive,
                        startsAt: banner.startsAt,
                        endsAt: banner.endsAt,
                      })
                    }
                    aria-label={t.common.edit}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-surface-field hover:text-ink"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(banner.id)}
                    aria-label={t.common.delete}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-red-50 hover:text-state-danger"
                  >
                    <Trash2 className="h-4 w-4" />
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
        title={draft?.id ? t.common.edit : t.dashboard.newBanner}
        footer={
          <Button size="block" loading={saving} onClick={submit}>
            {t.common.save}
          </Button>
        }
      >
        {draft && (
          <div className="space-y-5">
            <ImagePicker
              bucket="restaurants"
              folder={restaurantId}
              value={draft.imageUrl}
              onChange={(url) => setDraft({ ...draft, imageUrl: url })}
              label={t.common.image}
              hint="Proporción recomendada 16:8 (por ejemplo 1200 × 600)."
            />

            <Input
              value={draft.title ?? ''}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              label={t.common.name}
              placeholder="2x1 en pizzas los martes"
              maxLength={80}
            />
            <Input
              value={draft.subtitle ?? ''}
              onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
              label={t.common.description}
              placeholder="Solo en pedidos a domicilio"
              maxLength={160}
            />
            <Input
              value={draft.linkUrl ?? ''}
              onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })}
              label="Enlace"
              placeholder={`/r/${restaurantSlug}`}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className="label">Desde ({t.common.optional})</span>
                <input
                  type="datetime-local"
                  value={toLocalInput(draft.startsAt)}
                  onChange={(e) => setDraft({ ...draft, startsAt: fromLocalInput(e.target.value) })}
                  className="field"
                />
              </div>
              <div>
                <span className="label">Hasta ({t.common.optional})</span>
                <input
                  type="datetime-local"
                  value={toLocalInput(draft.endsAt)}
                  onChange={(e) => setDraft({ ...draft, endsAt: fromLocalInput(e.target.value) })}
                  className="field"
                />
              </div>
            </div>

            <Switch
              checked={draft.isActive}
              onChange={(v) => setDraft({ ...draft, isActive: v })}
              label={t.common.active}
            />
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={remove}
        title={t.common.delete}
        message={t.common.confirm}
        confirmLabel={t.common.delete}
        cancelLabel={t.common.cancel}
        loading={saving}
      />
    </>
  );
}
