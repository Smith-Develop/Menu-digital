import { cache } from 'react';
import { createPublicSupabase } from '@/lib/supabase/server';

export type OnboardingSlide = {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
};

export type AuthScreens = {
  splashEnabled: boolean;
  splashTitle: string | null;
  splashSubtitle: string | null;
  splashImageUrl: string | null;
  onboardingEnabled: boolean;
  loginTitle: string;
  loginSubtitle: string;
  loginImageUrl: string | null;
  registerTitle: string;
  registerSubtitle: string;
  registerImageUrl: string | null;
  socialGoogle: boolean;
  socialFacebook: boolean;
  termsUrl: string | null;
  privacyUrl: string | null;
};

export const DEFAULT_AUTH_SCREENS: AuthScreens = {
  splashEnabled: true,
  splashTitle: null,
  splashSubtitle: null,
  splashImageUrl: null,
  onboardingEnabled: true,
  loginTitle: 'Bienvenido de nuevo',
  loginSubtitle: 'Inicia sesión para acceder a tu cuenta',
  loginImageUrl: null,
  registerTitle: 'Empecemos',
  registerSubtitle: 'Crea tu cuenta gratis',
  registerImageUrl: null,
  socialGoogle: false,
  socialFacebook: false,
  termsUrl: null,
  privacyUrl: null,
};

/** Textos e ilustraciones de las pantallas de acceso, editables desde el panel. */
export const getAuthScreens = cache(async (): Promise<AuthScreens> => {
  try {
    const supabase = createPublicSupabase();
    const { data } = await supabase.from('app_settings').select('*').eq('id', true).maybeSingle();
    if (!data) return DEFAULT_AUTH_SCREENS;

    return {
      splashEnabled: data.splash_enabled,
      splashTitle: data.splash_title,
      splashSubtitle: data.splash_subtitle,
      splashImageUrl: data.splash_image_url,
      onboardingEnabled: data.onboarding_enabled,
      loginTitle: data.login_title ?? DEFAULT_AUTH_SCREENS.loginTitle,
      loginSubtitle: data.login_subtitle ?? DEFAULT_AUTH_SCREENS.loginSubtitle,
      loginImageUrl: data.login_image_url,
      registerTitle: data.register_title ?? DEFAULT_AUTH_SCREENS.registerTitle,
      registerSubtitle: data.register_subtitle ?? DEFAULT_AUTH_SCREENS.registerSubtitle,
      registerImageUrl: data.register_image_url,
      socialGoogle: data.social_google,
      socialFacebook: data.social_facebook,
      termsUrl: data.terms_url,
      privacyUrl: data.privacy_url,
    };
  } catch {
    return DEFAULT_AUTH_SCREENS;
  }
});

export const getOnboardingSlides = cache(async (): Promise<OnboardingSlide[]> => {
  try {
    const supabase = createPublicSupabase();
    const { data } = await supabase
      .from('onboarding_slides')
      .select('*')
      .eq('is_active', true)
      .order('position');

    return (data ?? []).map((slide) => ({
      id: slide.id,
      title: slide.title,
      subtitle: slide.subtitle,
      imageUrl: slide.image_url,
    }));
  } catch {
    return [];
  }
});
