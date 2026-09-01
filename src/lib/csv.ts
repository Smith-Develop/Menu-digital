import { parseAmount } from '@/lib/money';

/**
 * Lector de ficheros separados por comas —o por puntos y comas.
 *
 * Se escribe a mano en lugar de traer una biblioteca porque el problema real no
 * es el formato sino el idioma: en España la coma es el separador decimal, así
 * que Excel exporta con punto y coma y un lector que dé por hecha la coma parte
 * "2,40" en dos columnas. El separador se deduce de la cabecera, que es la
 * única línea que se puede leer sin ambigüedad.
 */
export function parseDelimited(text: string): string[][] {
  // El BOM que Excel pone al principio se cuela dentro del primer título de
  // columna y hace que "nombre" deje de llamarse "nombre".
  const limpio = text.replace(/^\uFEFF/, '');
  const primera = limpio.split(/\r?\n/, 1)[0] ?? '';
  const sep = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ';' : ',';

  const filas: string[][] = [];
  let campo = '';
  let fila: string[] = [];
  let entrecomillado = false;

  for (let i = 0; i < limpio.length; i += 1) {
    const c = limpio[i];

    if (entrecomillado) {
      if (c === '"') {
        // Dos comillas seguidas dentro de un campo son una comilla literal.
        if (limpio[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else {
          entrecomillado = false;
        }
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') entrecomillado = true;
    else if (c === sep) {
      fila.push(campo);
      campo = '';
    } else if (c === '\n') {
      fila.push(campo.replace(/\r$/, ''));
      filas.push(fila);
      fila = [];
      campo = '';
    } else campo += c;
  }

  if (campo !== '' || fila.length > 0) {
    fila.push(campo.replace(/\r$/, ''));
    filas.push(fila);
  }

  return filas.filter((f) => f.some((v) => v.trim() !== ''));
}

/**
 * Cómo puede llamarse cada columna.
 *
 * Se aceptan los dos idiomas y las formas sin tilde porque el fichero no lo
 * escribe la aplicación: lo exporta el programa anterior o lo escribe alguien
 * en una hoja de cálculo, y rechazarlo por una tilde sería absurdo.
 */
const COLUMNAS: Record<string, string[]> = {
  name: ['nombre', 'name', 'producto', 'descripcion corta', 'articulo', 'artículo'],
  price: ['precio', 'price', 'pvp', 'precio venta'],
  barcode: ['codigo', 'código', 'codigo de barras', 'código de barras', 'barcode', 'ean', 'ean13'],
  brand: ['marca', 'brand'],
  pack_size: ['formato', 'envase', 'pack', 'pack size', 'pack_size'],
  unit: ['unidad', 'unit', 'medida'],
  net_content: ['contenido', 'net content', 'net_content', 'cantidad'],
  category: ['categoria', 'categoría', 'pasillo', 'familia', 'category', 'seccion', 'sección'],
  tax_rate: ['iva', 'impuesto', 'tax', 'tax rate', 'tax_rate'],
  stock_qty: ['stock', 'existencias', 'unidades'],
  description: ['descripcion', 'descripción', 'description'],
  image_url: ['imagen', 'foto', 'image', 'image url', 'image_url'],
  is_available: ['disponible', 'activo', 'available', 'active'],
};

function normaliza(cabecera: string): string {
  return cabecera
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export type ProductRow = {
  name: string;
  price_cents: number | null;
  barcode?: string | null;
  brand?: string | null;
  pack_size?: string | null;
  unit?: string;
  net_content?: string | null;
  category?: string | null;
  tax_rate?: string | null;
  stock_qty?: string | null;
  track_stock?: boolean;
  description?: string | null;
  image_url?: string | null;
  is_available?: boolean;
};

const UNIDADES: Record<string, string> = {
  ud: 'unit', u: 'unit', unidad: 'unit', unidades: 'unit', unit: 'unit',
  kg: 'kg', kilo: 'kg', kilos: 'kg',
  g: 'g', gr: 'g', gramo: 'g', gramos: 'g',
  l: 'l', litro: 'l', litros: 'l',
  ml: 'ml',
};

/** Un "sí" escrito de cualquiera de las maneras en que la gente escribe que sí. */
function esSi(valor: string | undefined): boolean | undefined {
  if (valor === undefined) return undefined;
  const v = normaliza(valor);
  if (v === '') return undefined;
  return ['1', 'si', 'sí', 'x', 'true', 'yes', 'v', 'verdadero'].includes(v);
}

/**
 * Convierte el fichero leído en filas de producto.
 *
 * Devuelve también qué columnas reconoció, porque el error más común no es una
 * fila mal escrita sino una cabecera que no se llama como esperábamos, y eso
 * hay que poder enseñarlo antes de importar nada.
 */
export function rowsFromDelimited(
  text: string,
  decimals = 2,
): { rows: ProductRow[]; recognised: string[]; headers: string[] } {
  const tabla = parseDelimited(text);
  if (tabla.length === 0) return { rows: [], recognised: [], headers: [] };

  const cabeceras = tabla[0].map(normaliza);
  const indice: Record<string, number> = {};

  for (const [campo, alias] of Object.entries(COLUMNAS)) {
    const i = cabeceras.findIndex((h) => alias.includes(h));
    if (i >= 0) indice[campo] = i;
  }

  const dame = (fila: string[], campo: string): string | undefined => {
    const i = indice[campo];
    if (i === undefined) return undefined;
    return fila[i]?.trim();
  };

  const rows: ProductRow[] = tabla.slice(1).map((fila) => {
    const precio = dame(fila, 'price');
    const unidad = dame(fila, 'unit');
    const stock = dame(fila, 'stock_qty');
    const iva = dame(fila, 'tax_rate');

    return {
      name: dame(fila, 'name') ?? '',
      // Sin precio no hay producto, pero la fila viaja igual: el informe tiene
      // que poder decir en qué línea falta.
      price_cents: precio ? parseAmount(precio, decimals) : null,
      barcode: dame(fila, 'barcode') || null,
      brand: dame(fila, 'brand') || null,
      pack_size: dame(fila, 'pack_size') || null,
      unit: unidad ? (UNIDADES[normaliza(unidad)] ?? 'unit') : 'unit',
      net_content: dame(fila, 'net_content')?.replace(',', '.') || null,
      category: dame(fila, 'category') || null,
      // El IVA se escribe como porcentaje —"10"— y se guarda como fracción.
      tax_rate: iva ? String(Number(iva.replace(',', '.')) / 100) : null,
      stock_qty: stock || null,
      track_stock: stock ? Number(stock.replace(',', '.')) >= 0 : undefined,
      description: dame(fila, 'description') || null,
      image_url: dame(fila, 'image_url') || null,
      is_available: esSi(dame(fila, 'is_available')),
    };
  });

  return { rows, recognised: Object.keys(indice), headers: tabla[0].map((h) => h.trim()) };
}
