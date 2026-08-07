import { createContext, useContext, useEffect, useState } from 'react';

/**
 * Lightweight i18n for the merchant app — no dependency.
 *
 * `t(key)` falls back to English when a key is missing (so partial
 * translations never break the UI), and nested keys are supported via
 * dot notation (e.g. t('nav.products')).
 */
const en = {
  nav: {
    menu: 'Menu',
    products: 'Products',
    promotions: 'Promotions',
    orders: 'Orders',
    newOrder: 'New order',
    logOut: 'Log out',
    switchWorkspace: 'Switch workspace',
    selectWorkspace: 'Select workspace',
    noWorkspace: 'No workspace',
  },
  roles: {
    platform_admin: 'Platform',
    owner: 'Owner',
    manager: 'Manager',
    cashier: 'Cashier',
    kitchen: 'Kitchen',
    delivery: 'Delivery',
    staff: 'Staff',
  },
  auth: {
    welcomeBack: 'Welcome back',
    welcomeSub: 'Sign in to your workspace to continue.',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    createAccount: 'Create account',
    forgotPassword: 'Forgot password?',
    twoFactor: 'Two-factor verification',
    twoFactorHint: 'Enter the 6-digit code from your authenticator app for',
    verify: 'Verify',
    pleaseWait: 'Please wait…',
  },
  common: {
    cancel: 'Cancel',
    save: 'Save',
    edit: 'Edit',
    delete: 'Delete',
    search: 'Search',
    loading: 'Loading…',
  },
  pages: {
    products: 'Products',
    productsDesc: 'Every dish your restaurant sells.',
    importCsv: 'Import CSV',
    promotions: 'Promotions',
    promotionsDesc: 'Discounts and offers applied at checkout.',
    orders: 'Orders',
    ordersDesc: 'Every order placed across your restaurant.',
    noOrders: 'No orders yet',
    noOrdersDesc: 'Orders placed by customers will appear here.',
    createFirstOrder: 'Create the first order',
  },
  orders: {
    placed: 'Placed',
    preparing: 'Preparing',
    ready: 'Ready',
    delivered: 'Delivered',
    canceled: 'Canceled',
    updated: 'Order updated',
    couldNotLoad: 'Failed to load orders',
    couldNotUpdate: 'Could not update order status',
    cancelConfirm: (id) => `Cancel order #${id}?`,
  },
};

const bn = {
  nav: {
    menu: 'মেনু',
    products: 'প্রোডাক্ট',
    promotions: 'প্রোমোশন',
    orders: 'অর্ডার',
    newOrder: 'নতুন অর্ডার',
    logOut: 'লগ আউট',
    switchWorkspace: 'ওয়ার্কস্পেস বদলান',
    selectWorkspace: 'ওয়ার্কস্পেস নির্বাচন',
    noWorkspace: 'কোনো ওয়ার্কস্পেস নেই',
  },
  roles: {
    platform_admin: 'প্ল্যাটফর্ম',
    owner: 'মালিক',
    manager: 'ম্যানেজার',
    cashier: 'ক্যাশিয়ার',
    kitchen: 'কিচেন',
    delivery: 'ডেলিভারি',
    staff: 'স্টাফ',
  },
  auth: {
    welcomeBack: 'আবার স্বাগতম',
    welcomeSub: 'চালিয়ে যেতে আপনার ওয়ার্কস্পেসে সাইন ইন করুন।',
    email: 'ইমেইল',
    password: 'পাসওয়ার্ড',
    signIn: 'সাইন ইন',
    createAccount: 'অ্যাকাউন্ট তৈরি করুন',
    forgotPassword: 'পাসওয়ার্ড ভুলে গেছেন?',
    twoFactor: 'টু-ফ্যাক্টর যাচাই',
    twoFactorHint: 'আপনার অথেনটিকেটর অ্যাপের ৬ সংখ্যার কোডটি লিখুন',
    verify: 'যাচাই করুন',
    pleaseWait: 'অনুগ্রহ করে অপেক্ষা করুন…',
  },
  common: {
    cancel: 'বাতিল',
    save: 'সংরক্ষণ',
    edit: 'সম্পাদনা',
    delete: 'মুছুন',
    search: 'খুঁজুন',
    loading: 'লোড হচ্ছে…',
  },
  pages: {
    products: 'প্রোডাক্ট',
    productsDesc: 'আপনার রেস্টুরেন্টের প্রতিটি খাবার।',
    importCsv: 'CSV ইমপোর্ট',
    promotions: 'প্রোমোশন',
    promotionsDesc: 'চেকআউটে প্রযোজ্য ডিসকাউন্ট ও অফার।',
    orders: 'অর্ডার',
    ordersDesc: 'আপনার রেস্টুরেন্ট জুড়ে নেওয়া প্রতিটি অর্ডার।',
    noOrders: 'এখনো কোনো অর্ডার নেই',
    noOrdersDesc: 'গ্রাহকের করা অর্ডার এখানে দেখা যাবে।',
    createFirstOrder: 'প্রথম অর্ডার তৈরি করুন',
  },
  orders: {
    placed: 'প্লেসড',
    preparing: 'প্রস্তুত হচ্ছে',
    ready: 'রেডি',
    delivered: 'ডেলিভারড',
    canceled: 'বাতিল',
    updated: 'অর্ডার আপডেট হয়েছে',
    couldNotLoad: 'অর্ডার লোড করা যায়নি',
    couldNotUpdate: 'অর্ডারের অবস্থা আপডেট করা যায়নি',
    cancelConfirm: (id) => `অর্ডার #${id} বাতিল করবেন?`,
  },
};

export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'bn', label: 'বাংলা', short: 'বাং' },
];

const STORAGE_KEY = 'oms.lang';
const dictionaries = { en, bn };

const I18nContext = createContext(null);

function resolve(dict, key) {
  return key.split('.').reduce((acc, part) => acc?.[part], dict);
}

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'en';
    } catch {
      return 'en';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage unavailable — keep in-memory language */
    }
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  const t = (key, ...args) => {
    const dict = dictionaries[lang] || en;
    const fallback = resolve(en, key);
    const value = resolve(dict, key);
    const resolved = value ?? fallback;
    if (typeof resolved === 'function') return resolved(...args);
    return resolved ?? key;
  };

  const value = {
    lang,
    setLang,
    toggleLang: () => setLang((l) => (l === 'en' ? 'bn' : 'en')),
    t,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}
