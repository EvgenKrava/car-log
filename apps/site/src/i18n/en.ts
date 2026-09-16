import type { Strings } from './types';

export const en: Strings = {
  siteName: 'CarLog',
  metaTitle: 'CarLog — your car\'s digital service book',
  metaDescription: 'Keep the full maintenance history of every car you own in one searchable timeline: services, receipts, photos, reminders. Free, works on your phone.',
  nav: { features: 'Features', how: 'How it works', faq: 'FAQ', openApp: 'Open app' },
  hero: {
    h1: 'Every car\'s full service history, in your pocket.',
    sub: 'CarLog replaces the glovebox notebook, the folder of receipts and the scattered photos with one searchable timeline per car — and reminds you before the next service is due.',
    ctaPrimary: 'Create free account',
    ctaSecondary: 'Open CarLog',
    shotAlt: 'CarLog timeline for a car on a phone',
  },
  features: {
    h2: 'Everything about the car, in one place',
    items: [
      { title: 'Service timeline', body: 'Every oil change, tyre swap and repair in date order, with mileage and cost. Search it in a second.' },
      { title: 'Receipts & photos', body: 'Attach invoices, photos and PDFs to any event. They stay private and are one tap away.' },
      { title: 'Reminders', body: 'By date or by mileage. Complete one and the next interval rolls forward automatically.' },
      { title: 'AI invoice scan', body: 'Snap a workshop invoice and CarLog pre-fills the event — parts, works, cost, date.' },
      { title: 'Bulk import', body: 'Paste years of history as text and get it back as structured events to review and confirm.' },
      { title: 'Chat & voice', body: 'Ask about your car in plain language, or dictate a note. It can add events and reminders for you.' },
    ],
    strip: ['Installable on your phone', 'English & Ukrainian', 'Light & dark', 'Free'],
  },
  how: {
    h2: 'How it works',
    steps: [
      { title: 'Add your car', body: 'Make, model, year, mileage. Takes a minute.' },
      { title: 'Log a service — or snap the invoice', body: 'Type it in, dictate it, or let the scanner read the paperwork.' },
      { title: 'Get reminded', body: 'CarLog tells you before the next service is due, by date or mileage.' },
    ],
  },
  faq: {
    h2: 'Questions',
    items: [
      { q: 'Is it free?', a: 'Yes. CarLog is free to use. AI features have fair daily limits per account.' },
      { q: 'Where is my data stored?', a: 'In AWS (N. Virginia). Files are private and only served through short-lived signed links. No trackers, no ads, nothing is sold.' },
      { q: 'Can I export or delete everything?', a: 'Yes. Export a car\'s full history as a file at any time, and delete your account — with all its data — from your profile in one step.' },
      { q: 'Does it work on my phone?', a: 'Yes. It\'s a web app you can install to your home screen on iPhone and Android; it also works in any desktop browser.' },
      { q: 'Is my data used to train AI?', a: 'No. Scans, imports, chat and dictation are processed inside AWS and are not used to train any model. Voice clips are discarded right after transcription.' },
    ],
  },
  footer: { privacy: 'Privacy', terms: 'Terms', contact: 'Contact', madeIn: 'Made in Ukraine', language: 'Language' },
  legal: { back: '← CarLog', updated: 'Last updated' },
  notFound: { title: 'Page not found', body: 'There is nothing at this address. It may have moved, or the link may be mistyped.', home: 'Go to the home page', app: 'Open CarLog' },
};
