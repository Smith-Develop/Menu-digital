'use client';

import { useEffect } from 'react';
import { useCart } from '@/lib/cart';

/**
 * Sincroniza el carrito con el restaurante que se está viendo.
 * Si el cliente cambia de local, el store vacía las líneas anteriores.
 */
export function RestaurantProvider({
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
  const setRestaurant = useCart((s) => s.setRestaurant);
  const setTableCode = useCart((s) => s.setTableCode);

  useEffect(() => {
    setRestaurant({ slug, name, currency, currencyDecimals });
    setTableCode(tableCode);
  }, [slug, name, currency, currencyDecimals, tableCode, setRestaurant, setTableCode]);

  return null;
}
