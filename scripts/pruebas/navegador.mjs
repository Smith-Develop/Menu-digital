/**
 * Que la aplicación abra.
 *
 * Las pruebas de la base comprueban las reglas; ésta comprueba lo que aquéllas
 * no ven: que las pantallas cargan, que traen sus datos y que la consola no se
 * queja. Es la red que hacía falta antes de cerrar los permisos, porque revocar
 * un privilegio rompe cosas en sitios que no salen en ninguna consulta.
 *
 * Las cuentas salen del entorno, no del código: son las de la instalación
 * contra la que se prueba y no tienen por qué ser las mismas en otra.
 *
 *   PRUEBAS_OWNER_EMAIL / PRUEBAS_OWNER_PASSWORD
 *   PRUEBAS_ADMIN_EMAIL / PRUEBAS_ADMIN_PASSWORD
 *   PRUEBAS_URL          por defecto http://localhost:3000
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const BASE = process.env.PRUEBAS_URL ?? 'http://localhost:3000';

function credencial(nombre) {
  const valor = process.env[nombre];
  if (!valor) {
    console.log(`Falta ${nombre}. Esta prueba necesita cuentas de la instalación contra la que se ejecuta.`);
    process.exit(0);   // no se falla por no estar configurada: se dice y se sale
  }
  return valor;
}

const CUENTAS = {
  owner: [credencial('PRUEBAS_OWNER_EMAIL'), credencial('PRUEBAS_OWNER_PASSWORD')],
  admin: [credencial('PRUEBAS_ADMIN_EMAIL'), credencial('PRUEBAS_ADMIN_PASSWORD')],
};

const b = await chromium.launch();
let ok=0, mal=0;
const check=(n,c,d='')=>{ if(c){ok++;console.log('  ok    '+n);} else {mal++;console.log('  FALLO '+n+' :: '+String(d).slice(0,180));} };

const ventana = async () => (await b.newContext({viewport:{width:1440,height:1000},locale:'es-ES'})).newPage();
const entrar = async (p, mail, clave) => {
  await p.goto(`${BASE}/login`,{waitUntil:'networkidle'}); await p.waitForTimeout(3000);
  await p.fill('input[type="email"]',mail); await p.fill('input[type="password"]',clave);
  await p.waitForTimeout(400);
  await Promise.all([p.waitForURL(u=>!String(u).includes('/login'),{timeout:40000}).catch(()=>{}),
                     p.evaluate(()=>document.querySelector('form')?.requestSubmit())]);
  await p.waitForTimeout(2500);
  return !p.url().includes('/login');
};

// --- 1 · El escaparate, sin sesión ---------------------------------------
// Se piden todas las rutas una vez antes de medir: en desarrollo, la primera
// visita a cada una devuelve la pantalla de carga mientras Next la compila, y
// eso se confunde con una página rota.
for (const ruta of ['/', '/r/la-trattoria', '/search?q=pizza', '/login',
                    '/dashboard', '/dashboard/orders', '/dashboard/menu', '/dashboard/cash',
                    '/dashboard/pos', '/dashboard/tables', '/dashboard/staff',
                    '/dashboard/coupons', '/dashboard/promote', '/dashboard/settings',
                    '/kitchen', '/admin', '/admin/restaurants', '/admin/plans',
                    '/admin/revenue', '/admin/categories']) {
  await fetch(BASE + ruta).catch(() => {});
}

const anon = await ventana();
const errAnon = []; anon.on('pageerror', e=>errAnon.push(String(e).slice(0,150)));
// La portada redirige a la bienvenida en la primera visita y vuelve; hay que
// esperar a que se asiente antes de mirar, o se lee la pantalla intermedia.
await anon.goto(`${BASE}/?city=madrid`,{waitUntil:'networkidle'});
await anon.waitForTimeout(5000);
if (!anon.url().endsWith('/') && !anon.url().includes('city=')) {
  await anon.goto(`${BASE}/?city=madrid`,{waitUntil:'networkidle'});
  await anon.waitForTimeout(2500);
}
let t = await anon.$eval('body', b=>b.innerText);
check('la portada lista restaurantes sin sesión', /La Trattoria/.test(t), `${anon.url()} · ${t.slice(0,120)}`);
check('y sus categorías', /Pizzas/i.test(t), t.slice(0,200));
await anon.goto(`${BASE}/r/la-trattoria`,{waitUntil:'networkidle'});
await anon.waitForTimeout(2500);
t = await anon.$eval('body', b=>b.innerText);
check('la carta de un local se ve sin sesión', /Pizza Margherita/.test(t), t.slice(0,200));
await anon.goto(`${BASE}/search?q=pizza`,{waitUntil:'networkidle'});
await anon.waitForTimeout(2500);
check('el buscador responde', !/error/i.test(await anon.$eval('body',b=>b.innerText)), '');

// --- 2 · El panel del restaurante ---------------------------------------
const p = await ventana();
const errPanel = []; p.on('pageerror', e=>errPanel.push(String(e).slice(0,150)));
check('entra el dueño', await entrar(p, ...CUENTAS.owner), p.url());
for (const [ruta, señal] of [['/dashboard', /Resumen|Hoy|Pedidos/i],
                             ['/dashboard/orders', /Sala y pedidos|Pedidos/i],
                             ['/dashboard/menu', /Carta/i],
                             ['/dashboard/cash', /Caja/i],
                             ['/dashboard/pos', /Nuevo pedido/i],
                             ['/dashboard/tables', /Mesas/i],
                             ['/dashboard/staff', /Equipo/i],
                             ['/dashboard/coupons', /Cupones/i],
                             ['/dashboard/promote', /Destacar/i],
                             ['/dashboard/settings', /Ajustes/i],
                             ['/kitchen', /cocina|En cola/i]]) {
  await p.goto(BASE+ruta,{waitUntil:'networkidle'});
  await p.waitForTimeout(2200);
  const texto = await p.$eval('body', b=>b.innerText);
  check(`abre ${ruta}`, señal.test(texto) && !/Application error|Unhandled/i.test(texto), texto.slice(0,160));
}

// --- 3 · El superadmin ---------------------------------------------------
const sa = await ventana();
const errAdmin = []; sa.on('pageerror', e=>errAdmin.push(String(e).slice(0,150)));
check('entra el superadmin', await entrar(sa, ...CUENTAS.admin), sa.url());
for (const [ruta, señal] of [['/admin', /Superadmin|Restaurantes/i],
                             ['/admin/restaurants', /Restaurantes/i],
                             ['/admin/plans', /Planes/i],
                             ['/admin/revenue', /Ingresos/i],
                             ['/admin/categories', /Categor/i]]) {
  await sa.goto(BASE+ruta,{waitUntil:'networkidle'});
  await sa.waitForTimeout(2200);
  const texto = await sa.$eval('body', b=>b.innerText);
  check(`abre ${ruta}`, señal.test(texto) && !/Application error/i.test(texto), texto.slice(0,160));
}

console.log('\nerrores de consola:', JSON.stringify({anon:errAnon.length, panel:errPanel.length, admin:errAdmin.length}));
if (errPanel.length) console.log('  panel:', errPanel.slice(0,3));
console.log(`\n${ok} bien, ${mal} mal`);
await b.close();
