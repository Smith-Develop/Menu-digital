#!/usr/bin/env python3
"""
Aplica supabase/seed-demo.sql sustituyendo las contraseñas desde el entorno.

  DEMO_ADMIN_PW=... DEMO_OWNER_PW=... DEMO_KITCHEN_PW=... DEMO_COURIER_PW=... \
  SUPABASE_STUDIO_AUTH=user:pass python3 scripts/seed-demo.py
"""
import json
import os
import subprocess
import sys

STUDIO_URL = os.environ.get(
    "SUPABASE_STUDIO_URL", "https://menudb.coolify.kaizencode.me"
).rstrip("/")
AUTH = os.environ.get("SUPABASE_STUDIO_AUTH", "")

REPLACEMENTS = {
    "__ADMIN_PW__": os.environ.get("DEMO_ADMIN_PW"),
    "__OWNER_PW__": os.environ.get("DEMO_OWNER_PW"),
    "__KITCHEN_PW__": os.environ.get("DEMO_KITCHEN_PW"),
    "__COURIER_PW__": os.environ.get("DEMO_COURIER_PW"),
}

missing = [k for k, v in REPLACEMENTS.items() if not v]
if missing:
    sys.exit(f"Faltan contraseñas en el entorno para: {', '.join(missing)}")

sql = open("supabase/seed-demo.sql", encoding="utf-8").read()
for placeholder, value in REPLACEMENTS.items():
    if "'" in value:
        sys.exit("Las contraseñas no pueden contener comillas simples.")
    sql = sql.replace(placeholder, value)

cmd = ["curl", "-s", "-X", "POST", f"{STUDIO_URL}/api/platform/pg-meta/default/query",
       "-H", "Content-Type: application/json", "-H", "x-connection-encrypted: 1",
       "--data-binary", "@-", "--max-time", "120"]
if AUTH:
    cmd[2:2] = ["-u", AUTH]

out = subprocess.run(cmd, input=json.dumps({"query": sql}), capture_output=True, text=True).stdout
data = json.loads(out)
if isinstance(data, dict) and "message" in data:
    sys.exit(f"Error: {data['message']}")
print("Seed de demostración aplicado.")
