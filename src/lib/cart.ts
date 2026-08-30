'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type CartOption = {
  id: string;
  group: string;
  name: string;
  priceDeltaCents: number;
};

export type CartLine = {
  /** Identifica la línea: mismo plato con distintas opciones son líneas distintas. */
  key: string;
  productId: string;
  name: string;
  image: string | null;
  unitPriceCents: number;
  quantity: number;
  options: CartOption[];
  notes?: string;
};

export type CartState = {
  /** Un carrito por restaurante: cambiar de local no mezcla pedidos. */
  restaurantSlug: string | null;
  restaurantName: string | null;
  currency: string;
  currencyDecimals: number;
  lines: CartLine[];
  /** Código de mesa cuando se ha entrado por QR. */
  tableCode: string | null;
  /** Cupón validado contra el servidor, listo para enviarse con el pedido. */
  coupon: AppliedCoupon | null;

  setRestaurant: (info: {
    slug: string;
    name: string;
    currency: string;
    currencyDecimals: number;
  }) => void;
  setTableCode: (code: string | null) => void;
  addLine: (line: Omit<CartLine, 'key'>) => void;
  updateQuantity: (key: string, quantity: number) => void;
  removeLine: (key: string) => void;
  setCoupon: (coupon: AppliedCoupon | null) => void;
  clear: () => void;
};

export type AppliedCoupon = {
  code: string;
  kind: 'percentage' | 'fixed' | 'free_delivery';
  discountCents: number;
  description: string | null;
};

function lineKey(productId: string, options: CartOption[], notes?: string): string {
  const optionPart = options
    .map((o) => o.id)
    .sort()
    .join('|');
  return `${productId}::${optionPart}::${notes?.trim() ?? ''}`;
}

export function lineTotal(line: CartLine): number {
  const optionsTotal = line.options.reduce((sum, o) => sum + o.priceDeltaCents, 0);
  return (line.unitPriceCents + optionsTotal) * line.quantity;
}

/**
 * Fábrica del almacén de carrito.
 *
 * Se instancia dos veces con claves de almacenamiento distintas: pedir sentado
 * en la mesa y pedir a domicilio son dos cestas que no deben mezclarse — un
 * cliente puede tener una comanda abierta en el local y, a la vez, un pedido a
 * casa a medio montar.
 */
function createCartStore(storageKey: string) {
  return create<CartState>()(
  persist(
    (set, get) => ({
      restaurantSlug: null,
      restaurantName: null,
      currency: 'EUR',
      currencyDecimals: 2,
      lines: [],
      tableCode: null,
      coupon: null,

      setRestaurant: ({ slug, name, currency, currencyDecimals }) => {
        const current = get().restaurantSlug;
        set({
          restaurantSlug: slug,
          restaurantName: name,
          currency,
          currencyDecimals,
          // Al cambiar de restaurante el carrito anterior deja de tener sentido.
          lines: current && current !== slug ? [] : get().lines,
          tableCode: current && current !== slug ? null : get().tableCode,
          coupon: current && current !== slug ? null : get().coupon,
        });
      },

      setTableCode: (code) => set({ tableCode: code }),

      addLine: (line) => {
        const key = lineKey(line.productId, line.options, line.notes);
        // Cambiar la cesta invalida el descuento: hay que revalidarlo.
        set({ coupon: null });
        const lines = [...get().lines];
        const existing = lines.findIndex((l) => l.key === key);

        if (existing >= 0) {
          lines[existing] = {
            ...lines[existing],
            quantity: lines[existing].quantity + line.quantity,
          };
        } else {
          lines.push({ ...line, key });
        }
        set({ lines });
      },

      updateQuantity: (key, quantity) => {
        if (quantity <= 0) {
          set({ lines: get().lines.filter((l) => l.key !== key), coupon: null });
          return;
        }
        set({
          lines: get().lines.map((l) => (l.key === key ? { ...l, quantity } : l)),
          coupon: null,
        });
      },

      removeLine: (key) =>
        set({ lines: get().lines.filter((l) => l.key !== key), coupon: null }),

      setCoupon: (coupon) => set({ coupon }),

      clear: () => set({ lines: [], coupon: null }),
    }),
    {
      name: storageKey,
      storage: createJSONStorage(() => localStorage),
      version: 2,
    },
  ),
  );
}

/** Cesta de los pedidos a domicilio y para recoger. */
export const useDeliveryCart = createCartStore('yumi-cart-delivery');

/** Cesta de la comanda que se pide desde la mesa. */
export const useTableCart = createCartStore('yumi-cart-table');

export type CartStore = typeof useDeliveryCart;

/** Selectores derivados: evitan recalcular en cada componente. */
export function useCartCount(store: CartStore = useDeliveryCart): number {
  return store((s) => s.lines.reduce((n, l) => n + l.quantity, 0));
}

export function useCartSubtotal(store: CartStore = useDeliveryCart): number {
  return store((s) => s.lines.reduce((sum, l) => sum + lineTotal(l), 0));
}

/** Payload que espera la función place_order de Postgres. */
export function cartToOrderItems(lines: CartLine[]) {
  return lines.map((line) => ({
    product_id: line.productId,
    quantity: line.quantity,
    notes: line.notes ?? null,
    option_ids: line.options.map((o) => o.id),
  }));
}
