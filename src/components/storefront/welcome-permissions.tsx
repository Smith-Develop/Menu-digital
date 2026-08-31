'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { detectCity, setCustomerLocation } from '@/app/actions/location';
import { subscribeToPush } from '@/lib/push-client';
import { useT } from '@/i18n/provider';

const HECHO = 'yumi_permisos';

/**
 * Permisos de la primera visita.
 *
 * Se piden los dos juntos y explicando para qué sirven, en lugar de dejar que
 * el navegador los saque a bocajarro: un permiso que aparece sin contexto se
 * deniega casi siempre, y una vez denegado no se puede volver a pedir.
 *
 * Ninguno es obligatorio. Quien los rechace sigue usando la aplicación
 * eligiendo su ciudad a mano y mirando el estado de su pedido en pantalla.
 */
export function WelcomePermissions({ citySlug }: { citySlug: string | null }) {
  const t = useT();
  const router = useRouter();

  const [visible, setVisible] = useState(false);
  const [paso, setPaso] = useState<'ubicacion' | 'avisos'>('ubicacion');
  const [trabajando, setTrabajando] = useState(false);
  const [ciudad, setCiudad] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(HECHO)) return;
    } catch {
      return;
    }
    // Un respiro antes de aparecer: caer encima de la portada nada más abrirla
    // se siente como un asalto.
    const t = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(t);
  }, []);

  function terminar() {
    try {
      localStorage.setItem(HECHO, '1');
    } catch {
      /* sin almacenamiento volverá a preguntar, no es grave */
    }
    setVisible(false);
    router.refresh();
  }

  function pedirUbicacion() {
    if (!navigator.geolocation) {
      setPaso('avisos');
      return;
    }

    setTrabajando(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const encontrada = await detectCity(pos.coords.latitude, pos.coords.longitude);
        if (encontrada.ok) {
          await setCustomerLocation({ city: encontrada.city, citySlug: encontrada.citySlug });
          setCiudad(encontrada.city);
        }
        setTrabajando(false);
        setPaso('avisos');
      },
      () => {
        setTrabajando(false);
        setPaso('avisos');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  async function pedirAvisos() {
    setTrabajando(true);
    await subscribeToPush({ citySlug });
    setTrabajando(false);
    terminar();
  }

  if (!visible) return null;

  const enUbicacion = paso === 'ubicacion';

  return (
    <div className="fixed inset-0 z-[95] flex h-dvh w-screen items-end justify-center bg-ink/60 p-4 backdrop-blur-[2px] sm:items-center">
      <div className="w-full max-w-md rounded-sheet bg-white p-7 shadow-card animate-slide-up sm:animate-fade-up">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand">
          {enUbicacion ? <MapPin className="h-8 w-8" /> : <Bell className="h-8 w-8" />}
        </span>

        <h2 className="mt-5 text-center font-display text-xl font-bold text-ink">
          {enUbicacion ? t.permissions.locationTitle : t.permissions.notificationsTitle}
        </h2>
        <p className="mt-2 text-center text-sm leading-relaxed text-ink-300">
          {enUbicacion ? t.permissions.locationBody : t.permissions.notificationsBody}
        </p>

        {ciudad && !enUbicacion && (
          <p className="mt-3 flex items-center justify-center gap-1.5 text-sm font-bold text-state-success">
            <Check className="h-4 w-4" />
            {ciudad}
          </p>
        )}

        <div className="mt-7 space-y-2">
          <Button
            size="block"
            loading={trabajando}
            onClick={enUbicacion ? pedirUbicacion : pedirAvisos}
          >
            {enUbicacion ? t.permissions.locationCta : t.permissions.notificationsCta}
          </Button>
          <button
            type="button"
            onClick={enUbicacion ? () => setPaso('avisos') : terminar}
            className="w-full py-2 text-sm font-semibold text-ink-300 transition-colors hover:text-ink"
          >
            {t.permissions.later}
          </button>
        </div>
      </div>
    </div>
  );
}
