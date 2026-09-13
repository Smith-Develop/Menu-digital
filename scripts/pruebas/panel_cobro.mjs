/**
 * El panel donde el comercio enciende su pasarela.
 *
 * Lo lanza la suite de Mercado Pago, que es la que tiene un local colombiano
 * montado: sin él la pasarela no aparecería, porque no opera en euros y la
 * pantalla sólo ofrece lo que de verdad puede cobrar ahí.
 *
 * Recibe por entorno el local y la cuenta con la que entrar.
 */
import { chromium } from 'playwright';

const BASE = process.env.PRUEBAS_URL ?? 'http://localhost:3000';
const CORREO = process.env.PANEL_EMAIL;
const CLAVE = process.env.PANEL_PASSWORD;
const TOKEN_MP = process.env.MP_ACCESS_TOKEN;

let ok = 0, mal = 0;
const check = (n, c, d = '') => {
  if (c) { ok += 1; console.log('    ok    ' + n); }
  else { mal += 1; console.log('    FALLO ' + n + ' :: ' + String(d).slice(0, 200)); }
};

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-ES' })).newPage();
const errores = [];
p.on('pageerror', (e) => errores.push((e.stack ?? String(e)).slice(0, 600)));

await fetch(`${BASE}/dashboard/payments`).catch(() => {});
await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
await p.fill('input[type="email"]', CORREO);
await p.fill('input[type="password"]', CLAVE);
await p.waitForTimeout(400);
await Promise.all([
  p.waitForURL((u) => !String(u).includes('/login'), { timeout: 40000 }).catch(() => {}),
  p.evaluate(() => document.querySelector('form')?.requestSubmit()),
]);
await p.waitForTimeout(2500);

await p.goto(`${BASE}/dashboard/payments`, { waitUntil: 'networkidle' });
await p.waitForTimeout(3000);
let t = await p.$eval('body', (e) => e.innerText);
check('la pantalla ofrece Mercado Pago', /Mercado Pago/.test(t), t.slice(0, 300));
check('y avisa de que le faltan las llaves', /Faltan las llaves/i.test(t), t.slice(0, 300));

// Encender sin llaves no debe dejar. Se busca la tarjeta que de verdad no las
// tiene: ir por índice apagaba la que ya estaba configurada, y entonces la
// prueba pasaba por el motivo equivocado.
const sinLlaves = p.locator('li', { hasText: 'Faltan las llaves' }).first();
await sinLlaves.locator('button[role="switch"]').click({ force: true });
await p.waitForTimeout(2500);
t = await p.$eval('body', (e) => e.innerText);
check('no deja encenderla sin llaves',
  /Guarda primero las llaves/i.test(t) || /Faltan las llaves/i.test(t), t.slice(0, 300));

// El diálogo se abre solo al intentarlo; si no, se abre a mano.
if (!(await p.$('div[role="dialog"]'))) {
  await sinLlaves.locator('button:has-text("Guardar las llaves")').click({ force: true });
  await p.waitForTimeout(1500);
}
t = await p.$eval('div[role="dialog"]', (e) => e.innerText);
check('pide el token y el secreto de avisos',
  /Access token/i.test(t) && /avisos/i.test(t), t.slice(0, 300));
check('y enseña la dirección donde pegar los avisos', /api\/pago\/aviso\//.test(t), t.slice(0, 400));

const campos = await p.$$('div[role="dialog"] input');
await campos[0].fill(TOKEN_MP);
// La clave pública va en medio y no es secreta: es la que el navegador necesita
// para cifrar la tarjeta, y sin ella el cliente acaba en la web de la pasarela.
await campos[1].fill(process.env.MP_PUBLIC_KEY ?? 'TEST-public-key').catch(() => {});
await campos[2].fill('secreto-de-avisos-de-prueba').catch(() => {});
await p.click('div[role="dialog"] button:has-text("Guardar las llaves")', { force: true });

// Se espera a que el estado cambie, no una cantidad de segundos. La pantalla
// pide ahora el entorno de cada llave y los cobros fallidos de la semana, así
// que refrescar tarda más que antes y un tiempo fijo hacía fallar la prueba por
// un motivo que no era el suyo.
const sigueSinLlaves = () =>
  p.$$eval('li', (ns) =>
    ns.some((n) => /Mercado Pago/i.test(n.innerText) && /Faltan las llaves/i.test(n.innerText)));
for (let intento = 0; intento < 20 && (await sigueSinLlaves()); intento += 1) {
  await p.waitForTimeout(1000);
}

// Se mira la ficha concreta, no la página entera: en este local hay más de una
// pasarela ofrecida y el texto de la otra contaminaba el resultado.
const fichas = await p.$$eval('li', (ns) =>
  ns.map((n) => n.innerText.replace(/\s+/g, ' ').slice(0, 120)).filter((x) => /Mercado Pago/i.test(x)));
check('guarda las llaves', !fichas.some((f) => /Faltan las llaves/i.test(f)),
  JSON.stringify(fichas));

await p.click('div[role="dialog"] button:has-text("Probar la conexión")', { force: true });
await p.waitForTimeout(9000);
t = await p.$eval('div[role="dialog"]', (e) => e.innerText);
check('la prueba de conexión llega a Mercado Pago',
  /mercadopago\.com/.test(t), t.slice(-300));

// Y dice CON QUÉ conectó. Decir sólo «conectado» es lo que dejó a un comercio
// con las llaves reales creyendo que podía cobrar con tarjetas de prueba: la
// conexión daba bien, porque las credenciales de producción son válidas.
// Conectar no demuestra en qué entorno se conectó: unas llaves reales abren la
// operación igual de bien que unas de prueba. Afirmarlo era adivinar.
check('y no se inventa si son de prueba o reales',
  /todav[ií]a no sabemos/i.test(t), t.slice(-400));

await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(3000);
const fichas2 = await p.$$eval('li', (ns) =>
  ns.map((n) => n.innerText.replace(/\s+/g, ' ')).filter((x) => /Mercado Pago/i.test(x)));
check('y la ficha dice que aún no lo sabe, en vez de adivinarlo',
  fichas2.some((f) => /todav[ií]a no sabemos/i.test(f)),
  JSON.stringify(fichas2).slice(0, 400));

// --- Y lo que ve quien paga ------------------------------------------------
// Sobre el local del arnés, que es el que acaba de quedar configurado: hacerlo
// contra un local de verdad ataría la prueba a cómo esté configurado ese día.
const SLUG = process.env.PANEL_SLUG;
if (SLUG) {
  // Ventana limpia: quien paga no es el dueño, y con su sesión el escaparate
  // le manda a su panel. Con el carrito vacío la pantalla de pago redirige,
  // así que primero se mete algo.
  const cliente = await (await b.newContext({
    viewport: { width: 430, height: 900 }, locale: 'es-ES', isMobile: true, hasTouch: true,
  })).newPage();

  // A domicilio la identificación es obligatoria, y sin ella el formulario de
  // pago queda inerte: hay que entrar antes de poder comprobar nada.
  if (process.env.CLIENTE_EMAIL) {
    await cliente.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await cliente.waitForTimeout(1500);
    await cliente.fill('input[type="email"]', process.env.CLIENTE_EMAIL);
    await cliente.fill('input[type="password"]', CLAVE);
    await Promise.all([
      cliente.waitForURL((u) => !String(u).includes('/login'), { timeout: 40000 }).catch(() => {}),
      cliente.evaluate(() => document.querySelector('form')?.requestSubmit()),
    ]);
    await cliente.waitForTimeout(2500);
  }

  await cliente.goto(`${BASE}/r/${SLUG}`, { waitUntil: 'networkidle' });
  await cliente.waitForTimeout(3000);
  for (const boton of await cliente.$$('button[aria-label]')) {
    const etiqueta = await boton.getAttribute('aria-label');
    if (etiqueta && /a.adir|carrito/i.test(etiqueta)) {
      await boton.click({ force: true });
      break;
    }
  }
  await cliente.waitForTimeout(1800);

  await cliente.goto(`${BASE}/r/${SLUG}/checkout?type=delivery`, { waitUntil: 'networkidle' });
  await cliente.waitForTimeout(3000);
  const t2 = await cliente.$eval('body', (e) => e.innerText);
  check('el cliente ve el pago agrupado por cuándo',
    /Pagar ahora/i.test(t2) && /Pagar al recibir/i.test(t2), t2.slice(0, 400));
  check('y la pasarela que el local encendió', /Mercado Pago/.test(t2), t2.slice(0, 400));
  check('sin dos opciones de tarjeta que se pisen', !/Datáfono \(TPV\)/.test(t2), t2.slice(0, 400));

  // --- Y que el pago ocurra aquí dentro ------------------------------------
  // Lo que se comprueba no es que el pago salga bien —eso necesita una tarjeta
  // de prueba y varios minutos— sino que el formulario aparezca en esta misma
  // página en vez de mandar al cliente a la de Mercado Pago, que era el
  // problema que había que resolver.
  await cliente.click('button:has-text("Mercado Pago")', { force: true }).catch(() => {});
  await cliente.waitForTimeout(9000);

  const t3 = await cliente.$eval('body', (e) => e.innerText);
  check('el formulario de tarjeta sale en la propia tienda',
    /Número de la tarjeta/i.test(t3) && /Titular/i.test(t3), t3.slice(0, 500));
  check('y avisa de que la tarjeta no pasa por Yumi',
    /no los ve ni los guarda/i.test(t3), t3.slice(0, 500));
  check('con PSE, porque el local es colombiano', /PSE/.test(t3), t3.slice(0, 500));

  // Los campos son marcos de la pasarela servidos desde su dominio: es lo que
  // hace que el número de la tarjeta no pase por nuestro servidor.
  const marcos = await cliente.$$eval('.marco-pasarela iframe', (ns) =>
    ns.map((n) => n.getAttribute('src') ?? ''));
  check('los campos son marcos de la pasarela, no nuestros',
    marcos.length >= 2 && marcos.every((u) => /mercadopago|mercadolibre/.test(u)),
    JSON.stringify(marcos).slice(0, 300));

  // Con el formulario a medias, confirmar sólo produciría un error. El texto
  // sale en mayúsculas por CSS, así que se compara sin distinguirlas.
  const botones = await cliente.$$eval('button', (ns) =>
    ns.map((n) => ({ txt: n.innerText.replace(/\s+/g, ' ').slice(0, 40), off: n.disabled }))
      .filter((b) => /confirmar|pagar/i.test(b.txt)));
  const confirmar = botones.find((b) => /confirmar|pagar/i.test(b.txt));
  check('y no deja confirmar con la tarjeta a medias',
    Boolean(confirmar?.off), JSON.stringify(botones));
  check('el botón ya no promete un viaje que no ocurre',
    Boolean(confirmar && !/ir a pagar/i.test(confirmar.txt)), JSON.stringify(botones));
  check('sin salir de la tienda', cliente.url().includes(`/r/${SLUG}/checkout`), cliente.url());
}

console.log('    errores de consola: ' + (errores.length ? JSON.stringify(errores.slice(0, 2)) : 'ninguno'));
console.log(`__RESULTADO__ ${ok} ${mal}`);
await b.close();
