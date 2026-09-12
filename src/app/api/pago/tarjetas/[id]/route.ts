import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { olvidarTarjeta } from '@/lib/payments/inline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Olvidar una tarjeta guardada.
 *
 * Se da de baja también en la pasarela, no sólo aquí: dejar de enseñarla y
 * dejarla viva en la cuenta del comercio no es lo que pidió el cliente.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'SIN_SESION' }, { status: 401 });

  const resultado = await olvidarTarjeta(id, user.id);
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
