'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, CreditCard, Plus, Smartphone, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select, Switch, Textarea } from '@/components/ui/input';
import { Sheet, ConfirmDialog } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import {
  savePaymentProvider,
  deletePaymentProvider,
  reviewPaymentSpec,
} from '@/app/admin/actions';
import { useI18n, interpolate } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import type { Enums } from '@/types/database';

export type Gateway = {
  id: string;
  slug: string;
  name: string;
  kind: Enums<'payment_provider_kind'>;
  countries: string[];
  currencies: string[];
  adapter: string;
  configSchema: unknown;
  spec: unknown;
  isActive: boolean;
  position: number;
  merchants: number;
};

/** Las marcas que el intérprete sabe rellenar. Se enseñan al lado del editor. */
const MARCAS = [
  'amount_minor', 'amount_major', 'currency', 'order_code',
  'return_url', 'cancel_url', 'webhook_url',
  'customer_name', 'customer_email', 'customer_phone', 'reference',
];

const EJEMPLOS: Record<string, unknown> = {
  vacio: {},
  alojado: {
    auth: { mode: 'bearer', token: '{{secret_key}}' },
    encoding: 'json',
    create: {
      method: 'POST',
      url: 'https://api.ejemplo.com/v1/checkout',
      body: {
        amount: '{{amount_major}}',
        currency: '{{currency}}',
        description: 'Pedido {{order_code}}',
        notify_url: '{{webhook_url}}',
        return_url: '{{return_url}}',
      },
      extract: { redirect_url: '$.data.url', reference: '$.data.id' },
    },
    webhook: {
      verify: { mode: 'hmac_sha256', header: 'x-signature', secret: '{{webhook_secret}}', encoding: 'hex' },
      reference: '$.data.id',
      status: '$.event',
      map: { PAYMENT_APPROVED: 'paid', PAYMENT_REJECTED: 'failed' },
    },
  },
  oauth: {
    auth: {
      mode: 'oauth2',
      url: 'https://api.ejemplo.com/v1/oauth2/token',
      client_id: '{{client_id}}',
      client_secret: '{{client_secret}}',
    },
    encoding: 'json',
    create: {
      method: 'POST',
      url: 'https://api.ejemplo.com/v2/checkout/orders',
      body: {
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: '{{currency}}', value: '{{amount_major}}' } }],
        application_context: { return_url: '{{return_url}}', cancel_url: '{{cancel_url}}' },
      },
      extract: { redirect_url: '$.links[1].href', reference: '$.id' },
    },
    webhook: {
      verify: { mode: 'none' },
      reference: '$.resource.id',
      status: '$.event_type',
      map: { 'CHECKOUT.ORDER.APPROVED': 'paid', 'CHECKOUT.ORDER.VOIDED': 'cancelled' },
    },
  },
};

const VACIA = {
  slug: '', name: '', kind: 'online' as Enums<'payment_provider_kind'>,
  countries: '', currencies: '', adapter: 'http',
  credenciales: 'secret_key\nwebhook_secret',
  spec: '{}', isActive: true, position: 0,
};

/**
 * Dar de alta una pasarela sin desplegar nada.
 *
 * La receta se escribe a mano porque es lo que es: un puñado de direcciones y
 * caminos que sólo conoce quien está leyendo la documentación del proveedor. Lo
 * que sí puede hacer esta pantalla es no dejarle solo — ejemplos de los que
 * partir, las marcas disponibles a la vista, y una revisión que señala lo que
 * falta antes de que un comercio se lo encuentre en un cobro real.
 */
export function PaymentGateways({ gateways }: { gateways: Gateway[] }) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();

  const [editando, setEditando] = useState<(typeof VACIA & { id?: string }) | null>(null);
  const [borrando, setBorrando] = useState<Gateway | null>(null);
  const [avisos, setAvisos] = useState<string[] | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  /*
   * El editor de la receta es alto, y el resultado de la revisión caía debajo,
   * fuera de la vista: se pulsaba el botón y no pasaba nada visible. Se lleva
   * el resultado hasta los ojos, que es lo mínimo que puede hacer un botón que
   * dice «revisar».
   */
  const revision = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (avisos !== null) {
      revision.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [avisos]);

  function abrir(g?: Gateway) {
    setAvisos(null);
    setEditando(
      g
        ? {
            id: g.id, slug: g.slug, name: g.name, kind: g.kind,
            countries: g.countries.join(', '), currencies: g.currencies.join(', '),
            adapter: g.adapter,
            credenciales: (g.configSchema as { campo: string }[] | null)
              ?.map((c) => c.campo).join('\n') ?? '',
            spec: JSON.stringify(g.spec, null, 2),
            isActive: g.isActive, position: g.position,
          }
        : { ...VACIA },
    );
  }

  function recetaComoObjeto(): unknown | null {
    try {
      const valor = JSON.parse(editando?.spec || '{}');
      return valor && typeof valor === 'object' ? valor : null;
    } catch {
      return null;
    }
  }

  async function revisar() {
    const receta = recetaComoObjeto();
    if (!receta) {
      setAvisos([t.gateway.invalidJson]);
      return;
    }
    setOcupado('revisar');
    const result = await reviewPaymentSpec({
      ...(receta as object),
      __credenciales: campos(),
    });
    setOcupado(null);
    if (result.ok) setAvisos(result.data.avisos);
  }

  const campos = () =>
    (editando?.credenciales ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

  async function guardar() {
    if (!editando) return;
    const receta = recetaComoObjeto();
    if (!receta) {
      toast(t.gateway.invalidJson, 'error');
      return;
    }

    setOcupado('guardar');
    const result = await savePaymentProvider({
      id: editando.id,
      slug: editando.slug.trim(),
      name: editando.name.trim(),
      kind: editando.kind,
      adapter: editando.adapter.trim() || 'http',
      countries: editando.countries.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean),
      currencies: editando.currencies.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean),
      config_schema: campos().map((campo) => ({ campo, secreto: true })),
      spec: receta,
      is_active: editando.isActive,
      position: editando.position,
    });
    setOcupado(null);

    if (!result.ok) {
      toast(result.error === 'SLUG_TAKEN' ? t.gateway.slugTaken : t.common.error, 'error');
      return;
    }
    setEditando(null);
    router.refresh();
  }

  async function borrar() {
    if (!borrando) return;
    setOcupado('borrar');
    const result = await deletePaymentProvider(borrando.id);
    setOcupado(null);
    setBorrando(null);

    if (!result.ok) {
      toast(result.error === 'PROVIDER_IN_USE' ? t.gateway.cannotDelete : t.common.error, 'error');
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{t.gateway.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-300">{t.gateway.subtitle}</p>
        </div>
        <Button onClick={() => abrir()}>
          <Plus className="h-4 w-4" />
          {t.gateway.add}
        </Button>
      </div>

      {gateways.length === 0 ? (
        <p className="rounded-2xl bg-white px-5 py-12 text-center text-sm text-ink-300 shadow-chip">
          {t.gateway.noProviders}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {gateways.map((g) => (
            <li key={g.id} className="rounded-2xl bg-white p-4 shadow-chip">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-field text-ink-400">
                  {g.kind === 'terminal' ? (
                    <Smartphone className="h-5 w-5" />
                  ) : (
                    <CreditCard className="h-5 w-5" />
                  )}
                </span>
                <button type="button" onClick={() => abrir(g)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-display text-base font-bold text-ink">
                    {g.name}
                  </span>
                  <span className="block font-mono text-[11px] text-ink-300">{g.slug}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBorrando(g)}
                  className="icon-btn h-8 w-8 text-state-danger"
                  aria-label={t.common.delete}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <p className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-md bg-surface-field px-2 py-0.5 font-semibold text-ink-500">
                  {g.adapter}
                </span>
                {g.countries.length > 0 && (
                  <span className="rounded-md bg-surface-field px-2 py-0.5 text-ink-400">
                    {g.countries.join(' · ')}
                  </span>
                )}
                {!g.isActive && (
                  <span className="rounded-md bg-surface-field px-2 py-0.5 text-ink-300">
                    {t.common.inactive}
                  </span>
                )}
              </p>
              <p className="mt-2 text-xs text-ink-300">
                {interpolate(t.gateway.inUse, { n: g.merchants })}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={editando !== null}
        onClose={() => setEditando(null)}
        title={editando?.id ? t.gateway.edit : t.gateway.add}
        size="xl"
        footer={
          <div className="flex gap-3">
            <Button variant="ghost" loading={ocupado === 'revisar'} onClick={revisar}>
              {t.gateway.review}
            </Button>
            <Button className="flex-1" loading={ocupado === 'guardar'} onClick={guardar}>
              {t.common.save}
            </Button>
          </div>
        }
      >
        {editando && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t.gateway.name}
                value={editando.name}
                onChange={(e) => setEditando({ ...editando, name: e.target.value })}
                placeholder="Bold"
              />
              <Input
                label={t.gateway.slug}
                hint={t.gateway.slugHint}
                className="font-mono"
                value={editando.slug}
                onChange={(e) =>
                  setEditando({ ...editando, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })
                }
                placeholder="bold"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label={t.gateway.kind}
                value={editando.kind}
                onChange={(e) =>
                  setEditando({ ...editando, kind: e.target.value as Enums<'payment_provider_kind'> })
                }
              >
                <option value="online">{t.gateway.online}</option>
                <option value="terminal">{t.gateway.terminal}</option>
              </Select>
              <Input
                label={t.gateway.adapter}
                hint={t.gateway.adapterHint}
                className="font-mono"
                value={editando.adapter}
                onChange={(e) => setEditando({ ...editando, adapter: e.target.value })}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t.gateway.countries}
                hint={t.gateway.countriesHint}
                value={editando.countries}
                onChange={(e) => setEditando({ ...editando, countries: e.target.value })}
                placeholder="CO, HN, ES"
              />
              <Input
                label={t.gateway.currencies}
                hint={t.gateway.currenciesHint}
                value={editando.currencies}
                onChange={(e) => setEditando({ ...editando, currencies: e.target.value })}
                placeholder="COP, HNL, EUR"
              />
            </div>

            <Textarea
              label={t.gateway.credentials}
              hint={t.gateway.credentialsHint}
              className="font-mono text-xs"
              rows={3}
              value={editando.credenciales}
              onChange={(e) => setEditando({ ...editando, credenciales: e.target.value })}
            />

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="label mb-0">{t.gateway.spec}</span>
                <Select
                  aria-label={t.gateway.template}
                  className="!w-auto !py-1.5 text-xs"
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setEditando({
                      ...editando,
                      spec: JSON.stringify(EJEMPLOS[e.target.value], null, 2),
                    });
                    setAvisos(null);
                  }}
                >
                  <option value="">{t.gateway.template}</option>
                  <option value="vacio">{t.gateway.templateEmpty}</option>
                  <option value="alojado">{t.gateway.templateHosted}</option>
                  <option value="oauth">{t.gateway.templateOauth}</option>
                </Select>
              </div>
              <p className="mb-2 -mt-1 text-xs text-ink-300">{t.gateway.specHint}</p>
              <Textarea
                className="font-mono text-xs leading-relaxed"
                rows={12}
                value={editando.spec}
                onChange={(e) => setEditando({ ...editando, spec: e.target.value })}
                spellCheck={false}
              />
              <p className="mt-2 text-[11px] text-ink-300">
                {t.gateway.placeholders}:{' '}
                <span className="font-mono">{MARCAS.map((m) => `{{${m}}}`).join(' ')}</span>
                {campos().length > 0 && (
                  <>
                    {' '}
                    <span className="font-mono text-brand-700">
                      {campos().map((c) => `{{${c}}}`).join(' ')}
                    </span>
                  </>
                )}
              </p>
            </div>

            {avisos !== null && (
              <div
                ref={revision}
                className={cn(
                  'rounded-xl px-4 py-3',
                  avisos.length === 0 ? 'bg-state-success/10' : 'bg-amber-50',
                )}
              >
                {avisos.length === 0 ? (
                  <p className="flex items-center gap-2 text-sm font-semibold text-state-success">
                    <Check className="h-4 w-4" />
                    {t.gateway.reviewOk}
                  </p>
                ) : (
                  <>
                    <p className="flex items-center gap-2 text-sm font-bold text-amber-900">
                      <AlertTriangle className="h-4 w-4" />
                      {t.gateway.reviewTitle}
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {avisos.map((a) => (
                        <li key={a} className="text-xs leading-relaxed text-amber-800">
                          {a}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            <Switch
              label={t.gateway.active}
              checked={editando.isActive}
              onChange={(v) => setEditando({ ...editando, isActive: v })}
            />
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={borrando !== null}
        onClose={() => setBorrando(null)}
        onConfirm={borrar}
        title={t.common.delete}
        message={borrando?.name ?? ''}
        confirmLabel={t.common.delete}
        cancelLabel={t.common.cancel}
        loading={ocupado === 'borrar'}
      />
    </div>
  );
}
