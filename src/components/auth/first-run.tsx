/**
 * Lleva a la pantalla de bienvenida la primera vez que alguien abre la
 * aplicación.
 *
 * La decisión depende de una marca guardada en el propio dispositivo, que no
 * viaja en la petición y por tanto no puede tomarse en el servidor. Se resuelve
 * con un script que corre **antes** de pintar nada: hacerlo desde un efecto de
 * React obliga a esperar a la hidratación, y durante ese segundo largo se veía
 * la portada antes de saltar, que es justo lo que se quiere evitar.
 *
 * Sólo actúa en la portada y sólo si el almacenamiento responde; si está
 * bloqueado se prefiere no molestar y seguir de largo.
 */
export function FirstRunRedirect({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;

  const script = `
    try {
      if (location.pathname === '/' && !localStorage.getItem('yumi_onboarding_seen')) {
        location.replace('/welcome');
      }
    } catch (e) {}
  `;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
