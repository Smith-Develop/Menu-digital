'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Barcode, Box, ImageIcon, Layers, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { Sheet, ConfirmDialog } from '@/components/ui/sheet';
import { Input, Select, Switch, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { FileUpload } from '@/components/dashboard/file-upload';
import { OptionGroupsEditor } from '@/components/dashboard/option-groups-editor';
import { saveProduct, deleteProduct, toggleProductAvailability } from '@/app/dashboard/actions';
import { formatAmount, parseAmount, formatMoney } from '@/lib/money';
import { useT } from '@/i18n/provider';
import { hasModule } from '@/lib/business-modules';
import type { Enums } from '@/types/database';
import { cn } from '@/lib/utils';

/** Categoría del catálogo de la plataforma; el restaurante solo la elige. */
export type ManagedCategory = {
  id: string;
  name: string;
  imageUrl: string | null;
};

export type ManagedOptionGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  options: {
    id: string;
    name: string;
    priceDeltaCents: number;
    isDefault: boolean;
    isAvailable: boolean;
  }[];
};

export type ManagedProduct = {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  priceCents: number;
  imageUrl: string | null;
  model3dUrl: string | null;
  modelArUrl: string | null;
  modelScale: number;
  prepMinutes: number;
  calories: number | null;
  ingredients: string[];
  allergens: string[];
  tags: string[];
  isAvailable: boolean;
  isFeatured: boolean;
  position: number;
  /** Nulo usa el tipo general del restaurante. */
  taxRate: number | null;
  trackStock: boolean;
  stockQty: number;
  lowStockThreshold: number;
  /** Ficha de estantería. En una carta se queda toda a nulo y no estorba. */
  unit: Enums<'sale_unit'>;
  brand: string | null;
  packSize: string | null;
  barcode: string | null;
  netContent: number | null;
  soldByWeight: boolean;
  optionGroups: ManagedOptionGroup[];
};

type Draft = Omit<ManagedProduct, 'id' | 'optionGroups'> & { id?: string };

function emptyDraft(categoryId: string | null): Draft {
  return {
    categoryId,
    name: '',
    description: '',
    priceCents: 0,
    imageUrl: null,
    model3dUrl: null,
    modelArUrl: null,
    modelScale: 1,
    prepMinutes: 15,
    calories: null,
    ingredients: [],
    allergens: [],
    tags: [],
    isAvailable: true,
    isFeatured: false,
    position: 0,
    taxRate: null,
    trackStock: false,
    stockQty: 0,
    lowStockThreshold: 0,
    unit: 'unit',
    brand: null,
    packSize: null,
    barcode: null,
    netContent: null,
    soldByWeight: false,
  };
}

export function MenuManager({
  restaurantId,
  businessType,
  currency,
  currencyDecimals,
  allows3d,
  categories,
  products,
}: {
  restaurantId: string;
  businessType: Enums<'business_type'>;
  currency: string;
  currencyDecimals: number;
  allows3d: boolean;
  categories: ManagedCategory[];
  products: ManagedProduct[];
}) {
  const t = useT();
  // La ficha de estantería sólo se enseña a quien vende estanterías.
  const tienda = hasModule(businessType, 'barcodes');
  const toast = useToast();
  const router = useRouter();

  const [filter, setFilter] = useState<string | null>(null);

  const [productDraft, setProductDraft] = useState<Draft | null>(null);
  const [optionsFor, setOptionsFor] = useState<ManagedProduct | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const visible = filter ? products.filter((p) => p.categoryId === filter) : products;

  async function submitProduct() {
    if (!productDraft) return;
    setSaving(true);

    const result = await saveProduct({
      id: productDraft.id,
      catalog_category_id: productDraft.categoryId,
      name: productDraft.name,
      description: productDraft.description || null,
      price_cents: productDraft.priceCents,
      image_url: productDraft.imageUrl,
      model_3d_url: productDraft.model3dUrl,
      model_ar_url: productDraft.modelArUrl,
      model_scale: productDraft.modelScale,
      prep_minutes: productDraft.prepMinutes,
      calories: productDraft.calories,
      ingredients: productDraft.ingredients,
      allergens: productDraft.allergens,
      tags: productDraft.tags,
      is_available: productDraft.isAvailable,
      is_featured: productDraft.isFeatured,
      tax_rate: productDraft.taxRate,
      track_stock: productDraft.trackStock,
      stock_qty: productDraft.stockQty,
      low_stock_threshold: productDraft.lowStockThreshold,
      unit: productDraft.unit,
      brand: productDraft.brand || null,
      pack_size: productDraft.packSize || null,
      barcode: productDraft.barcode || null,
      net_content: productDraft.netContent,
      sold_by_weight: productDraft.soldByWeight,
      position: productDraft.position,
    });

    setSaving(false);

    if (!result.ok) {
      toast(
        result.error === 'PLAN_LIMIT_PRODUCTS'
          ? t.dashboard.limitReached
          : result.error === 'PLAN_NO_3D'
            ? t.dashboard.limitReached
            : t.common.error,
        'error',
      );
      return;
    }

    toast(t.common.save, 'success');
    setProductDraft(null);
    router.refresh();
  }

  async function runDelete() {
    if (!confirmId) return;
    setSaving(true);
    const result = await deleteProduct(confirmId);
    setSaving(false);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    setConfirmId(null);
    router.refresh();
  }

  async function toggleAvailability(product: ManagedProduct) {
    const result = await toggleProductAvailability(product.id, !product.isAvailable);
    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-ink-300">{t.catalog.askAdmin}</p>
        <Button onClick={() => setProductDraft(emptyDraft(filter))}>
          <Plus className="h-4 w-4" />
          {t.dashboard.newProduct}
        </Button>
      </div>

      <>
          {categories.length > 0 && (
            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              <FilterPill label={t.common.all} active={filter === null} onClick={() => setFilter(null)} />
              {categories.map((category) => (
                <FilterPill
                  key={category.id}
                  label={category.name}
                  active={filter === category.id}
                  onClick={() => setFilter(category.id)}
                />
              ))}
            </div>
          )}

          {visible.length === 0 ? (
            <EmptyState
              icon={<ImageIcon className="h-7 w-7" />}
              title={t.common.empty}
              className="rounded-2xl bg-white shadow-chip"
              action={
                <Button onClick={() => setProductDraft(emptyDraft(filter))}>
                  <Plus className="h-4 w-4" />
                  {t.dashboard.newProduct}
                </Button>
              }
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((product) => (
                <li key={product.id} className="flex gap-4 rounded-2xl bg-white p-4 shadow-chip">
                  <span className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
                    {product.imageUrl ? (
                      <Image src={product.imageUrl} alt={product.name} fill sizes="80px" className="object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-ink-200">
                        <ImageIcon className="h-6 w-6" />
                      </span>
                    )}
                  </span>

                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-bold text-ink-700">{product.name}</p>
                      <div className="flex shrink-0 gap-1">
                        {product.isFeatured && <Star className="h-3.5 w-3.5 fill-accent-dark text-accent-dark" />}
                        {product.model3dUrl && <Box className="h-3.5 w-3.5 text-brand" />}
                      </div>
                    </div>

                    <p className="mt-0.5 text-sm font-bold text-ink">
                      {formatMoney(product.priceCents, currency, currencyDecimals)}
                    </p>

                    {product.optionGroups.length > 0 && (
                      <p className="mt-1 text-xs text-ink-300">
                        {product.optionGroups.length} {t.product.chooseOptions.toLowerCase()}
                      </p>
                    )}

                    <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                      <button
                        type="button"
                        onClick={() => toggleAvailability(product)}
                        className={cn(
                          'rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors',
                          product.isAvailable
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-surface-muted text-ink-300',
                        )}
                      >
                        {product.isAvailable ? t.common.active : t.product.unavailable}
                      </button>

                      <div className="flex gap-1">
                        <IconAction
                          label={t.product.chooseOptions}
                          onClick={() => setOptionsFor(product)}
                        >
                          <Layers className="h-3.5 w-3.5" />
                        </IconAction>
                        <IconAction
                          label={t.common.edit}
                          onClick={() =>
                            setProductDraft({
                              id: product.id,
                              categoryId: product.categoryId,
                              name: product.name,
                              description: product.description,
                              priceCents: product.priceCents,
                              imageUrl: product.imageUrl,
                              model3dUrl: product.model3dUrl,
                              modelArUrl: product.modelArUrl,
                              modelScale: product.modelScale,
                              prepMinutes: product.prepMinutes,
                              calories: product.calories,
                              taxRate: product.taxRate,
                              trackStock: product.trackStock,
                              stockQty: product.stockQty,
                              lowStockThreshold: product.lowStockThreshold,
                              unit: product.unit,
                              brand: product.brand,
                              packSize: product.packSize,
                              barcode: product.barcode,
                              netContent: product.netContent,
                              soldByWeight: product.soldByWeight,
                              ingredients: product.ingredients,
                              allergens: product.allergens,
                              tags: product.tags,
                              isAvailable: product.isAvailable,
                              isFeatured: product.isFeatured,
                              position: product.position,
                            })
                          }
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </IconAction>
                        <IconAction
                          label={t.common.delete}
                          danger
                          onClick={() => setConfirmId(product.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconAction>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </>

      {/* ---------- Editor de plato ---------- */}
      <Sheet
        open={productDraft !== null}
        onClose={() => setProductDraft(null)}
        title={productDraft?.id ? t.common.edit : t.dashboard.newProduct}
        size="lg"
        footer={
          <Button size="block" loading={saving} onClick={submitProduct}>
            {t.common.save}
          </Button>
        }
      >
        {productDraft && (
          <div className="space-y-5">
            <Input
              value={productDraft.name}
              onChange={(e) => setProductDraft({ ...productDraft, name: e.target.value })}
              label={t.common.name}
              placeholder="Pizza Margherita"
              required
            />
            <Textarea
              value={productDraft.description ?? ''}
              onChange={(e) => setProductDraft({ ...productDraft, description: e.target.value })}
              label={t.common.description}
              rows={3}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                defaultValue={formatAmount(productDraft.priceCents, currencyDecimals)}
                onBlur={(e) =>
                  setProductDraft({
                    ...productDraft,
                    priceCents: parseAmount(e.target.value, currencyDecimals),
                  })
                }
                label={`${t.common.price} (${currency})`}
                inputMode="decimal"
                placeholder="9,50"
              />
              <Select
                value={productDraft.categoryId ?? ''}
                onChange={(e) =>
                  setProductDraft({ ...productDraft, categoryId: e.target.value || null })
                }
                label={t.common.category}
                hint={categories.length === 0 ? t.catalog.askAdmin : undefined}
              >
                <option value="">{t.catalog.noCategoryYet}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Un bote de tomate no tarda en hacerse. */}
              {!tienda && (
                <Input
                  type="number"
                  value={productDraft.prepMinutes}
                  onChange={(e) =>
                    setProductDraft({ ...productDraft, prepMinutes: Number(e.target.value) })
                  }
                  label={`${t.storefront.prepTime} (${t.common.min})`}
                  min={0}
                />
              )}
              <Input
                type="number"
                value={productDraft.calories ?? ''}
                onChange={(e) =>
                  setProductDraft({
                    ...productDraft,
                    calories: e.target.value ? Number(e.target.value) : null,
                  })
                }
                label="kcal"
                min={0}
              />
            </div>

            {/* Tipo impositivo del plato. En hostelería la comida y la bebida
                alcohólica tributan distinto, y un porcentaje único por
                restaurante no puede expresarlo. Vacío usa el general. */}
            <Input
              type="number"
              value={productDraft.taxRate === null ? '' : productDraft.taxRate * 100}
              onChange={(e) =>
                setProductDraft({
                  ...productDraft,
                  taxRate: e.target.value === '' ? null : Number(e.target.value) / 100,
                })
              }
              label={t.dashboard.taxRateLabel}
              hint={t.dashboard.taxRateHint}
              min={0}
              max={100}
              step={0.5}
            />

            {/* Ficha de estantería: marca, formato y código de barras. Es lo
                que distingue dos referencias que se llaman casi igual, y lo que
                permite darlas de alta leyendo el envase en vez de teclearlo. */}
            {tienda && (
              <div className="space-y-4 rounded-2xl bg-surface-soft p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    value={productDraft.brand ?? ''}
                    onChange={(e) => setProductDraft({ ...productDraft, brand: e.target.value })}
                    label={t.business.brand}
                  />
                  <Input
                    value={productDraft.packSize ?? ''}
                    onChange={(e) => setProductDraft({ ...productDraft, packSize: e.target.value })}
                    label={t.business.packSize}
                    hint={t.business.packSizeHint}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Select
                    value={productDraft.unit}
                    onChange={(e) =>
                      setProductDraft({
                        ...productDraft,
                        unit: e.target.value as Enums<'sale_unit'>,
                      })
                    }
                    label={t.business.unit}
                  >
                    <option value="unit">{t.business.unitUnit}</option>
                    <option value="kg">{t.business.unitKg}</option>
                    <option value="g">{t.business.unitG}</option>
                    <option value="l">{t.business.unitL}</option>
                    <option value="ml">{t.business.unitMl}</option>
                  </Select>
                  <Input
                    type="number"
                    step="0.001"
                    min={0}
                    value={productDraft.netContent ?? ''}
                    onChange={(e) =>
                      setProductDraft({
                        ...productDraft,
                        netContent: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    label={t.business.netContent}
                    hint={t.business.netContentHint}
                  />
                </div>

                <Input
                  inputMode="numeric"
                  value={productDraft.barcode ?? ''}
                  onChange={(e) => setProductDraft({ ...productDraft, barcode: e.target.value })}
                  label={t.business.barcode}
                  icon={<Barcode className="h-4 w-4" />}
                />

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={productDraft.soldByWeight}
                    onChange={(e) =>
                      setProductDraft({ ...productDraft, soldByWeight: e.target.checked })
                    }
                    className="h-4 w-4 accent-brand"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink-700">
                      {t.business.soldByWeight}
                    </span>
                    <span className="block text-xs text-ink-300">
                      {t.business.soldByWeightHint}
                    </span>
                  </span>
                </label>
              </div>
            )}

            {/* Existencias. Opcional a propósito: la mayoría de una carta no se
                lleva por unidades, y obligar a todos la convertiría en almacén. */}
            <label className="flex items-center gap-3 rounded-xl bg-surface-field px-4 py-3">
              <input
                type="checkbox"
                checked={productDraft.trackStock}
                onChange={(e) => setProductDraft({ ...productDraft, trackStock: e.target.checked })}
                className="h-4 w-4 accent-brand"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink-700">
                  {t.dashboard.trackStock}
                </span>
                <span className="block text-xs text-ink-300">{t.dashboard.trackStockHint}</span>
              </span>
            </label>

            {productDraft.trackStock && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  type="number"
                  value={productDraft.stockQty}
                  onChange={(e) =>
                    setProductDraft({ ...productDraft, stockQty: Number(e.target.value) })
                  }
                  label={t.dashboard.stockQty}
                  min={0}
                />
                <Input
                  type="number"
                  value={productDraft.lowStockThreshold}
                  onChange={(e) =>
                    setProductDraft({ ...productDraft, lowStockThreshold: Number(e.target.value) })
                  }
                  label={t.dashboard.lowStockThreshold}
                  hint={t.dashboard.lowStockHint}
                  min={0}
                />
              </div>
            )}

            <FileUpload
              bucket="products"
              restaurantId={restaurantId}
              value={productDraft.imageUrl}
              onChange={(url) => setProductDraft({ ...productDraft, imageUrl: url })}
              label={t.common.image}
              recommended={{ width: 800, height: 800 }}
              hint={t.dashboard.dishImageHint}
            />

            <div className={cn(!allows3d && 'opacity-50')}>
              <FileUpload
                bucket="models"
                restaurantId={restaurantId}
                value={productDraft.model3dUrl}
                onChange={(url) => setProductDraft({ ...productDraft, model3dUrl: url })}
                label={`${t.dashboard.model3d} (.glb)`}
                hint={allows3d ? t.dashboard.model3dHint : t.dashboard.limitReached}
                preview="file"
              />
            </div>

            {productDraft.model3dUrl && (
              <FileUpload
                bucket="models"
                restaurantId={restaurantId}
                value={productDraft.modelArUrl}
                onChange={(url) => setProductDraft({ ...productDraft, modelArUrl: url })}
                label="Modelo iOS (.usdz)"
                hint="Opcional: iOS usa Quick Look, que necesita este formato para la realidad aumentada."
                preview="file"
              />
            )}

            <TagInput
              label={t.product.ingredients}
              values={productDraft.ingredients}
              onChange={(values) => setProductDraft({ ...productDraft, ingredients: values })}
            />
            <TagInput
              label={t.product.allergens}
              values={productDraft.allergens}
              onChange={(values) => setProductDraft({ ...productDraft, allergens: values })}
            />

            <div className="space-y-3 rounded-xl bg-surface-field p-4">
              <Switch
                checked={productDraft.isAvailable}
                onChange={(v) => setProductDraft({ ...productDraft, isAvailable: v })}
                label={t.common.active}
              />
              <Switch
                checked={productDraft.isFeatured}
                onChange={(v) => setProductDraft({ ...productDraft, isFeatured: v })}
                label={t.storefront.featured}
              />
            </div>
          </div>
        )}
      </Sheet>

      {/* ---------- Opciones del plato ---------- */}
      <Sheet
        open={optionsFor !== null}
        onClose={() => setOptionsFor(null)}
        title={`${t.product.chooseOptions} · ${optionsFor?.name ?? ''}`}
        size="lg"
      >
        {optionsFor && (
          <OptionGroupsEditor
            productId={optionsFor.id}
            currency={currency}
            currencyDecimals={currencyDecimals}
            groups={optionsFor.optionGroups}
            onSaved={() => {
              setOptionsFor(null);
              router.refresh();
            }}
          />
        )}
      </Sheet>

      <ConfirmDialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={runDelete}
        title={t.common.delete}
        message={t.common.confirm}
        confirmLabel={t.common.delete}
        cancelLabel={t.common.cancel}
        loading={saving}
      />
    </>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full px-4 py-2 text-xs font-bold transition-colors',
        active ? 'bg-ink text-white' : 'bg-white text-ink-500 shadow-chip hover:text-ink',
      )}
    >
      {label}
    </button>
  );
}

function IconAction({
  children,
  label,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
        danger
          ? 'text-ink-300 hover:bg-red-50 hover:text-state-danger'
          : 'text-ink-300 hover:bg-surface-field hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

/** Lista de etiquetas editable: Enter añade, clic elimina. */
function TagInput({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  function add() {
    const value = draft.trim();
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
    setDraft('');
  }

  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          className="field flex-1"
          placeholder="Tomate"
        />
        <button type="button" onClick={add} className="btn-ghost px-4">
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {values.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {values.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange(values.filter((v) => v !== value))}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1.5 text-xs font-semibold text-ink-600 hover:bg-red-50 hover:text-state-danger"
            >
              {value}
              <Trash2 className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
