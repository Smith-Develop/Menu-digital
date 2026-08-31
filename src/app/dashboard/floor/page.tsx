import { redirect } from 'next/navigation';

/**
 * La sala vive ahora dentro de los pedidos en directo: eran dos pantallas para
 * el mismo trabajo —lo que hay abierto en el local y fuera de él—. La ruta se
 * conserva porque puede estar guardada o enlazada desde un aviso.
 */
export default function FloorRedirect() {
  redirect('/dashboard/orders');
}
