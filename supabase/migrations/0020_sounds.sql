-- =============================================================
--  Yumi · sonidos de aviso de la cocina
--
--  El superadministrador fija los de la plataforma y cada restaurante puede
--  cambiarlos por los suyos. Se guardan como jsonb porque son ajustes de
--  presentación que crecerán con el tiempo.
-- =============================================================

alter table public.app_settings add column if not exists sound_settings jsonb not null
  default '{"newOrder":"bell","orderReady":"chime","volume":0.7,"enabled":true}'::jsonb;

alter table public.restaurants add column if not exists sound_settings jsonb;

comment on column public.restaurants.sound_settings is
  'null = usa los sonidos de la plataforma; un objeto los sobrescribe.';
