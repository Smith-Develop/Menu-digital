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
await campos[2].fill('secreto-de-avisos-de-prueba').catch(() => {});
await p.click('div[role="dialog"] button:has-text("Guardar las llaves")', { force: true });
await p.waitForTimeout(3000);
t = await p.$eval('body', (e) => e.innerText);
check('guarda las llaves', /Llaves guardadas/i.test(t) || !/Faltan las llaves/i.test(t), t.slice(0, 300));

await p.click('div[role="dialog"] button:has-text("Probar la conexión")', { force: true });
await p.waitForTimeout(9000);
t = await p.$eval('div[role="dialog"]', (e) => e.innerText);
check('la prueba de conexión llega a Mercado Pago',
  /mercadopago\.com/.test(t), t.slice(-300));

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
}

console.log('    errores de consola: ' + (errores.length ? JSON.stringify(errores.slice(0, 2)) : 'ninguno'));
console.log(`__RESULTADO__ ${ok} ${mal}`);
await b.close();
