'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Copy, KeyRound, Plug, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Switch } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import {
  toggleMerchantMethod,
  saveGatewayCredentials,
  testGatewayConnection,
} from '@/app/dashboard/actions';
import { useI18n, interpolate } from '@/i18n/provider';
import { cn } from '@/lib/utils';

export type Campo = { campo: string; etiqueta?: string; secreto?: boolean };

export type PasarelaDisponible = {
  providerId: string;
  slug: string;
  name: string;
  campos: Campo[];
  methodId: string | null;
  activa: boolean;
  tieneLlaves: boolean;
  webhookUrl: string | null;
};

/**
 * Las formas de cobro del comercio.
 *
 * Tres cosas tiene que poder hacer quien lleva el negocio sin llamar a nadie:
 * meter sus llaves, comprobar que valen, y copiar la dirección de avisos para
 * pegarla en el panel de la pasarela. Ese último paso se olvida siempre, y sin
 * él los cobros salen bien y nunca se confirman.
 */
export function MerchantPayments({
  pasarelas,
  pais,
}: {
  pasarelas: PasarelaDisponible[];
  pais: string;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();

  const [editando, setEditando] = useState<PasarelaDisponible | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [prueba, setPrueba] = useState<{ ok: boolean; texto: string } | null>(null);

  async function encender(p: PasarelaDisponible, activo: boolean) {
    if (activo && !p.tieneLlaves) {
      toast(t.merchantPay.onlyWithKeys, 'error');
      abrir(p);
      return;
    }
    setOcupado(p.providerId);
    const result = await toggleMerchantMethod(p.providerId, activo);
    setOcupado(null);
    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    router.refresh();
  }

  async function abrir(p: PasarelaDisponible) {
    setPrueba(null);
    setValores(Object.fromEntries(p.campos.map((c) => [c.campo, ''])));

    if (p.methodId) {
      setEditando(p);
      return;
    }
    // Todavía no existe la fila del comercio: se crea apagada al abrirla.
    setOcupado(p.providerId);
    const result = await toggleMerchantMethod(p.providerId, false);
    setOcupado(null);
    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    setEditando({ ...p, methodId: result.data.methodId, webhookUrl: result.data.webhookUrl });
    router.refresh();
  }

  async function guardar() {
    if (!editando?.methodId) return;
    setOcupado('guardar');
    const result = await saveGatewayCredentials(editando.methodId, valores);
    setOcupado(null);

    if (!result.ok) {
      const textos = t.merchantPay as unknown as Record<string, string>;
      toast(textos[result.error] ?? t.common.error, 'error');
      return;
    }
    toast(t.merchantPay.keysSaved, 'success');
    setEditando({ ...editando, tieneLlaves: true });
    setValores(Object.fromEntries(editando.campos.map((c) => [c.campo, ''])));
    router.refresh();
  }

  async function probar() {
    if (!editando?.methodId) return;
    setOcupado('probar');
    setPrueba(null);
    const result = await testGatewayConnection(editando.methodId);
    setOcupado(null);

    setPrueba(
      result.ok
        ? { ok: true, texto: interpolate(t.merchantPay.testOk, { host: result.data.host }) }
        : { ok: false, texto: interpolate(t.merchantPay.testFail, { error: result.error }) },
    );
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      toast(t.merchantPay.copied, 'success');
    } catch {
      toast(t.common.error, 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.merchantPay.title}</h1>
        <p className="mt-1 text-sm text-ink-300">{t.merchantPay.subtitle}</p>
      </div>

      <p className="label">{t.merchantPay.available}</p>

      {pasarelas.length === 0 ? (
        <p className="rounded-2xl bg-white px-5 py-12 text-center text-sm text-ink-300 shadow-chip">
          {interpolate(t.merchantPay.none, { country: pais })}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pasarelas.map((p) => (
            <li key={p.providerId} className="rounded-2xl bg-white p-5 shadow-chip">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-base font-bold text-ink">{p.name}</p>
                  <p
                    className={cn(
                      'mt-1 inline-block rounded-md px-2 py-0.5 text-[11px] font-bold',
                      p.activa
                        ? 'bg-state-success/10 text-state-success'
                        : p.tieneLlaves
                          ? 'bg-surface-field text-ink-400'
                          : 'bg-amber-50 text-amber-800',
                    )}
                  >
                    {p.activa
                      ? t.merchantPay.on
                      : p.tieneLlaves
                        ? t.merchantPay.off
                        : t.merchantPay.needsKeys}
                  </p>
                </div>
                <Switch
                  checked={p.activa}
                  disabled={ocupado === p.providerId}
                  onChange={(v) => encender(p, v)}
                />
              </div>

              <div className="mt-4">
                <button type="button" onClick={() => abrir(p)} className="btn-soft w-full py-2 text-xs">
                  <KeyRound className="h-3.5 w-3.5" />
                  {p.tieneLlaves ? t.common.edit : t.merchantPay.saveKeys}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={editando !== null}
        onClose={() => setEditando(null)}
        title={editando?.name ?? ''}
        footer={
          <div className="flex gap-3">
            <Button variant="ghost" loading={ocupado === 'probar'} onClick={probar}>
              <Plug className="h-4 w-4" />
              {t.merchantPay.test}
            </Button>
            <Button className="flex-1" loading={ocupado === 'guardar'} onClick={guardar}>
              {t.merchantPay.saveKeys}
            </Button>
          </div>
        }
      >
        {editando && (
          <div className="space-y-5">
            <div>
              <p className="label">{t.merchantPay.keys}</p>
              <p className="mb-3 -mt-1 text-xs text-ink-300">{t.merchantPay.keysHint}</p>
              <div className="space-y-3">
                {editando.campos.map((campo) => (
                  <Input
                    key={campo.campo}
                    label={campo.etiqueta ?? campo.campo}
                    hint={campo.secreto ? t.merchantPay.secret : undefined}
                    type={campo.secreto ? 'password' : 'text'}
                    autoComplete="off"
                    className="font-mono text-xs"
                    placeholder={editando.tieneLlaves ? '••••••••' : ''}
                    value={valores[campo.campo] ?? ''}
                    onChange={(e) =>
                      setValores({ ...valores, [campo.campo]: e.target.value })
                    }
                  />
                ))}
              </div>
            </div>

            {editando.webhookUrl && (
              <div>
                <p className="label">{t.merchantPay.webhookUrl}</p>
                <p className="mb-2 -mt-1 text-xs text-ink-300">{t.merchantPay.webhookHint}</p>
                <div className="flex items-center gap-2 rounded-xl bg-surface-field px-3 py-2.5">
                  <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-500">
                    {editando.webhookUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => copiar(editando.webhookUrl!)}
                    className="icon-btn h-8 w-8 shrink-0"
                    aria-label={t.merchantPay.copied}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            <p className="text-xs text-ink-300">{t.merchantPay.testHint}</p>

            {prueba && (
              <p
                className={cn(
                  'flex items-start gap-2 rounded-xl px-4 py-3 text-sm font-semibold',
                  prueba.ok
                    ? 'bg-state-success/10 text-state-success'
                    : 'bg-state-danger/10 text-state-danger',
                )}
              >
                {prueba.ok ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <X className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span className="min-w-0 break-words">{prueba.texto}</span>
              </p>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
