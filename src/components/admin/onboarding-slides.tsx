'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { GripVertical, ImageIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { Input, Textarea, Switch } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Sheet, ConfirmDialog } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/misc';
import { ImagePicker } from '@/components/ui/image-picker';
import { useToast } from '@/components/ui/toast';
import { saveOnboardingSlide, deleteOnboardingSlide } from '@/app/admin/actions';
import { useT } from '@/i18n/provider';

export type Slide = {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  position: number;
  isActive: boolean;
};

const VACIA = {
  id: undefined as string | undefined,
  title: '',
  subtitle: '',
  imageUrl: null as string | null,
  position: 0,
  isActive: true,
};

/**
 * Las pantallas que explican la aplicación al abrirla por primera vez.
 *
 * Se pueden desactivar de una en una o todas a la vez desde el interruptor de
 * la pantalla de bienvenida: quien ya tiene cuenta no las ve nunca, porque a
 * esas alturas ya sabe lo que es la aplicación.
 */
export function OnboardingSlides({ slides }: { slides: Slide[] }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  const [draft, setDraft] = useState<typeof VACIA | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function guardar() {
    if (!draft?.title.trim()) return;
    setSaving(true);
    const result = await saveOnboardingSlide({
      id: draft.id,
      title: draft.title,
      subtitle: draft.subtitle || null,
      image_url: draft.imageUrl,
      position: draft.position,
      is_active: draft.isActive,
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
    const result = await deleteOnboardingSlide(confirmId);
    setSaving(false);
    setConfirmId(null);
    if (!result.ok) {
      toast(result.error ?? t.common.error, 'error');
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4 rounded-xl bg-surface-field p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-ink-700">{t.admin.introSlides}</h3>
          <p className="text-xs text-ink-300">{t.admin.introSlidesHint}</p>
        </div>
        <button
          type="button"
          onClick={() => setDraft({ ...VACIA, position: slides.length })}
          className="btn-ghost shrink-0 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          {t.common.create}
        </button>
      </div>

      {slides.length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-300">{t.admin.noSlides}</p>
      ) : (
        <ul className="space-y-2">
          {slides.map((slide) => (
            <li
              key={slide.id}
              className="flex items-center gap-3 rounded-lg bg-white p-2.5 shadow-chip"
            >
              <GripVertical className="h-4 w-4 shrink-0 text-ink-200" />

              <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-surface-field">
                {slide.imageUrl ? (
                  <Image src={slide.imageUrl} alt="" fill sizes="40px" className="object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-ink-300">
                    <ImageIcon className="h-4 w-4" />
                  </span>
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink-700">
                  {slide.title}
                </span>
                <span className="block truncate text-xs text-ink-300">{slide.subtitle}</span>
              </span>

              {!slide.isActive && <Badge tone="neutral">{t.common.inactive}</Badge>}

              <button
                type="button"
                onClick={() =>
                  setDraft({
                    id: slide.id,
                    title: slide.title,
                    subtitle: slide.subtitle ?? '',
                    imageUrl: slide.imageUrl,
                    position: slide.position,
                    isActive: slide.isActive,
                  })
                }
                aria-label={t.common.edit}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-300 hover:bg-surface-field hover:text-ink"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setConfirmId(slide.id)}
                aria-label={t.common.delete}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-300 hover:bg-red-50 hover:text-state-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? t.common.edit : t.admin.introSlides}
        footer={
          <Button size="block" loading={saving} onClick={guardar} disabled={!draft?.title.trim()}>
            {t.common.save}
          </Button>
        }
      >
        {draft && (
          <div className="space-y-4">
            <ImagePicker
              bucket="restaurants"
              folder="app"
              label={t.common.image}
              value={draft.imageUrl}
              onChange={(url) => setDraft({ ...draft, imageUrl: url })}
              recommended={{ width: 800, height: 800 }}
            />
            <Input
              label={t.common.title}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <Textarea
              label={t.common.subtitle}
              rows={2}
              value={draft.subtitle}
              onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
            />
            <Input
              type="number"
              min={0}
              label={t.admin.position}
              value={draft.position}
              onChange={(e) => setDraft({ ...draft, position: Number(e.target.value) })}
            />
            <Switch
              checked={draft.isActive}
              onChange={(isActive) => setDraft({ ...draft, isActive })}
              label={t.common.active}
            />
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
    </div>
  );
}
