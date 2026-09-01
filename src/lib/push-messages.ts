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
 * `pending` no avisa: es el instante en que el cliente pulsa el botón y ya está
 * mirando la pantalla. El resto sí, incluido `confirmed`, porque entre pedir y
 * que el local acepte pueden pasar minutos y es justo lo que se quiere saber.
 */
export function orderPushMessage(
  status: Status,
  t: Dictionary,
  restaurantName: string,
  code: string,
): { title: string; body: string } | null {
  const push = t.push;
  switch (status) {
    case 'confirmed':
      return { title: push.confirmedTitle, body: push.confirmedBody.replace('{restaurant}', restaurantName) };
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
