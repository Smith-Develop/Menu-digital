'use client';

import { Bike, Check, Layers, Zap } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { formatDate, cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';

export type CourierPlanRow = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: string;
  maxRestaurants: number | null;
  allowsPool: boolean;
  poolPriority: number;
  features: string[];
};

/**
 * El plan del repartidor.
 *
 * A un repartidor no se le vende software: se le vende llegar antes a los
 * pedidos. Por eso lo que se enseña de cada plan es para cuántos locales puede
 * trabajar y si puede coger de la bolsa común, no una lista de funciones.
 *
 * Sin plan asignado no se le bloquea nada: un repartidor recién llegado tiene
 * que poder trabajar mientras alguien decide qué le corresponde.
 */
export function CourierPlanCard({
  current,
  until,
  plans,
}: {
  current: CourierPlanRow | null;
  until: string | null;
  plans: CourierPlanRow[];
}) {
  const { t, locale } = useI18n();

  const limite = (plan: CourierPlanRow) =>
    plan.maxRestaurants === null
      ? t.courierPlan.unlimitedRestaurants
      : `${plan.maxRestaurants} ${plan.maxRestaurants === 1 ? t.courierPlan.restaurant : t.courierPlan.restaurants}`;

  return (
    <section className="rounded-2xl bg-white p-5 shadow-chip">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-base font-bold text-ink-700">{t.courierPlan.title}</h2>
        {current && until && (
          <span className="text-xs text-ink-300">
            {t.courierPlan.until} {formatDate(until, locale)}
          </span>
        )}
      </div>

      {current ? (
        <div className="mt-3 rounded-xl bg-brand-50 p-4">
          <p className="font-display text-lg font-bold text-brand-700">{current.name}</p>
          <ul className="mt-2 space-y-1.5 text-sm text-ink-600">
            <li className="flex items-center gap-2">
              <Bike className="h-4 w-4 shrink-0 text-brand-700" />
              {limite(current)}
            </li>
            <li className="flex items-center gap-2">
              <Layers className="h-4 w-4 shrink-0 text-brand-700" />
              {current.allowsPool ? t.courierPlan.poolYes : t.courierPlan.poolNo}
            </li>
            {current.poolPriority > 0 && (
              <li className="flex items-center gap-2">
                <Zap className="h-4 w-4 shrink-0 text-brand-700" />
                {t.courierPlan.priority}
              </li>
            )}
          </ul>
        </div>
      ) : (
        <p className="mt-3 rounded-xl bg-surface-field p-4 text-sm text-ink-400">
          {t.courierPlan.none}
        </p>
      )}

      {plans.length > 0 && (
        <>
          <p className="label mt-5">{t.courierPlan.available}</p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {plans.map((plan) => {
              const actual = current?.id === plan.id;
              return (
                <li
                  key={plan.id}
                  className={cn(
                    'rounded-xl border-2 p-4',
                    actual ? 'border-brand bg-brand-50' : 'border-surface-line bg-white',
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-display text-sm font-bold text-ink-700">{plan.name}</p>
                    {actual && <Check className="h-4 w-4 shrink-0 text-brand-700" />}
                  </div>
                  <p className="mt-1 font-display text-lg font-bold text-ink">
                    {plan.priceCents === 0
                      ? t.courierPlan.free
                      : `${formatMoney(plan.priceCents, plan.currency)}`}
                    {plan.priceCents > 0 && (
                      <span className="text-xs font-semibold text-ink-300">
                        /{plan.interval === 'year' ? t.courierPlan.year : t.courierPlan.month}
                      </span>
                    )}
                  </p>
                  {plan.description && (
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-400">{plan.description}</p>
                  )}
                  <ul className="mt-3 space-y-1 text-xs text-ink-500">
                    <li>· {limite(plan)}</li>
                    <li>· {plan.allowsPool ? t.courierPlan.poolYes : t.courierPlan.poolNo}</li>
                  </ul>
                </li>
              );
            })}
          </ul>

          {/* El alta la hace el superadministrador: todavía no hay cobro en
              línea para repartidores, así que ofrecer un botón de "contratar"
              prometería algo que no ocurre. */}
          <p className="mt-3 text-xs text-ink-300">{t.courierPlan.howToChange}</p>
        </>
      )}
    </section>
  );
}
