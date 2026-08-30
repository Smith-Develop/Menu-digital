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

Si faltan, la invitación se crea igual y el panel enseña el enlace para pasarlo
a mano: un fallo del servidor de correo no debe impedir dar de alta a nadie.

---

## 2. Supabase / GoTrue — **pendiente, lo tienes que hacer tú**

Sin esto **nadie puede registrarse**: la instancia tiene
`mailer_autoconfirm = false`, así que GoTrue exige confirmar el correo, y sin
SMTP ese correo no sale nunca. El usuario queda creado pero no puede entrar.

Entra en Coolify → tu servicio de Supabase → Environment Variables y añade:

```bash
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=587
SMTP_USER=noreply@tu-dominio.com
SMTP_PASS=...
SMTP_ADMIN_EMAIL=noreply@tu-dominio.com
SMTP_SENDER_NAME=Yumi

SITE_URL=https://yumi.coolify.kaizencode.me
ADDITIONAL_REDIRECT_URLS=https://yumi.coolify.kaizencode.me/**
```

Según la plantilla, las mismas variables pueden llamarse con el prefijo
`GOTRUE_` (`GOTRUE_SMTP_HOST`, `GOTRUE_SMTP_PASS`, `GOTRUE_SITE_URL`…). Si ves
otras variables con ese prefijo en tu despliegue, usa el prefijo.

**Usa el puerto 587, no el 465.** GoTrue habla STARTTLS; con 465 (TLS directo)
algunas versiones se quedan colgadas sin dar un error claro.

`SITE_URL` importa: es la base de los enlaces de confirmación. Si apunta a
`localhost`, el correo llegará con un enlace que no funciona.

Reinicia el servicio y comprueba:

```bash
curl -s https://TU-SUPABASE/auth/v1/settings -H "apikey: TU_ANON_KEY" \
  | grep -o '"mailer_autoconfirm":[a-z]*'
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
