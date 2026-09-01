'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  Bike,
  Minus,
  Plus,
  ChevronDown,
  Search,
  ShoppingBag,
  Store,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Input, Select } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { MoneyInput } from '@/components/ui/money-input';
import { createCounterOrder } from '@/app/dashboard/actions';
import { formatMoney } from '@/lib/money';
import { cn, initials } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import type { Enums } from '@/types/database';

export type PosOption = {
  id: string;
  name: string;
  priceDeltaCents: number;
};

export type PosGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  options: PosOption[];
};

export type PosProduct = {
  id: string;
  categoryId: string | null;
  name: string;
  priceCents: number;
  imageUrl: string | null;
  isAvailable: boolean;
  trackStock: boolean;
  stockQty: number;
  groups: PosGroup[];
};

export type PosCategory = { id: string; name: string };
export type PosTable = { id: string; code: string; name: string };

/** Línea del ticket en curso. Mismo plato con opciones distintas son líneas distintas. */
type Line = {
  key: string;
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  optionIds: string[];
  optionNames: string[];
  notes: string;
};

/**
 * Caja: pedidos por teléfono y en el mostrador.
 *
 * Existe para no obligar a quien coge el teléfono a abrir la tienda del
 * cliente, buscar los platos como si fuera un comensal y pasar por una pantalla
 * de pago que no le corresponde.
 *
 * El reparto es el de cualquier caja de restauración: la carta ocupa el lado
 * grande y el ticket vive fijo a la derecha, siempre visible. Quien atiende por
 * teléfono necesita leer en voz alta lo que lleva pedido sin cambiar de
 * pantalla.
 */
export function PosView({
  categories,
  products,
  tables,
  currency,
  currencyDecimals,
  taxRate,
  deliveryFeeCents,
  accepts,
}: {
  categories: PosCategory[];
  products: PosProduct[];
  tables: PosTable[];
  currency: string;
  currencyDecimals: number;
  taxRate: number;
  deliveryFeeCents: number;
  accepts: { cash: boolean; card: boolean; tpv: boolean };
}) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();

  const [categoria, setCategoria] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [eligiendo, setEligiendo] = useState<PosProduct | null>(null);
  const [seleccion, setSeleccion] = useState<Record<string, string[]>>({});
  const [notaLinea, setNotaLinea] = useState('');

  const [tipo, setTipo] = useState<Enums<'order_type'>>('pickup');
  const [mesa, setMesa] = useState('');
  const [comensales, setComensales] = useState('');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [nota, setNota] = useState('');
  const [propina, setPropina] = useState(0);

  const metodos = (['cash', 'card', 'tpv'] as const).filter((m) => accepts[m]);
  const [metodo, setMetodo] = useState<Enums<'payment_method'>>(metodos[0] ?? 'cash');
  const [cobrarYa, setCobrarYa] = useState(true);
  const [enviando, setEnviando] = useState(false);
  /** El carrito desplegado. Sólo se usa en móvil; en escritorio va en columna. */
  const [verTicket, setVerTicket] = useState(false);
  /**
   * Los datos del cliente, plegados o no.
   *
   * Se rellenan una vez al principio y después estorban: en una pantalla de
   * portátil ocupaban casi un tercio de la columna y empujaban el botón de
   * enviar fuera de la vista. Plegarlos deja ese alto para la lista, que es lo
   * que crece.
   */
  const [verDatos, setVerDatos] = useState(true);

  const money = (c: number) => formatMoney(c, currency, currencyDecimals);

  const visibles = useMemo(() => {
    const texto = busca.trim().toLowerCase();
    return products.filter(
      (p) =>
        (categoria === null || p.categoryId === categoria) &&
        (texto === '' || p.name.toLowerCase().includes(texto)),
    );
  }, [products, categoria, busca]);

  const subtotal = lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  const envio = tipo === 'delivery' ? deliveryFeeCents : 0;
  // Aproximación con el tipo general: el desglose real por plato lo calcula el
  // servidor al crear el pedido, que es quien conoce el tipo de cada línea.
  const impuestos = Math.round(subtotal * taxRate);
  const total = subtotal + envio + impuestos + propina;
  // Unidades, no líneas: al camarero le importa cuántos platos lleva pedidos.
  const unidades = lines.reduce((s, l) => s + l.quantity, 0);

  /** Abre el selector de opciones, o añade directamente si el plato no tiene. */
  function elegir(product: PosProduct) {
    if (product.groups.length === 0) {
      añadir(product, [], []);
      return;
    }
    // Las opciones marcadas por defecto vienen preseleccionadas: en una caja,
    // cada toque de menos cuenta.
    const inicial: Record<string, string[]> = {};
    for (const g of product.groups) {
      if (g.isRequired && g.options.length > 0) inicial[g.id] = [g.options[0].id];
      else inicial[g.id] = [];
    }
    setSeleccion(inicial);
    setNotaLinea('');
    setEligiendo(product);
  }

  function añadir(product: PosProduct, optionIds: string[], optionNames: string[], notes = '') {
    const extra = product.groups
      .flatMap((g) => g.options)
      .filter((o) => optionIds.includes(o.id))
      .reduce((s, o) => s + o.priceDeltaCents, 0);

    const key = `${product.id}|${[...optionIds].sort().join(',')}|${notes}`;
    setLines((current) => {
      const existe = current.find((l) => l.key === key);
      if (existe) {
        return current.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...current,
        {
          key,
          productId: product.id,
          name: product.name,
          unitPriceCents: product.priceCents + extra,
          quantity: 1,
          optionIds,
          optionNames,
          notes,
        },
      ];
    });
  }

  function confirmarOpciones() {
    const product = eligiendo;
    if (!product) return;

    const ids = Object.values(seleccion).flat();
    const faltan = product.groups.filter(
      (g) => g.isRequired && (seleccion[g.id]?.length ?? 0) < Math.max(g.minSelect, 1),
    );
    if (faltan.length > 0) {
      toast(`${t.pos.chooseRequired}: ${faltan.map((g) => g.name).join(', ')}`, 'error');
      return;
    }

    const nombres = product.groups
      .flatMap((g) => g.options)
      .filter((o) => ids.includes(o.id))
      .map((o) => o.name);

    añadir(product, ids, nombres, notaLinea.trim());
    setEligiendo(null);
  }

  function cambiarCantidad(key: string, delta: number) {
    setLines((current) =>
      current
        .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  function limpiar() {
    setVerTicket(false);
    setLines([]);
    setNombre('');
    setTelefono('');
    setDireccion('');
    setNota('');
    setPropina(0);
    setComensales('');
  }

  async function enviar() {
    if (lines.length === 0) return;
    if (tipo === 'delivery' && !direccion.trim()) {
      toast(t.cart.deliveryAddress, 'error');
      return;
    }
    if (tipo === 'dine_in' && !mesa) {
      toast(t.pos.chooseTable, 'error');
      return;
    }

    setEnviando(true);
    const result = await createCounterOrder({
      items: lines.map((l) => ({
        product_id: l.productId,
        quantity: l.quantity,
        option_ids: l.optionIds,
        notes: l.notes || null,
      })),
      type: tipo,
      paymentMethod: metodo,
      tableCode: tipo === 'dine_in' ? mesa : null,
      customerName: nombre,
      customerPhone: telefono,
      address: tipo === 'delivery' ? direccion : null,
      notes: nota,
      covers: comensales ? Number(comensales) : null,
      tipCents: propina,
      chargeNow: cobrarYa,
    });
    setEnviando(false);

    if (!result.ok) {
      toast(
        result.error === 'FORBIDDEN'
          ? t.common.forbidden
          : result.error.startsWith('PRODUCT_UNAVAILABLE')
            ? t.pos.productGone
            : result.error === 'MIN_ORDER_NOT_REACHED'
              ? t.pos.belowMinimum
              : t.common.error,
        'error',
      );
      return;
    }

    toast(
      result.data.charged
        ? `#${result.data.code} · ${money(result.data.totalCents)} · ${t.dashboard.markedPaid}`
        : `#${result.data.code} · ${money(result.data.totalCents)}`,
      'success',
    );
    limpiar();
    router.refresh();
  }

  const TIPOS: { id: Enums<'order_type'>; icon: typeof Bike; label: string }[] = [
    { id: 'pickup', icon: Store, label: t.cart.pickup },
    { id: 'delivery', icon: Bike, label: t.cart.delivery },
    { id: 'dine_in', icon: UtensilsCrossed, label: t.cart.dineIn },
  ];

  const METODO_LABEL: Record<string, string> = {
    cash: t.checkout.cash,
    card: t.checkout.card,
    tpv: t.checkout.tpv,
  };

  /** Piezas del ticket, para pintarlas en la columna o dentro del carrito. */
  function bloque(contenido: React.ReactNode, plano: boolean, titulo?: string) {
    return plano ? (
      <div className="mb-6 last:mb-0">
        {titulo && (
          <h2 className="mb-3 font-display text-base font-bold text-ink-700">{titulo}</h2>
        )}
        {contenido}
      </div>
    ) : (
      <section className="rounded-2xl bg-white p-5 shadow-chip">
        {titulo && (
          <h2 className="mb-3 font-display text-base font-bold text-ink-700">{titulo}</h2>
        )}
        {contenido}
      </section>
    );
  }

  const datos = (
    <>
      <div className="flex gap-2 rounded-xl bg-surface-field p-1">
        {TIPOS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTipo(id)}
            aria-pressed={tipo === id}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 rounded-lg px-2 py-2 text-[11px] font-bold transition-colors',
              tipo === id ? 'bg-white text-ink shadow-chip' : 'text-ink-400',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2.5">
        {tipo === 'dine_in' && (
          <div className="grid grid-cols-2 gap-3">
            <Select value={mesa} onChange={(e) => setMesa(e.target.value)} label={t.pos.table}>
              <option value="">—</option>
              {tables.map((m) => (
                <option key={m.id} value={m.code}>
                  {m.name}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              min={1}
              value={comensales}
              onChange={(e) => setComensales(e.target.value)}
              label={t.dashboard.covers}
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} label={t.common.name} />
          <Input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            label={t.common.phone}
            type="tel"
          />
        </div>

        {tipo === 'delivery' && (
          <Input
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            label={t.cart.deliveryAddress}
          />
        )}

        <Input value={nota} onChange={(e) => setNota(e.target.value)} label={t.common.notes} />
      </div>
    </>
  );

  /**
   * Las líneas del ticket.
   *
   * En la columna de escritorio la lista se desplaza por dentro: una comanda
   * larga empujaba el método de pago y el botón de enviar fuera de la pantalla,
   * y había que bajar toda la página para cerrar el pedido. En el móvil no hace
   * falta, porque la hoja del carrito ya se desplaza entera.
   */
  const lineas = (propio: boolean) => (
    <>
      {lines.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-300">{t.pos.emptyTicket}</p>
      ) : (
        <ul
          className={cn(
            'divide-y divide-surface-line',
            propio && 'min-h-0 flex-1 overflow-y-auto',
          )}
        >
          {lines.map((l) => (
            <li key={l.key} className="flex items-start gap-2 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink-700">{l.name}</span>
                {l.optionNames.length > 0 && (
                  <span className="block text-xs text-ink-300">{l.optionNames.join(' · ')}</span>
                )}
                {l.notes && <span className="block text-xs italic text-amber-700">“{l.notes}”</span>}
              </span>

              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => cambiarCantidad(l.key, -1)}
                  aria-label={t.common.remove}
                  className="icon-btn h-9 w-9"
                >
                  {l.quantity === 1 ? (
                    <Trash2 className="h-4 w-4" />
                  ) : (
                    <Minus className="h-4 w-4" />
                  )}
                </button>
                <span className="w-6 text-center text-sm font-bold tabular-nums">{l.quantity}</span>
                <button
                  type="button"
                  onClick={() => cambiarCantidad(l.key, 1)}
                  aria-label={t.common.add}
                  className="icon-btn h-9 w-9"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </span>

              <span className="w-16 shrink-0 text-right text-sm font-bold tabular-nums text-ink">
                {money(l.unitPriceCents * l.quantity)}
              </span>
            </li>
          ))}
        </ul>
      )}

    </>
  );

  /**
   * Subtotal, impuestos y total.
   *
   * Van con el pago y no con las líneas: es lo que se mira al cobrar, y dentro
   * de la lista le robaban a ésta todo el alto disponible hasta dejarla en cero
   * en una pantalla de portátil.
   */
  const totales = lines.length > 0 && (
    <dl className="space-y-1.5 text-sm">
      <div className="flex justify-between">
        <dt className="text-ink-400">{t.common.subtotal}</dt>
        <dd className="font-semibold tabular-nums text-ink-600">{money(subtotal)}</dd>
      </div>
      {envio > 0 && (
        <div className="flex justify-between">
          <dt className="text-ink-400">{t.common.delivery}</dt>
          <dd className="font-semibold tabular-nums text-ink-600">{money(envio)}</dd>
        </div>
      )}
      <div className="flex justify-between">
        <dt className="text-ink-400">{t.common.taxes}</dt>
        <dd className="font-semibold tabular-nums text-ink-600">{money(impuestos)}</dd>
      </div>
      {propina > 0 && (
        <div className="flex justify-between">
          <dt className="text-ink-400">{t.common.tip}</dt>
          <dd className="font-semibold tabular-nums text-ink-600">{money(propina)}</dd>
        </div>
      )}
      <div className="flex items-baseline justify-between border-t border-surface-line pt-2">
        <dt className="font-bold text-ink-700">{t.common.total}</dt>
        <dd className="font-display text-xl font-bold tabular-nums text-ink">{money(total)}</dd>
      </div>
    </dl>
  );

  const pago = (
    <>
      <p className="label">{t.checkout.paymentMethod}</p>
      <div className={cn('grid gap-2', metodos.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        {metodos.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMetodo(m)}
            aria-pressed={metodo === m}
            className={cn(
              'rounded-xl border-2 py-3 text-xs font-bold transition-colors',
              metodo === m
                ? 'border-brand bg-brand-50 text-brand-700'
                : 'border-transparent bg-surface-field text-ink-500 hover:bg-surface-muted',
            )}
          >
            {METODO_LABEL[m]}
          </button>
        ))}
      </div>

      {/* Propina y cobro comparten fila: los dos son decisiones del momento de
          pagar y separarlos gastaba alto que le hace falta al ticket.
          Cobrar al pedir es lo normal en el mostrador; en una mesa la cuenta se
          queda abierta hasta que el comensal se va. */}
      <div className="mt-3 flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <label className="label block" htmlFor="propina-caja">
            {t.common.tip}
          </label>
          <MoneyInput
            id="propina-caja"
            value={propina}
            decimals={currencyDecimals}
            onChange={setPropina}
            className="text-base"
          />
        </div>
        <label className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl bg-surface-field px-3 py-3.5">
          <input
            type="checkbox"
            checked={cobrarYa}
            onChange={(e) => setCobrarYa(e.target.checked)}
            className="h-5 w-5 shrink-0 accent-brand"
          />
          <span className="text-xs font-semibold leading-tight text-ink-600">
            {t.pos.chargeNow}
          </span>
        </label>
      </div>
    </>
  );

  const botones = (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={limpiar}
        disabled={lines.length === 0 || enviando}
        className="btn-ghost flex-1 disabled:opacity-40"
      >
        <X className="h-4 w-4" />
        {t.pos.clear}
      </button>
      <button
        type="button"
        onClick={enviar}
        disabled={lines.length === 0 || enviando}
        className="btn flex-[2] disabled:opacity-40"
      >
        {enviando ? t.checkout.processing : t.pos.send}
      </button>
    </div>
  );

  return (
    // En escritorio la pantalla no se desplaza: lo hacen la carta y el ticket,
    // cada uno por su lado. `100dvh` menos el relleno vertical del marco.
    <div className="grid gap-6 xl:h-[calc(100dvh-3rem)] xl:grid-cols-[1fr_380px] xl:overflow-hidden">
      {/* ─────────── Carta ─────────── */}
      <div className="flex min-h-0 min-w-0 flex-col gap-4">
        <div className="shrink-0">
          <h1 className="font-display text-2xl font-bold text-ink">{t.pos.title}</h1>
          <p className="mt-1 hidden text-sm text-ink-300 sm:block">{t.pos.subtitle}</p>
        </div>

        {/* Buscador y categorías quedan pegados arriba: en un móvil, cambiar de
            categoría no puede obligar a subir toda la carta. */}
        <div
          // Justo debajo de la cabecera del panel, no encima ni tapada por
          // ella: el alto lo publica el propio marco al medirse.
          style={{ top: 'var(--dash-header-h, 0px)' }}
          className="sticky z-20 -mx-4 shrink-0 space-y-3 bg-surface-soft px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 xl:static xl:mx-0 xl:bg-transparent xl:p-0"
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={t.pos.searchDish}
              aria-label={t.pos.searchDish}
              className="field w-full pl-10"
            />
          </div>

          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            <button
              type="button"
              onClick={() => setCategoria(null)}
              aria-pressed={categoria === null}
              className={cn(
                'shrink-0 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors',
                categoria === null
                  ? 'bg-ink text-white'
                  : 'bg-white text-ink-400 hover:bg-surface-field',
              )}
            >
              {t.pos.all}
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoria(c.id)}
                aria-pressed={categoria === c.id}
                className={cn(
                  'shrink-0 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors',
                  categoria === c.id
                    ? 'bg-ink text-white'
                    : 'bg-white text-ink-400 hover:bg-surface-field',
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {visibles.length === 0 ? (
          <EmptyState
            icon={<UtensilsCrossed className="h-7 w-7" />}
            title={t.pos.noDishes}
            className="rounded-2xl bg-white shadow-chip"
          />
        ) : (
          // El hueco de abajo deja sitio a la barra fija del carrito.
          <ul className="grid grid-cols-2 gap-3 pb-28 sm:grid-cols-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pb-2 2xl:grid-cols-4">
            {visibles.map((p) => {
              const agotado = !p.isAvailable || (p.trackStock && p.stockQty <= 0);
              const enTicket = lines
                .filter((l) => l.productId === p.id)
                .reduce((s, l) => s + l.quantity, 0);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => elegir(p)}
                    disabled={agotado}
                    className={cn(
                      'relative flex h-full w-full flex-col overflow-hidden rounded-2xl bg-white text-left shadow-chip transition-shadow',
                      agotado ? 'cursor-not-allowed opacity-40' : 'active:scale-[0.98] hover:shadow-lg',
                    )}
                  >
                    <span className="relative block aspect-[4/3] w-full bg-surface-muted">
                      {p.imageUrl ? (
                        <Image src={p.imageUrl} alt="" fill sizes="200px" className="object-cover" />
                      ) : (
                        <span className="flex h-full items-center justify-center font-display text-xl font-bold text-ink-200">
                          {initials(p.name)}
                        </span>
                      )}
                      {p.trackStock && !agotado && (
                        <span className="absolute right-1.5 top-1.5 rounded-md bg-ink/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {p.stockQty}
                        </span>
                      )}
                      {/* Cuántas van de este plato: sin esto, en el móvil hay
                          que abrir el ticket para saber si ya se añadió. */}
                      {enTicket > 0 && (
                        <span className="absolute left-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-bold text-brand-contrast">
                          {enTicket}
                        </span>
                      )}
                    </span>
                    <span className="flex flex-1 flex-col gap-1 p-3">
                      <span className="line-clamp-2 text-sm font-semibold leading-tight text-ink-700">
                        {p.name}
                      </span>
                      <span className="mt-auto font-display text-sm font-bold text-ink">
                        {agotado ? t.pos.soldOut : money(p.priceCents)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ─────────── Ticket: columna en escritorio ─────────── */}
      {/*
        Columna de alto fijo con una sola zona que crece: el ticket. Los datos y
        el pago se quedan quietos, que es lo que se pedía —una comanda larga ya
        no empuja el botón de enviar fuera de la pantalla—.

        El `overflow-y-auto` de la columna es la última red: en una pantalla muy
        baja, donde ni con el mínimo caben los tres bloques, es preferible poder
        desplazar la columna a que el botón quede inalcanzable.
      */}
      <aside
        aria-label={t.pos.ticket}
        className="hidden min-h-0 xl:flex xl:flex-col xl:gap-3 xl:overflow-y-auto"
      >
        <section className="shrink-0 rounded-2xl bg-white p-4 shadow-chip">
          <button
            type="button"
            onClick={() => setVerDatos((v) => !v)}
            aria-expanded={verDatos}
            className="flex w-full items-center gap-2 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-display text-base font-bold text-ink-700">
                {t.pos.orderDetails}
              </span>
              {!verDatos && (
                <span className="block truncate text-xs text-ink-300">
                  {TIPOS.find((x) => x.id === tipo)?.label}
                  {nombre.trim() ? ` · ${nombre.trim()}` : ''}
                  {tipo === 'dine_in' && mesa
                    ? ` · ${tables.find((m) => m.code === mesa)?.name ?? ''}`
                    : ''}
                </span>
              )}
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-ink-300 transition-transform',
                verDatos && 'rotate-180',
              )}
            />
          </button>
          {verDatos && <div className="mt-3">{datos}</div>}
        </section>

        <section className="flex min-h-[10rem] flex-1 flex-col rounded-2xl bg-white p-4 shadow-chip">
          <h2 className="mb-3 shrink-0 font-display text-base font-bold text-ink-700">
            {t.pos.ticket}
            {lines.length > 0 && <span className="ml-2 text-sm text-ink-300">({lines.length})</span>}
          </h2>
          {lineas(true)}
        </section>

        <section className="shrink-0 space-y-3 rounded-2xl bg-white p-4 shadow-chip">
          {totales}
          {pago}
          {botones}
        </section>
      </aside>

      {/* ─────────── Ticket: carrito en móvil ─────────── */}
      {/*
        En un móvil la columna de la derecha caía debajo de toda la carta, así
        que tomar un pedido obligaba a bajar hasta el final para escribir el
        nombre y volver a subir para añadir otro plato. Aquí funciona como el
        carrito de la tienda: se pide sin salir de la carta y la cuenta vive en
        una barra fija que se despliega cuando toca cerrar.
      */}
      {/* Se esconde con el ticket abierto: repetir el total debajo de la hoja
          no aporta y le roba sitio al pie con los botones. */}
      <div
        hidden={verTicket}
        className="fixed inset-x-0 bottom-0 z-[90] border-t border-surface-line bg-white/95 px-4 pt-3 backdrop-blur xl:hidden"
        style={{ paddingBottom: 'calc(0.75rem + var(--safe-bottom))' }}
      >
        <button
          type="button"
          onClick={() => setVerTicket(true)}
          disabled={lines.length === 0}
          // "2 platos · 24,20 €" no dice qué pasa al tocarlo.
          aria-label={t.pos.viewTicket}
          className="btn w-full justify-between py-4 disabled:opacity-40"
        >
          <span className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5" />
            {unidades > 0 ? `${unidades} ${t.pos.units}` : t.pos.emptyTicket}
          </span>
          <span className="font-display text-lg tabular-nums">{money(total)}</span>
        </button>
      </div>

      <Sheet
        open={verTicket}
        onClose={() => setVerTicket(false)}
        title={`${t.pos.ticket}${lines.length > 0 ? ` (${lines.length})` : ''}`}
        size="md"
        footer={botones}
      >
        {bloque(
          <>
            {lineas(false)}
            {totales && <div className="mt-4 border-t border-surface-line pt-4">{totales}</div>}
          </>,
          true,
        )}
        {bloque(datos, true, t.pos.orderDetails)}
        {bloque(pago, true, t.checkout.paymentMethod)}
      </Sheet>

      {/* ─────────── Opciones del plato ─────────── */}
      <Sheet open={eligiendo !== null} onClose={() => setEligiendo(null)} title={eligiendo?.name ?? ''}>
        {eligiendo?.groups.map((g) => (
          <div key={g.id} className="mb-5">
            <p className="label">
              {g.name}
              {g.isRequired && <span className="ml-1 text-state-danger">*</span>}
            </p>
            <div className="flex flex-col gap-2">
              {g.options.map((o) => {
                const marcado = (seleccion[g.id] ?? []).includes(o.id);
                const unico = g.maxSelect === 1;
                return (
                  <label
                    key={o.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-sm transition-colors',
                      marcado
                        ? 'border-brand bg-brand-50 font-bold text-brand-700'
                        : 'border-transparent bg-surface-field text-ink-500 hover:bg-surface-muted',
                    )}
                  >
                    <input
                      type={unico ? 'radio' : 'checkbox'}
                      name={`grupo-${g.id}`}
                      checked={marcado}
                      onChange={() =>
                        setSeleccion((s) => {
                          const actuales = s[g.id] ?? [];
                          if (unico) return { ...s, [g.id]: [o.id] };
                          return {
                            ...s,
                            [g.id]: marcado
                              ? actuales.filter((x) => x !== o.id)
                              : [...actuales, o.id].slice(0, g.maxSelect),
                          };
                        })
                      }
                      className="h-5 w-5 accent-brand"
                    />
                    <span className="min-w-0 flex-1">{o.name}</span>
                    {o.priceDeltaCents !== 0 && (
                      <span className="shrink-0 text-xs font-semibold text-ink-400">
                        +{money(o.priceDeltaCents)}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        ))}

        <label className="label block" htmlFor="nota-plato">
          {t.common.notes}
        </label>
        <input
          id="nota-plato"
          value={notaLinea}
          onChange={(e) => setNotaLinea(e.target.value)}
          maxLength={120}
          placeholder={t.pos.dishNotePlaceholder}
          className="field w-full"
        />

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={() => setEligiendo(null)} className="btn-ghost flex-1">
            {t.common.cancel}
          </button>
          <button type="button" onClick={confirmarOpciones} className="btn flex-1">
            {t.common.add}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
