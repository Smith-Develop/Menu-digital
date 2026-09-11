'use client';

import { useState } from 'react';
import { Input, Select } from '@/components/ui/input';
import { PAISES, ciudadesDe, getPais, type Pais } from '@/lib/countries';

/**
 * País y ciudad, elegidos de una lista.
 *
 * Se usa igual en los ajustes del local y en el alta del superadministrador,
 * porque el problema es el mismo: escribir el país a mano produce «CO», «Co» y
 * «Colombia» según el día, y entonces las pasarelas filtradas por país dejan de
 * encontrarlo y el comercio no ve ninguna forma de cobro sin saber por qué.
 *
 * La ciudad es lista cerrada sólo donde tenemos lista —Colombia, Honduras y
 * España—, y siempre con la puerta de «otra»: un local en un pueblo pequeño
 * tiene el mismo derecho a darse de alta que uno en la capital.
 */
export function CountryCityFields({
  country,
  city,
  onCountry,
  onCity,
  onSuggest,
  labels,
}: {
  country: string;
  city: string;
  onCountry: (code: string) => void;
  onCity: (nombre: string) => void;
  /** Se avisa del país elegido por si el formulario quiere proponer divisa y hora. */
  onSuggest?: (pais: Pais) => void;
  labels: { country: string; city: string; otherCity: string; cityFree: string };
}) {
  const lista = ciudadesDe(country);
  // Una ciudad que no está en la lista no se pierde: se abre el campo libre con
  // ella dentro, en vez de vaciarla por no reconocerla.
  const [libre, setLibre] = useState(() => Boolean(city) && lista.length > 0 && !lista.includes(city));

  function cambiarPais(code: string) {
    onCountry(code);
    const nuevas = ciudadesDe(code);
    // Al cambiar de país, una ciudad del anterior deja de tener sentido.
    if (city && !nuevas.includes(city)) {
      onCity('');
      setLibre(false);
    }
    const pais = getPais(code);
    if (pais && onSuggest) onSuggest(pais);
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Select label={labels.country} value={country} onChange={(e) => cambiarPais(e.target.value)}>
        <option value="">—</option>
        {PAISES.map((p) => (
          <option key={p.code} value={p.code}>
            {p.name}
          </option>
        ))}
      </Select>

      {lista.length === 0 || libre ? (
        <Input
          label={labels.city}
          hint={lista.length > 0 ? labels.cityFree : undefined}
          value={city}
          onChange={(e) => onCity(e.target.value)}
        />
      ) : (
        <Select
          label={labels.city}
          value={city}
          onChange={(e) => {
            if (e.target.value === '__otra__') {
              setLibre(true);
              onCity('');
              return;
            }
            onCity(e.target.value);
          }}
        >
          <option value="">—</option>
          {lista.map((nombre) => (
            <option key={nombre} value={nombre}>
              {nombre}
            </option>
          ))}
          <option value="__otra__">{labels.otherCity}</option>
        </Select>
      )}
    </div>
  );
}
