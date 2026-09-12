'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Building2, CreditCard, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Input, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

/** Lo que la pasarela declara saber hacer sin sacar al cliente de aquí. */
export type Inline = {
  adapter: string;
  sdk: string;
  public_field: string;
  methods: string[];
  installments?: boolean;
  pse_countries?: string[];
};

export type TarjetaGuardada = {
  id: string;
  brand: string | null;
  last_four: string | null;
  exp_month: number | null;
  exp_year: number | null;
  holder_name: string | null;
  is_default: boolean;
};

export type Instruccion =
  | { tipo: 'card'; token: string; metodoTarjeta: string; cuotas: number; documento: { tipo: string; numero: string } | null }
  | { tipo: 'saved_card'; tarjetaId: string; token: string; metodoTarjeta: string; cuotas: number }
  | { tipo: 'pse'; banco: string; tipoPersona: 'individual' | 'association'; nombre: string; documento: { tipo: string; numero: string } };

export type ManejadorPago = {
  /** ¿Se puede intentar cobrar con lo que hay relleno? */
  listo: () => boolean;
  /**
   * Cifra la tarjeta contra la pasarela y devuelve la orden de cobro.
   *
   * Se hace antes de crear el pedido: una tarjeta mal tecleada se descubre
   * aquí, sin haber mandado nada a la cocina.
   */
  preparar: () => Promise<{ instruccion: Instruccion; tokenParaGuardar?: string } | null>;
};

type MPFields = {
  create: (tipo: string, opciones?: Record<string, unknown>) => {
    mount: (id: string) => { on: (evento: string, fn: (datos: { bin?: string }) => void) => void };
    unmount: () => void;
  };
  createCardToken: (datos: Record<string, unknown>) => Promise<{ id: string }>;
};
type MP = {
  fields: MPFields;
  getPaymentMethods: (q: { bin: string }) => Promise<{ results: { id: string }[] }>;
  getInstallments: (q: { amount: string; bin: string }) => Promise<
    { payer_costs?: { installments: number; recommended_message: string }[] }[]
  >;
};

/**
 * Carga el guion de la pasarela una sola vez por página.
 *
 * Se llama `useSdk` y no `usarSdk` como el resto del código: React exige que un
 * gancho empiece por «use» para poder comprobar que se usa donde debe, y esa
 * comprobación vale más que la coherencia del idioma en un nombre.
 */
function useSdk(url: string, clave: string) {
  const [mp, setMp] = useState<MP | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    if (!url || !clave) return;
    let vivo = true;

    function arrancar() {
      const constructor = (window as unknown as { MercadoPago?: new (k: string, o?: unknown) => MP })
        .MercadoPago;
      if (!constructor) {
        setFallo(true);
        return;
      }
      if (vivo) setMp(new constructor(clave, { locale: 'es' }));
    }

    const yaEsta = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`);
    if (yaEsta) {
      if (yaEsta.dataset.listo) arrancar();
      else yaEsta.addEventListener('load', arrancar);
      return () => {
        vivo = false;
        yaEsta.removeEventListener('load', arrancar);
      };
    }

    const etiqueta = document.createElement('script');
    etiqueta.src = url;
    etiqueta.async = true;
    etiqueta.addEventListener('load', () => {
      etiqueta.dataset.listo = '1';
      arrancar();
    });
    // Un bloqueador de anuncios puede impedir que cargue. No es un fallo
    // nuestro y no se puede arreglar desde aquí, pero sí se puede decir y
    // ofrecer el camino de siempre.
    etiqueta.addEventListener('error', () => setFallo(true));
    document.head.appendChild(etiqueta);

    return () => {
      vivo = false;
    };
  }, [url, clave]);

  return { mp, fallo };
}

/**
 * Pagar con tarjeta o por PSE sin salir de la aplicación.
 *
 * Los campos de la tarjeta no son campos nuestros: son marcos de la propia
 * pasarela, incrustados aquí y con nuestro aspecto. Lo que se teclea en ellos
 * viaja directamente a Mercado Pago, que devuelve un testigo de un solo uso.
 * Nuestro servidor nunca ve un número de tarjeta, y por eso tampoco lo puede
 * perder.
 *
 * PSE es la excepción declarada: elegir banco y documento ocurre aquí, pero
 * autorizar el pago ocurre en la web del banco, porque PSE *es* eso. Lo que se
 * gana es que la elección y la vuelta pasan dentro de la tienda.
 */
export const InlinePayment = forwardRef<
  ManejadorPago,
  {
    methodId: string;
    inline: Inline;
    publicKey: string;
    amountMajor: number;
    country: string | null;
    isSignedIn: boolean;
    customerName: string;
    /** Para que el botón de confirmar sepa si ya se puede intentar cobrar. */
    onListo?: (listo: boolean) => void;
  }
>(function InlinePayment(
  { methodId, inline, publicKey, amountMajor, country, isSignedIn, customerName, onListo },
  ref,
) {
  const t = useT();
  const toast = useToast();
  const { mp, fallo } = useSdk(inline.sdk, publicKey);

  const ofrecePse =
    inline.methods.includes('pse') &&
    (!inline.pse_countries || (country ? inline.pse_countries.includes(country) : false));

  const [modo, setModo] = useState<'card' | 'pse'>('card');
  const [guardadas, setGuardadas] = useState<TarjetaGuardada[]>([]);
  const [elegida, setElegida] = useState<string | null>(null);

  const [titular, setTitular] = useState(customerName);
  const [docTipo, setDocTipo] = useState('');
  const [docNumero, setDocNumero] = useState('');
  const [guardar, setGuardar] = useState(false);

  const [metodoTarjeta, setMetodoTarjeta] = useState('');
  const [cuotas, setCuotas] = useState(1);
  const [opcionesCuotas, setOpcionesCuotas] = useState<{ n: number; texto: string }[]>([]);

  const [bancos, setBancos] = useState<{ id: string; nombre: string }[]>([]);
  const [documentos, setDocumentos] = useState<{ id: string; nombre: string }[]>([]);
  const [banco, setBanco] = useState('');
  const [tipoPersona, setTipoPersona] = useState<'individual' | 'association'>('individual');

  const [montado, setMontado] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const campos = useRef<{ unmount: () => void }[]>([]);

  // -- lo que cambia con el tiempo y lo sabe la pasarela ------------------
  useEffect(() => {
    let vivo = true;
    fetch(`/api/pago/datos?method=${methodId}`)
      .then((r) => r.json())
      .then((d: { bancos?: typeof bancos; documentos?: typeof documentos }) => {
        if (!vivo) return;
        setBancos(d.bancos ?? []);
        setDocumentos(d.documentos ?? []);
        setDocTipo((actual) => actual || d.documentos?.[0]?.id || '');
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [methodId]);

  // -- las tarjetas que dejó guardadas -----------------------------------
  useEffect(() => {
    if (!isSignedIn) return;
    let vivo = true;
    createClient()
      .rpc('my_saved_cards', { p_method_id: methodId })
      .then(({ data }) => {
        if (!vivo) return;
        const lista = (data ?? []) as TarjetaGuardada[];
        setGuardadas(lista);
        // La de siempre viene ya elegida: quien vuelve a pedir no tiene que
        // hacer nada más que meter su código de seguridad.
        if (lista.length > 0) setElegida(lista.find((c) => c.is_default)?.id ?? lista[0].id);
      });
    return () => {
      vivo = false;
    };
  }, [isSignedIn, methodId]);

  // -- los marcos de la pasarela -----------------------------------------
  const montarCampos = useCallback(() => {
    if (!mp || modo !== 'card') return;

    for (const c of campos.current) {
      try {
        c.unmount();
      } catch {
        /* si ya no está en el DOM, no hay nada que desmontar */
      }
    }
    campos.current = [];

    const conTarjetaGuardada = Boolean(elegida);

    // Con una guardada sólo se pide el código de seguridad: es justo lo que no
    // se guarda en ninguna parte, y por eso es lo que prueba que quien paga
    // tiene la tarjeta delante.
    const cvv = mp.fields
      .create('securityCode', { placeholder: '123' })
      .mount('campo-cvv');
    campos.current.push(cvv as unknown as { unmount: () => void });

    if (!conTarjetaGuardada) {
      const numero = mp.fields
        .create('cardNumber', { placeholder: '0000 0000 0000 0000' })
        .mount('campo-numero');
      const caducidad = mp.fields
        .create('expirationDate', { placeholder: 'MM/AA' })
        .mount('campo-caducidad');
      campos.current.push(
        numero as unknown as { unmount: () => void },
        caducidad as unknown as { unmount: () => void },
      );

      /*
       * Las seis primeras cifras dicen de qué banco y qué marca es la tarjeta.
       * De ahí salen dos cosas que no se pueden adivinar: el identificador del
       * medio de pago, que la pasarela exige al cobrar, y a cuántas cuotas
       * deja pagar esa tarjeta ese importe.
       */
      numero.on('binChange', async ({ bin }) => {
        if (!bin || bin.length < 6) {
          setMetodoTarjeta('');
          setOpcionesCuotas([]);
          return;
        }
        try {
          const medios = await mp.getPaymentMethods({ bin });
          setMetodoTarjeta(medios.results[0]?.id ?? '');

          if (inline.installments) {
            const plazos = await mp.getInstallments({ amount: String(amountMajor), bin });
            const costes = plazos[0]?.payer_costs ?? [];
            setOpcionesCuotas(
              costes.map((c) => ({ n: c.installments, texto: c.recommended_message })),
            );
          }
        } catch {
          /* sin datos de cuotas se paga en una, que es lo normal */
        }
      });
    }

    setMontado(true);
  }, [mp, modo, elegida, amountMajor, inline.installments]);

  useEffect(() => {
    montarCampos();
  }, [montarCampos]);

  // -- lo que el checkout llama al confirmar ------------------------------
  const listo = (() => {
    if (fallo) return false;
    if (modo === 'pse') return Boolean(banco && docTipo && docNumero.trim());
    if (elegida) return montado;
    return montado && Boolean(titular.trim() && metodoTarjeta);
  })();

  useEffect(() => {
    onListo?.(listo);
  }, [listo, onListo]);

  useImperativeHandle(
    ref,
    () => ({
      listo: () => listo,

      preparar: async () => {
        if (modo === 'pse') {
          if (!banco || !docNumero.trim()) {
            toast(t.pay.missingBank, 'error');
            return null;
          }
          return {
            instruccion: {
              tipo: 'pse',
              banco,
              tipoPersona,
              nombre: titular || customerName,
              documento: { tipo: docTipo, numero: docNumero.trim() },
            },
          };
        }

        if (!mp) {
          toast(t.pay.sdkFailed, 'error');
          return null;
        }

        setTrabajando(true);
        try {
          if (elegida) {
            const tarjeta = guardadas.find((c) => c.id === elegida);
            const token = await mp.fields.createCardToken({ cardId: tarjeta?.id });
            return {
              instruccion: {
                tipo: 'saved_card',
                tarjetaId: elegida,
                token: token.id,
                metodoTarjeta: tarjeta?.brand ?? '',
                cuotas,
              },
            };
          }

          const datos = {
            cardholderName: titular.trim(),
            ...(docTipo && docNumero.trim()
              ? { identificationType: docTipo, identificationNumber: docNumero.trim() }
              : {}),
          };

          const token = await mp.fields.createCardToken(datos);

          /*
           * Guardar la tarjeta necesita su propio testigo.
           *
           * Un testigo es de un solo uso: el que cobra queda consumido y no
           * sirve para dar de alta la tarjeta. Así que se pide un segundo,
           * desde los mismos campos, antes de que el cliente los pierda de
           * vista. Si este falla, el cobro sigue adelante igual.
           */
          let tokenParaGuardar: string | undefined;
          if (guardar && isSignedIn) {
            try {
              tokenParaGuardar = (await mp.fields.createCardToken(datos)).id;
            } catch {
              tokenParaGuardar = undefined;
            }
          }

          return {
            instruccion: {
              tipo: 'card',
              token: token.id,
              metodoTarjeta,
              cuotas,
              documento:
                docTipo && docNumero.trim()
                  ? { tipo: docTipo, numero: docNumero.trim() }
                  : null,
            },
            tokenParaGuardar,
          };
        } catch {
          toast(t.pay.cardRejectedFields, 'error');
          return null;
        } finally {
          setTrabajando(false);
        }
      },
    }),
    [
      listo, modo, banco, docTipo, docNumero, elegida, titular, metodoTarjeta,
      mp, guardadas, cuotas, guardar, isSignedIn, tipoPersona, customerName, toast, t,
    ],
  );

  if (fallo) {
    return (
      <p className="rounded-xl bg-state-warning/10 px-4 py-3 text-sm text-ink-600">
        {t.pay.sdkFailed}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tarjeta o PSE. Dos formas de pagar ahora, no dos pasarelas. */}
      {ofrecePse && (
        <div className="flex gap-2">
          {([
            { id: 'card' as const, icon: CreditCard, label: t.pay.card },
            { id: 'pse' as const, icon: Building2, label: t.pay.pse },
          ]).map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setModo(id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold transition-colors',
                modo === id ? 'bg-brand text-white' : 'bg-surface-field text-ink-500',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      )}

      {modo === 'card' ? (
        <>
          {guardadas.length > 0 && (
            <div className="space-y-2">
              {guardadas.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-4 py-3 transition-colors',
                    elegida === c.id ? 'bg-brand-50 ring-2 ring-brand' : 'bg-surface-field',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setElegida(c.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <CreditCard
                      className={cn('h-4 w-4 shrink-0', elegida === c.id ? 'text-brand' : 'text-ink-300')}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold uppercase text-ink-700">
                        {c.brand ?? t.pay.card} ···· {c.last_four}
                      </span>
                      {c.exp_month && c.exp_year && (
                        <span className="block text-xs text-ink-300">
                          {String(c.exp_month).padStart(2, '0')}/{String(c.exp_year).slice(-2)}
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch(`/api/pago/tarjetas/${c.id}`, { method: 'DELETE' });
                      setGuardadas((lista) => lista.filter((x) => x.id !== c.id));
                      setElegida((actual) => (actual === c.id ? null : actual));
                    }}
                    className="shrink-0 rounded-lg p-2 text-ink-300 hover:text-state-danger"
                    aria-label={t.pay.forgetCard}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}

              {elegida && (
                <button
                  type="button"
                  onClick={() => setElegida(null)}
                  className="inline-flex items-center gap-1.5 px-1 py-2 text-xs font-bold text-brand"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t.pay.useAnotherCard}
                </button>
              )}
            </div>
          )}

          {!mp ? (
            <p className="flex items-center gap-2 py-6 text-sm text-ink-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t.common.loading}
            </p>
          ) : (
            <>
              {!elegida && (
                <>
                  <div>
                    <p className="label">{t.pay.cardNumber}</p>
                    <div id="campo-numero" className="marco-pasarela" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="label">{t.pay.expiry}</p>
                      <div id="campo-caducidad" className="marco-pasarela" />
                    </div>
                    <div>
                      <p className="label">{t.pay.cvv}</p>
                      <div id="campo-cvv" className="marco-pasarela" />
                    </div>
                  </div>
                  <Input
                    value={titular}
                    onChange={(e) => setTitular(e.target.value)}
                    label={t.pay.cardholder}
                    placeholder={t.pay.cardholderPlaceholder}
                    autoComplete="cc-name"
                  />
                </>
              )}

              {elegida && (
                <div className="max-w-[10rem]">
                  <p className="label">{t.pay.cvv}</p>
                  <div id="campo-cvv" className="marco-pasarela" />
                </div>
              )}

              {documentos.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
                  <Select
                    label={t.pay.documentType}
                    value={docTipo}
                    onChange={(e) => setDocTipo(e.target.value)}
                  >
                    {documentos.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.id}
                      </option>
                    ))}
                  </Select>
                  <Input
                    value={docNumero}
                    onChange={(e) => setDocNumero(e.target.value)}
                    label={t.pay.documentNumber}
                    inputMode="numeric"
                  />
                </div>
              )}

              {inline.installments && opcionesCuotas.length > 1 && (
                <Select
                  label={t.pay.installments}
                  value={String(cuotas)}
                  onChange={(e) => setCuotas(Number(e.target.value))}
                >
                  {opcionesCuotas.map((o) => (
                    <option key={o.n} value={o.n}>
                      {o.texto}
                    </option>
                  ))}
                </Select>
              )}

              {isSignedIn && !elegida && (
                <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-600">
                  <input
                    type="checkbox"
                    checked={guardar}
                    onChange={(e) => setGuardar(e.target.checked)}
                    className="h-4 w-4 rounded border-ink-200 text-brand"
                  />
                  {t.pay.saveCard}
                </label>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <Select label={t.pay.bank} value={banco} onChange={(e) => setBanco(e.target.value)}>
            <option value="">{t.pay.chooseBank}</option>
            {bancos.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nombre}
              </option>
            ))}
          </Select>

          <Select
            label={t.pay.personType}
            value={tipoPersona}
            onChange={(e) => setTipoPersona(e.target.value as 'individual' | 'association')}
          >
            <option value="individual">{t.pay.person}</option>
            <option value="association">{t.pay.company}</option>
          </Select>

          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <Select
              label={t.pay.documentType}
              value={docTipo}
              onChange={(e) => setDocTipo(e.target.value)}
            >
              {documentos.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id}
                </option>
              ))}
            </Select>
            <Input
              value={docNumero}
              onChange={(e) => setDocNumero(e.target.value)}
              label={t.pay.documentNumber}
              inputMode="numeric"
            />
          </div>

          {/* Decirlo antes, no después: PSE acaba en la web del banco porque PSE
              es eso, y encontrárselo sin aviso parece que algo ha fallado. */}
          <p className="text-xs text-ink-300">{t.pay.pseLeaves}</p>
        </>
      )}

      <p className="flex items-center gap-2 text-xs text-ink-300">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
        {t.pay.neverStored}
      </p>

      {trabajando && (
        <p className="flex items-center gap-2 text-xs text-ink-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t.checkout.processing}
        </p>
      )}
    </div>
  );
});
