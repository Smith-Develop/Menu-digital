#!/usr/bin/env python3
"""
Genera src/types/database.ts a partir del esquema real de Supabase.

Consulta el endpoint pg-meta del Studio (mismo que usa la interfaz web), así que
no hace falta la CLI de Supabase ni acceso directo al puerto 5432.

Uso:  SUPABASE_STUDIO_URL=... SUPABASE_STUDIO_AUTH=user:pass python3 scripts/gen-db-types.py
"""
import json
import os
import re
import subprocess
import sys

STUDIO_URL = os.environ.get(
    "SUPABASE_STUDIO_URL", "https://menudb.coolify.kaizencode.me"
).rstrip("/")
AUTH = os.environ.get("SUPABASE_STUDIO_AUTH", "")
ENDPOINT = f"{STUDIO_URL}/api/platform/pg-meta/default/query"


def query(sql: str):
    body = json.dumps({"query": sql})
    cmd = ["curl", "-s", "-X", "POST", ENDPOINT,
           "-H", "Content-Type: application/json",
           "-H", "x-connection-encrypted: 1",
           "--data-binary", "@-", "--max-time", "60"]
    if AUTH:
        cmd[2:2] = ["-u", AUTH]
    out = subprocess.run(cmd, input=body, capture_output=True, text=True).stdout
    data = json.loads(out)
    if isinstance(data, dict) and "message" in data:
        sys.exit(f"Error SQL: {data['message']}")
    return data


COLUMNS_SQL = """
select c.relname as tbl, a.attname as col,
       format_type(a.atttypid, a.atttypmod) as typ,
       a.attnotnull as nn,
       (a.atthasdef or a.attidentity <> '') as hasdef
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
order by c.relname, a.attnum;
"""

# jsonb_agg (no array_agg): array_agg vuelve como el literal '{a,b,c}' de Postgres.
ENUMS_SQL = """
select t.typname, jsonb_agg(e.enumlabel order by e.enumsortorder) as labels
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
group by t.typname order by 1;
"""

PG2TS = {
    "uuid": "string", "text": "string", "character varying": "string",
    "character": "string", "citext": "string",
    "integer": "number", "smallint": "number", "bigint": "number",
    "real": "number", "double precision": "number", "numeric": "number",
    "boolean": "boolean",
    "timestamp with time zone": "string", "timestamp without time zone": "string",
    "date": "string", "time without time zone": "string",
    "json": "Json", "jsonb": "Json",
}


def main() -> None:
    cols = query(COLUMNS_SQL)
    enums_raw = query(ENUMS_SQL)

    enums = {}
    for row in enums_raw:
        labels = row["labels"]
        if isinstance(labels, str):  # por si vuelve como literal de Postgres
            labels = labels.strip("{}").split(",")
        enums[row["typname"]] = labels

    def ts_type(pg: str) -> str:
        base, arr = pg, False
        if base.endswith("[]"):
            arr, base = True, base[:-2]
        base = re.sub(r"\(.*\)", "", base).strip()
        t = f'Enums<"{base}">' if base in enums else PG2TS.get(base, "string")
        return f"{t}[]" if arr else t

    by_table: dict[str, list] = {}
    for c in cols:
        by_table.setdefault(c["tbl"], []).append(c)

    out = ["""/**
 * Tipos de la base de datos. NO editar a mano.
 * Regenerar tras cada migración con:  npm run db:types
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {"""]

    for tbl in sorted(by_table):
        rows = by_table[tbl]
        out.append(f"      {tbl}: {{")
        out.append("        Row: {")
        for c in rows:
            t = ts_type(c["typ"]) + ("" if c["nn"] else " | null")
            out.append(f"          {c['col']}: {t};")
        out.append("        };")
        out.append("        Insert: {")
        for c in rows:
            t = ts_type(c["typ"]) + ("" if c["nn"] else " | null")
            opt = "?" if (not c["nn"] or c["hasdef"]) else ""
            out.append(f"          {c['col']}{opt}: {t};")
        out.append("        };")
        out.append("        Update: {")
        for c in rows:
            t = ts_type(c["typ"]) + ("" if c["nn"] else " | null")
            out.append(f"          {c['col']}?: {t};")
        out.append("        };")
        out.append("        Relationships: [];")
        out.append("      };")

    out.append("    };")
    out.append("    Views: { [_ in never]: never };")
    out.append("    Functions: {")
    out.append("""      place_order: {
        Args: {
          p_restaurant_slug: string;
          p_items: Json;
          p_type: Enums<'order_type'>;
          p_payment_method: Enums<'payment_method'>;
          p_table_code?: string | null;
          p_customer_name?: string | null;
          p_customer_phone?: string | null;
          p_customer_email?: string | null;
          p_address?: string | null;
          p_address_notes?: string | null;
          p_notes?: string | null;
          p_tip_cents?: number;
          p_coupon_code?: string | null;
          p_table_session?: string | null;
        };
        Returns: Json;
      };""")
    out.append("      get_order_by_token: { Args: { p_token: string }; Returns: Json };")
    out.append("      call_waiter: { Args: { p_table_code: string; p_type?: Enums<'call_type'>; p_note?: string | null }; Returns: Json };")
    out.append("      restaurant_stats: { Args: { p_restaurant_id: string; p_days?: number }; Returns: Json };")
    out.append("      list_cities: { Args: { [_ in never]: never }; Returns: { city: string; city_slug: string; restaurants: number }[] };")
    out.append("      nearest_city: { Args: { p_lat: number; p_lng: number }; Returns: { city: string; city_slug: string; distance_km: number }[] };")
    out.append("      home_banners: { Args: { p_city_slug?: string | null; p_limit?: number }; Returns: { id: string; title: string | null; subtitle: string | null; image_url: string; link_url: string | null; restaurant_id: string; restaurant_name: string; restaurant_slug: string }[] };")
    out.append("      active_notifications: { Args: { p_city_slug?: string | null }; Returns: { id: string; title: string; body: string | null; image_url: string | null; link_url: string | null; link_label: string | null }[] };")
    out.append("      courier_take_order: { Args: { p_order_id: string }; Returns: Json };")
    out.append("      courier_stats: { Args: { [_ in never]: never }; Returns: Json };")
    out.append("      my_courier_id: { Args: { [_ in never]: never }; Returns: string | null };")
    out.append("""      validate_coupon: {
        Args: {
          p_code: string;
          p_restaurant_slug: string;
          p_items: Json;
          p_type: Enums<'order_type'>;
          p_tip_cents?: number;
        };
        Returns: Json;
      };""")
    out.append("      table_bill: { Args: { p_table_code: string }; Returns: Json };")
    out.append("      accept_staff_invitation: { Args: { p_token: string }; Returns: Json };")
    out.append("      invitation_preview: { Args: { p_token: string }; Returns: Json };")
    out.append("      home_categories: { Args: { p_city_slug?: string | null; p_limit?: number }; Returns: { id: string; name: string; slug: string; image_url: string | null; products: number }[] };")
    out.append("""      restaurant_couriers_available: {
        Args: { p_restaurant_id: string };
        Returns: {
          courier_id: string;
          name: string;
          avatar_url: string | null;
          phone: string | null;
          vehicle: string;
          status: Enums<'courier_status'>;
          active_here: number;
          active_total: number;
          deliveries: number;
          rating: number;
        }[];
      };""")
    out.append("      assign_order_courier: { Args: { p_order_id: string; p_courier_id: string }; Returns: Json };")
    out.append("      platform_stats: { Args: { p_days?: number }; Returns: Json };")
    out.append("      restaurant_analytics: { Args: { p_restaurant_id: string; p_from: string; p_to: string }; Returns: Json };")
    out.append("      floor_status: { Args: { p_restaurant_id: string }; Returns: Json };")
    out.append("      my_coupons: { Args: { [_ in never]: never }; Returns: Json };")
    out.append("      order_rating_targets: { Args: { p_order_id: string }; Returns: Json };")
    out.append("      table_session_alive: { Args: { p_code: string; p_session: string }; Returns: boolean };")
    out.append("      courier_picked_up: { Args: { p_order_id: string }; Returns: Json };")
    out.append("      courier_deliver_order: { Args: { p_order_id: string }; Returns: Json };")
    out.append("      courier_cash_due: { Args: { p_courier_id?: string | null }; Returns: Json };")
    out.append("      settle_courier_cash: { Args: { p_courier_id: string; p_restaurant_id: string }; Returns: Json };")
    out.append("      mark_order_paid: { Args: { p_order_id: string; p_method?: Enums<'payment_method'> }; Returns: Json };")
    out.append("      cancel_order: { Args: { p_order_id: string; p_reason: string }; Returns: Json };")
    out.append("      can_charge: { Args: { rid: string }; Returns: boolean };")
    out.append("      can_cancel_orders: { Args: { rid: string }; Returns: boolean };")
    out.append("      add_order_payment: { Args: { p_order_id: string; p_method?: Enums<'payment_method'>; p_amount_cents?: number | null; p_note?: string | null }; Returns: Json };")
    out.append("      pay_table_bill: { Args: { p_table_id: string; p_method?: Enums<'payment_method'>; p_amount_cents?: number | null; p_note?: string | null }; Returns: Json };")
    out.append("      refund_order: { Args: { p_order_id: string; p_reason: string; p_amount_cents?: number | null; p_method?: Enums<'payment_method'> }; Returns: Json };")
    out.append("      void_order_item: { Args: { p_item_id: string; p_reason: string }; Returns: Json };")
    out.append("      apply_manual_discount: { Args: { p_order_id: string; p_cents: number; p_reason: string }; Returns: Json };")
    out.append("      courier_fail_delivery: { Args: { p_order_id: string; p_reason: string }; Returns: Json };")
    out.append("      restaurant_cash_due: { Args: { p_restaurant_id: string }; Returns: Json };")
    out.append("      is_superadmin: { Args: { [_ in never]: never }; Returns: boolean };")
    out.append("      is_staff_of: { Args: { rid: string }; Returns: boolean };")
    out.append("    };")
    out.append("    Enums: {")
    for name, labels in sorted(enums.items()):
        out.append(f"      {name}: " + " | ".join(f'"{l}"' for l in labels) + ";")
    out.append("    };")
    out.append("    CompositeTypes: { [_ in never]: never };")
    out.append("  };")
    out.append("};")
    out.append("")
    out.append("""export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T];
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];
""")

    with open("src/types/database.ts", "w", encoding="utf-8") as fh:
        fh.write("\n".join(out))
    print(f"src/types/database.ts · {len(by_table)} tablas · {len(enums)} enums")


if __name__ == "__main__":
    main()
