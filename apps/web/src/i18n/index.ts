import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import enCommon from './locales/en/common.json';
import ukCommon from './locales/uk/common.json';
import enGarage from './locales/en/garage.json';
import ukGarage from './locales/uk/garage.json';
import enVehicle from './locales/en/vehicle.json';
import ukVehicle from './locales/uk/vehicle.json';
import enCar from './locales/en/car.json';
import ukCar from './locales/uk/car.json';
import enPhotos from './locales/en/photos.json';
import ukPhotos from './locales/uk/photos.json';
import enAuth from './locales/en/auth.json';
import ukAuth from './locales/uk/auth.json';
import enEvent from './locales/en/event.json';
import ukEvent from './locales/uk/event.json';

export const LANG_STORAGE_KEY = 'carlog.lang';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'uk'],
    ns: ['common', 'garage', 'vehicle', 'car', 'photos', 'auth', 'event'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANG_STORAGE_KEY,
      caches: ['localStorage'],
    },
    resources: {
      en: { common: enCommon, garage: enGarage, vehicle: enVehicle, car: enCar, photos: enPhotos, auth: enAuth, event: enEvent },
      uk: { common: ukCommon, garage: ukGarage, vehicle: ukVehicle, car: ukCar, photos: ukPhotos, auth: ukAuth, event: ukEvent },
    },
  });

export default i18n;
