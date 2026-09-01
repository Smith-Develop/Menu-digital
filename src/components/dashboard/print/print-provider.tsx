'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Ticket,
  PAPER_WIDTH,
  DEFAULT_PRINT_SETTINGS,
  type PrintSettings,
  type TicketOrder,
} from '@/components/dashboard/print/ticket';
import { useI18n } from '@/i18n/provider';

type PrintContextValue = {
  /** Imprime un ticket ya. */
  print: (order: TicketOrder) => void;
  /** Imprime solo si el restaurante tiene activada la impresión automática. */
  printIfAuto: (order: TicketOrder) => void;
  settings: PrintSettings;
};

const PrintContext = createContext<PrintContextValue | null>(null);

/**
 * Impresión de tickets.
 *
 * El ticket se monta en un contenedor propio y `window.print()` lo saca por la
 * impresora del sistema. El navegador no deja elegir impresora ni saltarse el
 * diálogo —es una restricción de seguridad, no del código—, así que para
 * imprimir en silencio hay que abrir Chrome en el equipo de caja con
 * `--kiosk-printing`: entonces esta misma llamada imprime directa en la
 * impresora predeterminada, sin ventana.
 */
export function PrintProvider({
  restaurant,
  settings,
  children,
}: {
  restaurant: {
    name: string;
    address: string | null;
    phone: string | null;
    logoUrl: string | null;
    taxId?: string | null;
  };
  settings: PrintSettings;
  children: ReactNode;
}) {
  const { locale } = useI18n();
  const [order, setOrder] = useState<TicketOrder | null>(null);
  const [mounted, setMounted] = useState(false);
  const pendingCopies = useRef(0);

  useEffect(() => setMounted(true), []);

  // El tamaño del papel se fija con @page, que es lo que lee la impresora.
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'yumi-print-page';
    const size = settings.paper === 'a4' ? 'A4' : `${settings.paper} auto`;
    const margin = settings.paper === 'a4' ? '10mm' : '2mm';
    style.textContent = `@page { size: ${size}; margin: ${margin}; }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [settings.paper]);

  const print = useCallback(
    (next: TicketOrder) => {
      setOrder(next);
      pendingCopies.current = Math.max(settings.copies, 1);
    },
    [settings.copies],
  );

  const printIfAuto = useCallback(
    (next: TicketOrder) => {
      if (settings.autoPrint) print(next);
    },
    [settings.autoPrint, print],
  );

  // Se imprime en el efecto, después de que el ticket esté en el DOM.
  useEffect(() => {
    if (!order) return;

    const timer = setTimeout(() => {
      document.body.classList.add('printing-ticket');
      for (let copy = 0; copy < pendingCopies.current; copy += 1) {
        window.print();
      }
      document.body.classList.remove('printing-ticket');
      setOrder(null);
    }, 120);

    return () => clearTimeout(timer);
  }, [order]);

  return (
    <PrintContext.Provider value={{ print, printIfAuto, settings }}>
      {children}
      {mounted &&
        order &&
        createPortal(
          <div
            id="ticket-root"
            aria-hidden
            style={{
              position: 'fixed',
              left: '-10000px',
              top: 0,
              background: '#fff',
              width: PAPER_WIDTH[settings.paper],
            }}
          >
            <Ticket order={order} restaurant={restaurant} settings={settings} locale={locale} />
          </div>,
          document.body,
        )}
    </PrintContext.Provider>
  );
}

export function usePrint(): PrintContextValue {
  const ctx = useContext(PrintContext);
  if (!ctx) {
    // Fuera del panel (por ejemplo en una vista pública) no hay impresora.
    return {
      print: () => {},
      printIfAuto: () => {},
      settings: DEFAULT_PRINT_SETTINGS,
    };
  }
  return ctx;
}
