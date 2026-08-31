import type { Dictionary } from '@/i18n/dictionaries/es';

type Status =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'delivering'
  | 'completed'
  | 'cancelled';

/**
 * Texto del aviso para cada estado del pedido.
 *
 * No todos los estados merecen molestar al cliente: `confirmed` ocurre a la vez
 * que el pedido se hace, y él está mirando la pantalla, así que no se avisa.
 */
export function orderPushMessage(
  status: Status,
  t: Dictionary,
  restaurantName: string,
  code: string,
): { title: string; body: string } | null {
  const push = t.push;
  switch (status) {
    case 'preparing':
      return { title: push.preparingTitle, body: push.preparingBody.replace('{restaurant}', restaurantName) };
    case 'ready':
      return { title: push.readyTitle, body: push.readyBody.replace('{code}', code) };
    case 'served':
      return { title: push.servedTitle, body: push.servedBody };
    case 'delivering':
      return { title: push.deliveringTitle, body: push.deliveringBody };
    case 'completed':
      return { title: push.completedTitle, body: push.completedBody };
    case 'cancelled':
      return { title: push.cancelledTitle, body: push.cancelledBody };
    default:
      return null;
  }
}
