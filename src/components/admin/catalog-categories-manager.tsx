'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowDown, ArrowUp, LayoutGrid, Pencil, Plus, Trash2 } from 'lucide-react';
import { Sheet, ConfirmDialog } from '@/components/ui/sheet';
import { Input, Switch, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { saveCatalogCategory, deleteCatalogCategory } from '@/app/admin/actions';
import { slugify } from '@/lib/utils';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

export type CatalogCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  position: number;
  isActive: boolean;
  products: number;
};

type Draft = Omit<CatalogCategory, 'id' | 'products'> & { id?: string };

export function CatalogCategoriesManager({ categories }: { categories: CatalogCategory[] }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // El identificador solo se autocompleta desde el nombre mientras nadie lo toque.
  const [slugTouched, setSlugTouched] = useState(false);

  async function submit() {
    if (!draft?.name.trim() || !draft.slug.trim()) {
      toast(t.common.required, 'error');
      return;
    }

    setSaving(true);
    const result = await saveCatalogCategory({
      id: draft.id,
      name: draft.name.trim(),
      slug: draft.slug.trim(),
      description: draft.description || null,
      image_url: draft.imageUrl || null,
      position: draft.position,
      is_active: draft.isActive,
    });
    setSaving(false);

    if (!result.ok) {
      toast(result.error === 'SLUG_TAKEN' ? t.catalog.slugTaken : t.common.error, 'error');
      return;
    }
    toast(t.common.save, 'success');
    setDraft(null);
    router.refresh();
  }

  async function move(category: CatalogCategory, delta: number) {
    const target = categories.find(
      (other) => other.position === category.position + delta,
    );
    // Intercambia posiciones con la vecina, si la hay.
    await saveCatalogCategory({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      image_url: category.imageUrl,
      position: category.position + delta,
      is_active: category.isActive,
    });
    if (target) {
      await saveCatalogCategory({
        id: target.id,
        name: target.name,
        slug: target.slug,
        description: target.description,
        image_url: target.imageUrl,
        position: category.position,
        is_active: target.isActive,
      });
    }
    router.refresh();
  }

  async function remove() {
    if (!confirmId) return;
    setSaving(true);
    const result = await deleteCatalogCategory(confirmId);
    setSaving(false);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    setConfirmId(null);
    router.refresh();
  }

  const pendingDelete = categories.find((category) => category.id === confirmId);

  return (
    <>
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setSlugTouched(false);
            setDraft({
              name: '',
              slug: '',
              description: '',
              imageUrl: null,
              position: categories.length + 1,
              isActive: true,
            });
          }}
        >
          <Plus className="h-4 w-4" />
          {t.catalog.newCategory}
        </Button>
      </div>

      {categories.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="h-7 w-7" />}
          title={t.catalog.noCategories}
          description={t.catalog.noCategoriesHint}
          className="rounded-2xl bg-white shadow-chip"
        />
      ) : (
        <ul className="stagger space-y-3">
          {categories.map((category, index) => (
            <li
              key={category.id}
              className={cn(
                'flex flex-wrap items-center gap-4 rounded-2xl bg-white p-4 shadow-chip transition-opacity',
                !category.isActive && 'opacity-60',
              )}
            >
              <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
                {category.imageUrl ? (
                  <Image src={category.imageUrl} alt="" fill sizes="56px" className="object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-ink-200">
                    <LayoutGrid className="h-5 w-5" />
                  </span>
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-base font-bold text-ink-700">
                  {category.name}
                </p>
                <p className="truncate text-xs text-ink-300">
                  <code className="font-mono">{category.slug}</code> · {category.products}{' '}
                  {t.catalog.usedBy}
                </p>
              </div>

              {!category.isActive && <Badge tone="neutral">{t.common.inactive}</Badge>}

              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => move(category, -1)}
                  disabled={index === 0}
                  aria-label="Subir"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-surface-field hover:text-ink disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(category, 1)}
                  disabled={index === categories.length - 1}
                  aria-label="Bajar"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-surface-field hover:text-ink disabled:opacity-30"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSlugTouched(true);
                    setDraft({ ...category });
                  }}
                  aria-label={t.common.edit}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-surface-field hover:text-ink"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmId(category.id)}
                  aria-label={t.common.delete}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-red-50 hover:text-state-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? t.common.edit : t.catalog.newCategory}
        footer={
          <Button size="block" loading={saving} onClick={submit}>
            {t.common.save}
          </Button>
        }
      >
        {draft && (
          <div className="space-y-5">
            <Input
              value={draft.name}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  name: e.target.value,
                  slug: slugTouched ? draft.slug : slugify(e.target.value),
                })
              }
              label={t.common.name}
              placeholder="Pizzas"
              maxLength={60}
              required
            />
            <Input
              value={draft.slug}
              onChange={(e) => {
                setSlugTouched(true);
                setDraft({ ...draft, slug: slugify(e.target.value) });
              }}
              label={t.catalog.slug}
              hint={t.catalog.slugHint}
              placeholder="pizzas"
              className="font-mono"
              maxLength={60}
              required
            />
            <Textarea
              value={draft.description ?? ''}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              label={t.common.description}
              rows={2}
              maxLength={200}
            />
            <Input
              value={draft.imageUrl ?? ''}
              onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
              label={`${t.common.image} (URL)`}
              placeholder="https://…"
            />
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
        message={
          pendingDelete && pendingDelete.products > 0
            ? `${pendingDelete.products} ${t.catalog.usedBy}. ${t.catalog.deleteWarning}`
            : t.common.confirm
        }
        confirmLabel={t.common.delete}
        cancelLabel={t.common.cancel}
        loading={saving}
      />
    </>
  );
}
