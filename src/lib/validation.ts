import { z } from 'zod';

/**
 * Marca de tiempo ISO, venga como venga.
 *
 * `z.string().datetime()` a secas solo acepta el sufijo `Z`, pero Postgres
 * devuelve el desplazamiento explícito (`+00:00`). Al editar un registro la
 * fecha llega tal cual de la base, así que la validación estricta rechazaba
 * cualquier edición aunque la creación funcionara: el formulario decía
 * "algo ha salido mal" sin más pistas.
 *
 * Se acepta cualquier fecha que el runtime sepa interpretar y se normaliza a
 * ISO con `Z`, para que en la base entre siempre con la misma forma.
 */
export const isoDateTime = () =>
  z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: 'Fecha no válida',
    })
    .transform((value) => new Date(value).toISOString());
