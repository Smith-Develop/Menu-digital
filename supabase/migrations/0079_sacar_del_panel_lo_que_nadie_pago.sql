-- =============================================================
--  Reparación: los pedidos que entraron sin pagarse
--
--  Mientras el fallo estuvo vivo, cada intento de pago rechazado dejó una
--  comanda en el panel del local. La regla ya está corregida en la 0078, pero
--  las que entraron siguen ahí, y el local no tiene forma de saber cuáles son:
--  se ven exactamente igual que las buenas.
--
--  Se mueven al estado en el que tendrían que haber nacido, no se borran. Un
--  pedido borrado se lleva por delante sus líneas, su rastro y la explicación
--  de por qué estuvo ahí; uno en «esperando el pago» desaparece de los paneles,
--  conserva todo y el barrido de intentos caducados lo cerrará solo.
--
--  Se tocan sólo los que nadie ha empezado a preparar. Si el local ya lo
--  confirmó, alguien tomó una decisión con ese pedido delante y sacárselo de la
--  pantalla ahora sería peor que dejarlo.
-- =============================================================

update public.orders o
   set status = 'awaiting_payment',
       updated_at = now()
 where o.payment_method = 'online'
   and o.status = 'pending'
   and o.payment_status <> 'paid'
   and o.paid_cents = 0
   -- Ni un solo apunte en el libro: si hubiera uno, aunque fuera parcial, este
   -- pedido sí tocó dinero y no es de los que hay que retirar.
   and not exists (
     select 1 from public.order_payments ap where ap.order_id = o.id
   )
   -- Y que su cobro no siga en vuelo: alguien puede estar pagándolo ahora
   -- mismo en la pantalla de su banco.
   and not exists (
     select 1 from public.payment_intents i
      where i.order_id = o.id and i.status in ('pending', 'redirected')
   );
