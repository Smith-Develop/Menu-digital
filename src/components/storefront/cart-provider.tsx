'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useDeliveryCart, useTableCart, type CartStore } from '@/lib/cart';

type CartContextValue = {
  /** Almacén activo: el de la mesa cuando se pide sentado, si no el de fuera. */
  store: CartStore;
  /** true si el cliente está pidiendo desde una mesa. */
  inTable: boolean;
  /** Código de la mesa, cuando aplica. */
  tableCode: string | null;
};

const CartContext = createContext<CartContextValue>({
  store: useDeliveryCart,
  inTable: false,
  tableCode: null,
});

/**
 * Fija qué cesta manda en esta parte de la aplicación.
 *
 * Pedir sentado y pedir a domicilio son dos cestas distintas: la de la mesa se
 * queda con el pedido hasta que el restaurante lo cobra, mientras que la de
 * fuera del local se vacía al confirmar. Mezclarlas haría que un cliente con la
 * comanda abierta en el restaurante se encontrara esos platos al pedir a casa.
 */
export function CartProvider({
  inTable,
  tableCode,
  children,
}: {
  inTable: boolean;
  tableCode: string | null;
  children: ReactNode;
}) {
  const store = inTable ? useTableCart : useDeliveryCart;

  return (
    <CartContext.Provider value={{ store, inTable, tableCode }}>{children}</CartContext.Provider>
  );
}

export function useCartContext(): CartContextValue {
  return useContext(CartContext);
}

/** Almacén de carrito activo según el contexto. */
export function useActiveCart(): CartStore {
  return useCartContext().store;
}

/**
 * Sincroniza la cesta activa con el restaurante que se está viendo.
 * Si el cliente cambia de local, el almacén vacía las líneas anteriores.
 */
export function RestaurantSync({
  slug,
  name,
  currency,
  currencyDecimals,
  tableCode,
}: {
  slug: string;
  name: string;
  currency: string;
  currencyDecimals: number;
  tableCode: string | null;
}) {
  const store = useActiveCart();
  const setRestaurant = store((s) => s.setRestaurant);
  const setTableCode = store((s) => s.setTableCode);

  useEffect(() => {
    setRestaurant({ slug, name, currency, currencyDecimals });
    setTableCode(tableCode);
  }, [slug, name, currency, currencyDecimals, tableCode, setRestaurant, setTableCode]);

  return null;
}
