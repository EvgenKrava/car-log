export type Locale = 'en' | 'uk';

export type Feature = { title: string; body: string };
export type Step = { title: string; body: string };
export type Faq = { q: string; a: string };

export type Strings = {
  siteName: string;
  metaTitle: string;
  metaDescription: string;
  nav: { features: string; how: string; faq: string; openApp: string };
  hero: { h1: string; sub: string; ctaPrimary: string; ctaSecondary: string; shotAlt: string };
  features: { h2: string; items: [Feature, Feature, Feature, Feature, Feature, Feature]; strip: [string, string, string, string] };
  how: { h2: string; steps: [Step, Step, Step] };
  faq: { h2: string; items: [Faq, Faq, Faq, Faq, Faq] };
  footer: { privacy: string; terms: string; contact: string; madeIn: string; language: string };
  legal: { back: string; updated: string };
};
