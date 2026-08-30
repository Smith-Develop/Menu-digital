'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Input, Switch } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { saveOptionGroup, deleteOptionGroup } from '@/app/dashboard/actions';
import { formatAmount, parseAmount } from '@/lib/money';
import { useT } from '@/i18n/provider';
import type { ManagedOptionGroup } from '@/components/dashboard/menu-manager';

type DraftOption = {
  id?: string;
  name: string;
  priceDeltaCents: number;
  isDefault: boolean;
  isAvailable: boolean;
};

type DraftGroup = {
  id?: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  options: DraftOption[];
};

/**
 * Editor de grupos de opciones ("Tamaño", "Extras").
 * Cada grupo se guarda entero: el servidor reemplaza sus opciones en bloque.
 */
export function OptionGroupsEditor({
  productId,
  currency,
  currencyDecimals,
  groups,
  onSaved,
}: {
  productId: string;
  currency: string;
  currencyDecimals: number;
  groups: ManagedOptionGroup[];
  onSaved: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [drafts, setDrafts] = useState<DraftGroup[]>(() =>
    groups.map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      isRequired: g.isRequired,
      options: g.options.map((o) => ({
        id: o.id,
        name: o.name,
        priceDeltaCents: o.priceDeltaCents,
        isDefault: o.isDefault,
        isAvailable: o.isAvailable,
      })),
    })),
  );
  const [saving, setSaving] = useState(false);

  function patch(index: number, changes: Partial<DraftGroup>) {
    setDrafts((current) => current.map((g, i) => (i === index ? { ...g, ...changes } : g)));
  }

  async function saveGroup(index: number) {
    const group = drafts[index];
    if (!group.name.trim()) {
      toast(t.common.required, 'error');
      return;
    }

    setSaving(true);
    const result = await saveOptionGroup({
      id: group.id,
      product_id: productId,
      name: group.name,
      min_select: group.minSelect,
      max_select: group.maxSelect,
      is_required: group.isRequired,
      position: index,
      options: group.options.map((o) => ({
        id: o.id,
        name: o.name,
        price_delta_cents: o.priceDeltaCents,
        is_default: o.isDefault,
        is_available: o.isAvailable,
      })),
    });
    setSaving(false);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    toast(t.common.save, 'success');
    onSaved();
  }

  async function removeGroup(index: number) {
    const group = drafts[index];
    if (group.id) {
      const result = await deleteOptionGroup(group.id);
      if (!result.ok) {
        toast(t.common.error, 'error');
        return;
      }
    }
    setDrafts((current) => current.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-5">
      {drafts.map((group, index) => (
        <section key={group.id ?? `new-${index}`} className="rounded-2xl border border-surface-line p-4">
          <div className="flex items-start gap-3">
            <Input
              value={group.name}
              onChange={(e) => patch(index, { name: e.target.value })}
              label={t.common.name}
              placeholder="Tamaño"
              className="flex-1"
            />
            <button
              type="button"
              onClick={() => removeGroup(index)}
              aria-label={t.common.delete}
              className="mt-7 flex h-11 w-11 items-center justify-center rounded-xl text-ink-300 hover:bg-red-50 hover:text-state-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Input
              type="number"
              value={group.minSelect}
              onChange={(e) => patch(index, { minSelect: Number(e.target.value) })}
              label="Mín."
              min={0}
            />
            <Input
              type="number"
              value={group.maxSelect}
              onChange={(e) => patch(index, { maxSelect: Number(e.target.value) })}
              label="Máx."
              min={1}
            />
          </div>

          <div className="mt-3">
            <Switch
              checked={group.isRequired}
              onChange={(v) => patch(index, { isRequired: v })}
              label={t.product.required}
            />
          </div>

          <div className="mt-4 space-y-2">
            {group.options.map((option, optionIndex) => (
              <div key={option.id ?? `o-${optionIndex}`} className="flex items-center gap-2">
                <input
                  value={option.name}
                  onChange={(e) =>
                    patch(index, {
                      options: group.options.map((o, i) =>
                        i === optionIndex ? { ...o, name: e.target.value } : o,
                      ),
                    })
                  }
                  placeholder="26 cm"
                  className="field flex-1"
                />
                <input
                  defaultValue={formatAmount(option.priceDeltaCents, currencyDecimals)}
                  onBlur={(e) =>
                    patch(index, {
                      options: group.options.map((o, i) =>
                        i === optionIndex
                          ? { ...o, priceDeltaCents: parseAmount(e.target.value, currencyDecimals) }
                          : o,
                      ),
                    })
                  }
                  inputMode="decimal"
                  aria-label={`${t.common.price} ${currency}`}
                  className="field w-28"
                />
                <button
                  type="button"
                  onClick={() =>
                    patch(index, { options: group.options.filter((_, i) => i !== optionIndex) })
                  }
                  aria-label={t.common.delete}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-300 hover:bg-red-50 hover:text-state-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() =>
                patch(index, {
                  options: [
                    ...group.options,
                    { name: '', priceDeltaCents: 0, isDefault: false, isAvailable: true },
                  ],
                })
              }
              className="btn-ghost w-full text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              {t.common.add}
            </button>
          </div>

          <Button className="mt-4 w-full" loading={saving} onClick={() => saveGroup(index)}>
            {t.common.save}
          </Button>
        </section>
      ))}

      <button
        type="button"
        onClick={() =>
          setDrafts((current) => [
            ...current,
            { name: '', minSelect: 0, maxSelect: 1, isRequired: false, options: [] },
          ])
        }
        className="btn-ghost w-full"
      >
        <Plus className="h-4 w-4" />
        {t.common.add}
      </button>
    </div>
  );
}
