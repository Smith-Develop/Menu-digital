#!/usr/bin/env bash
#
# Comprueba si el correo de registro de Supabase está listo.
#
#   ./scripts/check-auth-mail.sh
#
# Lee la URL y la clave anónima de .env.local si existen.
set -uo pipefail

if [ -f .env.local ]; then
  # shellcheck disable=SC1091
  SUPABASE_URL=$(grep -m1 '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2-)
  ANON=$(grep -m1 '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env.local | cut -d= -f2-)
fi
SUPABASE_URL="${SUPABASE_URL:-${1:-}}"
ANON="${ANON:-${2:-}}"

if [ -z "$SUPABASE_URL" ] || [ -z "$ANON" ]; then
  echo "Uso: $0 <supabase-url> <anon-key>   (o define .env.local)"
  exit 2
fi

echo "Supabase: $SUPABASE_URL"
SETTINGS=$(curl -s "$SUPABASE_URL/auth/v1/settings" -H "apikey: $ANON" --max-time 20)

AUTOCONFIRM=$(printf '%s' "$SETTINGS" | python3 -c "import json,sys;print(json.load(sys.stdin).get('mailer_autoconfirm'))" 2>/dev/null)

echo
if [ "$AUTOCONFIRM" = "True" ]; then
  echo "  mailer_autoconfirm = true"
  echo "  Las altas entran directas, sin correo de confirmación."
  echo "  Cómodo, pero no comprueba que el correo exista."
else
  echo "  mailer_autoconfirm = false"
  echo "  Se exige confirmar el correo, así que GoTrue NECESITA su SMTP."
  echo
  echo "  Prueba real: intentamos registrar una dirección de usar y tirar."
  PROBE="prueba-$(date +%s)@example.invalid"
  RESP=$(curl -s -X POST "$SUPABASE_URL/auth/v1/signup" \
    -H "apikey: $ANON" -H "Content-Type: application/json" \
    -d "{\"email\":\"$PROBE\",\"password\":\"UnaClaveDePrueba123\"}" --max-time 25)

  if printf '%s' "$RESP" | grep -qi 'error sending confirmation\|smtp\|500'; then
    echo "  ✗ GoTrue no puede enviar correo todavía. Falta configurar su SMTP."
    printf '     respuesta: %s\n' "$(printf '%s' "$RESP" | head -c 160)"
  elif printf '%s' "$RESP" | grep -q '"id"'; then
    echo "  ✓ GoTrue aceptó el registro y envió (o intentó enviar) el correo."
    echo "    Revisa la bandeja del remitente para confirmarlo."
  else
    printf '  respuesta inesperada: %s\n' "$(printf '%s' "$RESP" | head -c 160)"
  fi
fi
