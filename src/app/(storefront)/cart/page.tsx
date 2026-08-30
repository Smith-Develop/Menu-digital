import { CartRedirect } from '@/components/storefront/cart-redirect';

export const metadata = { title: 'Carrito' };

/**
 * Carrito del icono de la barra de navegación.
 *
 * El carrito real vive en `/r/<slug>/cart` porque siempre pertenece a un
 * restaurante concreto. Esta pantalla mira qué carrito hay abierto en el
 * navegador y lleva allí; si no hay ninguno, ofrece volver a la carta.
 */
export default function GlobalCartPage() {
  return <CartRedirect />;
}
