'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle, Globe, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select, Switch, Textarea } from '@/components/ui/input';
import { Sheet, ConfirmDialog } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import {
  savePlatformCountry,
  deletePlatformCountry,
  savePlatformCities,
  setCountryGateways,
} from '@/app/admin/actions';
import { CURRENCIES } from '@/lib/money';
import { useI18n, interpolate } from '@/i18n/provider';
import { cn } from '@/lib/utils';

export type PaisAdmin = {
  code: string;
  name: string;
  currency: string;
  timezone: string;
  isActive: boolean;
  position: number;
  cities: string[];
  gateways: string[];
  restaurants: number;
};

export type PasarelaSimple = { id: string; name: string; countries: string[] };

const VACIO = { code: '', name: '', currency: 'EUR', timezone: 'Europe/Madrid', isActive: true, position: 0 };

/**
 * Dónde opera la plataforma.
 *
 * Los países estaban escritos en el código, así que abrir Guatemala exigía un
 * despliegue y todos los locales elegían entre la misma lista larga. Aquí se
 * abren solos, con sus ciudades y con las pasarelas que se ofrecen allí, y cada
 * comercio ve una lista corta que es la suya.
 */
export function PlacesManager({
  paises,
  pasarelas,
}: {
  paises: PaisAdmin[];
  pasarelas: PasarelaSimple[];
}) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();

  const [editando, setEditando] = useState<(typeof VACIO & { esNuevo?: boolean }) | null>(null);
  const [abierto, setAbierto] = useState<PaisAdmin | null>(null);
  const [ciudades, setCiudades] = useState('');
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [borrando, setBorrando] = useState<PaisAdmin | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  function abrirPais(p: PaisAdmin) {
    setAbierto(p);
    setCiudades(p.cities.join('\n'));
    setElegidas(p.gateways);
  }

  async function guardarPais() {
    if (!editando) return;
    setOcupado('pais');
    const result = await savePlatformCountry({
      code: editando.code,
      name: editando.name.trim(),
      currency: editando.currency,
      timezone: editando.timezone.trim(),
      is_active: editando.isActive,
      position: editando.position,
    });
    setOcupado(null);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    toast(t.places.saved, 'success');
    setEditando(null);
    router.refresh();
  }

  async function guardarCiudades() {
    if (!abierto) return;
    setOcupado('ciudades');
    const result = await savePlatformCities(abierto.code, ciudades.split('\n'));
    setOcupado(null);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    toast(t.places.saved, 'success');
    router.refresh();
  }

  async function guardarPasarelas() {
    if (!abierto) return;
    setOcupado('pasarelas');
    const result = await setCountryGateways(abierto.code, elegidas);
    setOcupado(null);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    toast(t.places.saved, 'success');
    router.refresh();
  }

  async function borrar() {
    if (!borrando) return;
    setOcupado('borrar');
    const result = await deletePlatformCountry(borrando.code);
    setOcupado(null);
    setBorrando(null);
    if (!result.ok) {
      const textos = t.places as unknown as Record<string, string>;
      toast(textos[result.error] ?? result.error, 'error');
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{t.places.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-300">{t.places.subtitle}</p>
        </div>
        <Button onClick={() => setEditando({ ...VACIO, esNuevo: true })}>
          <Plus className="h-4 w-4" />
          {t.places.addCountry}
        </Button>
      </div>

      {paises.length === 0 ? (
        <p className="rounded-2xl bg-white px-5 py-12 text-center text-sm text-ink-300 shadow-chip">
          {t.places.empty}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {paises.map((p) => (
            <li key={p.code} className="rounded-2xl bg-white p-4 shadow-chip">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-field font-mono text-xs font-bold text-ink-500">
                  {p.code}
                </span>
                <button type="button" onClick={() => abrirPais(p)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-display text-base font-bold text-ink">
                    {p.name}
                  </span>
                  <span className="block text-xs text-ink-300">
                    {p.currency} · {interpolate(t.places.citiesCount, { n: p.cities.length })}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setBorrando(p)}
                  className="icon-btn h-8 w-8 text-state-danger"
                  aria-label={t.common.delete}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <p className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                {p.gateways.length > 0 ? (
                  pasarelas
                    .filter((g) => p.gateways.includes(g.id))
                    .map((g) => (
                      <span
                        key={g.id}
                        className="rounded-md bg-accent-soft px-2 py-0.5 font-semibold text-ink-600"
                      >
                        {g.name}
                      </span>
                    ))
                ) : (
                  <span className="rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                    {t.places.gateways}: 0
                  </span>
                )}
                {!p.isActive && (
                  <span className="rounded-md bg-surface-field px-2 py-0.5 text-ink-300">
                    {t.common.inactive}
                  </span>
                )}
              </p>
              <p className="mt-2 text-xs text-ink-300">
                {interpolate(t.places.restaurants, { n: p.restaurants })}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* Alta y datos del país */}
      <Sheet
        open={editando !== null}
        onClose={() => setEditando(null)}
        title={editando?.esNuevo ? t.places.addCountry : t.places.editCountry}
        footer={
          <Button size="block" loading={ocupado === 'pais'} onClick={guardarPais}>
            {t.places.saveCountry}
          </Button>
        }
      >
        {editando && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,120px)_1fr]">
              <Input
                label={t.places.code}
                hint={t.places.codeHint}
                className="font-mono uppercase"
                maxLength={2}
                disabled={!editando.esNuevo}
                value={editando.code}
                onChange={(e) =>
                  setEditando({ ...editando, code: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })
                }
              />
              <Input
                label={t.places.name}
                value={editando.name}
                onChange={(e) => setEditando({ ...editando, name: e.target.value })}
                placeholder="Guatemala"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label={t.places.currency}
                hint={t.places.currencyHint}
                value={editando.currency}
                onChange={(e) => setEditando({ ...editando, currency: e.target.value })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name} ({c.symbol})
                  </option>
                ))}
              </Select>
              <Input
                label={t.places.timezone}
                value={editando.timezone}
                onChange={(e) => setEditando({ ...editando, timezone: e.target.value })}
                placeholder="America/Guatemala"
              />
            </div>

            <Switch
              label={t.places.active}
              checked={editando.isActive}
              onChange={(v) => setEditando({ ...editando, isActive: v })}
            />
          </div>
        )}
      </Sheet>

      {/* Ciudades y pasarelas del país */}
      <Sheet
        open={abierto !== null}
        onClose={() => setAbierto(null)}
        title={abierto?.name ?? ''}
        size="lg"
      >
        {abierto && (
          <div className="space-y-7">
            <div>
              <Textarea
                label={t.places.cities}
                hint={t.places.citiesHint}
                rows={10}
                className="text-sm"
                value={ciudades}
                onChange={(e) => setCiudades(e.target.value)}
              />
              <div className="mt-3 flex items-center gap-3">
                <Button loading={ocupado === 'ciudades'} onClick={guardarCiudades}>
                  {t.places.saveCities}
                </Button>
                <span className="text-xs text-ink-300">
                  {ciudades.split('\n').filter((c) => c.trim()).length === 0
                    ? t.places.noCities
                    : interpolate(t.places.citiesCount, {
                        n: ciudades.split('\n').filter((c) => c.trim()).length,
                      })}
                </span>
              </div>
            </div>

            <div>
              <p className="label">{t.places.gateways}</p>
              <p className="mb-3 -mt-1 text-xs text-ink-300">{t.places.gatewaysHint}</p>

              <ul className="space-y-2">
                {pasarelas.map((g) => {
                  const puesta = elegidas.includes(g.id);
                  // Ofrecerla donde no opera se puede —a veces el proveedor
                  // llega antes que su documentación— pero conviene decirlo.
                  const fuera = g.countries.length > 0 && !g.countries.includes(abierto.code);
                  return (
                    <li
                      key={g.id}
                      className={cn(
                        'flex items-center gap-3 rounded-xl px-4 py-3',
                        puesta ? 'bg-accent-soft' : 'bg-surface-field',
                      )}
                    >
                      <Switch
                        checked={puesta}
                        onChange={(v) =>
                          setElegidas(v ? [...elegidas, g.id] : elegidas.filter((x) => x !== g.id))
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-ink-700">{g.name}</span>
                        {fuera && puesta && (
                          <span className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                            <AlertTriangle className="h-3 w-3" />
                            {t.places.notHere}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-3">
                <Button loading={ocupado === 'pasarelas'} onClick={guardarPasarelas}>
                  {t.places.saveGateways}
                </Button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setEditando({ ...abierto, esNuevo: false });
                setAbierto(null);
              }}
              className="inline-flex items-center gap-2 text-xs font-bold text-brand"
            >
              <Globe className="h-3.5 w-3.5" />
              {t.places.editCountry}
            </button>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={borrando !== null}
        onClose={() => setBorrando(null)}
        onConfirm={borrar}
        title={t.common.delete}
        message={borrando?.name ?? ''}
        confirmLabel={t.common.delete}
        cancelLabel={t.common.cancel}
        loading={ocupado === 'borrar'}
      />
    </div>
  );
}
