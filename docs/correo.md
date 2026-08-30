# Correo

Yumi manda correos desde **dos sitios distintos**, y cada uno se configura en su
lado. Confundirlos es la causa habitual de "he puesto el SMTP y sigue sin
funcionar el registro".

| Qué correo | Quién lo manda | Dónde se configura |
|---|---|---|
| Confirmación de registro | GoTrue (Supabase Auth) | Variables del despliegue de **Supabase** |
| Recuperación de contraseña | GoTrue (Supabase Auth) | Variables del despliegue de **Supabase** |
| Cambio de correo | GoTrue (Supabase Auth) | Variables del despliegue de **Supabase** |
| Invitación al equipo | La aplicación Next.js | `.env.local` de **Yumi** |

---

## 1. La aplicación (ya configurado)

En `.env.local`:

```bash
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465          # 465 = TLS directo · 587 = STARTTLS
SMTP_USER=noreply@tu-dominio.com
SMTP_PASSWORD=...
SMTP_FROM=noreply@tu-dominio.com
SMTP_FROM_NAME=Yumi
```

También valen los nombres de GoTrue —`SMTP_PASS`, `SMTP_ADMIN_EMAIL`,
`SMTP_SENDER_NAME`—, porque en el mismo despliegue conviven los dos servicios y
es fácil cruzarlos. Equivocarse de nombre no da ningún error: simplemente el
correo deja de salir.

Si faltan, la invitación se crea igual y el panel enseña el enlace para pasarlo
a mano: un fallo del servidor de correo no debe impedir dar de alta a nadie.

---

## 2. Supabase / GoTrue — **pendiente, lo tienes que hacer tú**

Sin esto **nadie puede registrarse**. Comprobado en la instancia: GoTrue acepta
el alta, marca `confirmation_sent_at` y no envía nada. No da error, así que
parece que funciona hasta que el usuario se queda esperando un correo que no
llega. La versión desplegada es GoTrue v2.186.

Entra en Coolify → tu servicio de Supabase → Environment Variables.

### Nombres de las variables

El `docker-compose` oficial de Supabase lee variables **sin prefijo** y se las
pasa a GoTrue como `GOTRUE_*`. Según cómo esté montado tu despliegue valdrá uno
u otro juego. Mira cuáles ya existen en tu servicio y usa esa convención; si no
hay ninguna, **pon los dos juegos**: el que no se use, se ignora.

| Sin prefijo (compose de Supabase) | Con prefijo (GoTrue directo) |
|---|---|
| `SMTP_HOST` | `GOTRUE_SMTP_HOST` |
| `SMTP_PORT` | `GOTRUE_SMTP_PORT` |
| `SMTP_USER` | `GOTRUE_SMTP_USER` |
| `SMTP_PASS` | `GOTRUE_SMTP_PASS` |
| `SMTP_ADMIN_EMAIL` | `GOTRUE_SMTP_ADMIN_EMAIL` |
| `SMTP_SENDER_NAME` | `GOTRUE_SMTP_SENDER_NAME` |
| `SITE_URL` | `GOTRUE_SITE_URL` |
| `ADDITIONAL_REDIRECT_URLS` | `GOTRUE_URI_ALLOW_LIST` |
| `ENABLE_EMAIL_AUTOCONFIRM` | `GOTRUE_MAILER_AUTOCONFIRM` |

### Dos avisos que ahorran una tarde

**Puerto 587, no 465.** GoTrue habla STARTTLS. Con 465 (TLS directo) algunas
versiones se quedan esperando sin dar un error claro. La aplicación sí usa 465
porque nodemailer lo maneja bien; no es incoherencia, es que hablan distinto.

**`SITE_URL` tiene que ser el dominio público.** Es la base de los enlaces de
confirmación: si apunta a `localhost`, el correo llega con un enlace inservible.

Reinicia el servicio después de guardar y comprueba con:

```bash
./scripts/check-auth-mail.sh
```

### Alternativa: altas sin confirmar

Si prefieres que la gente entre al momento y no quieres depender del correo:

```bash
ENABLE_EMAIL_AUTOCONFIRM=true     # o GOTRUE_MAILER_AUTOCONFIRM=true
```

Es más cómodo, pero deja de comprobar que el correo existe: cualquiera puede
registrarse con una dirección ajena. Para el panel de restaurantes, donde el
correo es el identificador del equipo, conviene mantener la confirmación.

---

## Comprobar que el SMTP responde

```bash
python3 - <<'PY'
import smtplib
s = smtplib.SMTP('smtp.hostinger.com', 587, timeout=15)
s.starttls()
s.login('noreply@tu-dominio.com', 'TU_CONTRASEÑA')
print('autenticación correcta')
s.quit()
PY
```

## Entregabilidad

El dominio remitente necesita SPF, DKIM y DMARC publicados o los correos irán a
spam. Hostinger los genera en su panel de correo; hay que copiarlos a las DNS
del dominio.
