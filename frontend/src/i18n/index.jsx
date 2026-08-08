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
    dashboard: 'Dashboard',
    menu: 'Menu',
    products: 'Products',
    promotions: 'Promotions',
    orders: 'Orders',
    newOrder: 'New order',
    logOut: 'Log out',
    switchWorkspace: 'Switch workspace',
    selectWorkspace: 'Select workspace',
    noWorkspace: 'No workspace',
    settings: 'Settings',
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
    dashboard: 'Dashboard',
    dashboardDesc: 'Your restaurant at a glance.',
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
  dash: {
    todayRevenue: 'Today\'s revenue',
    todayOrders: 'Orders today',
    openOrders: 'Open orders',
    menuItems: 'Menu items',
    topItems: 'Top items',
    noData: 'No orders yet today.',
    taka: '৳',
    revenueTrend: 'Revenue — last 7 days',
    orderVolume: 'Orders — last 7 days',
    last7Days: 'Last 7 days',
    total: 'total',
    ordersTotal: 'orders',
    statusBreakdown: 'Order status',
    statusSub: 'Fulfillment mix over the last 7 days',
    topItemsSub: 'By quantity, latest 500 line items',
  },
  settings: {
    page: 'Settings',
    pageDesc: 'Workspace details, branding and storefront theme.',
    brand: 'Storefront branding',
    brandDesc: 'Pick the colours and tagline your customers see on your public menu.',
    primaryColor: 'Primary colour',
    accentColor: 'Accent colour',
    tagline: 'Tagline',
    taglineHint: 'Shown under your restaurant name on the storefront.',
    announcement: 'Announcement',
    announcementHint: 'A short banner shown to customers (optional).',
    logoUrl: 'Logo URL',
    heroImage: 'Hero image URL',
    save: 'Save branding',
    saved: 'Branding saved',
    savedDesc: 'Your storefront now uses the new theme.',
    preview: 'Live preview',
    previewHint: 'This is how customers see your storefront.',
    viewStorefront: 'Open my storefront',
    presets: 'Quick presets',
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
  landing: {
    navFeatures: 'Features',
    navHow: 'How it works',
    navDemos: 'Live storefronts',
    heroBadge: 'Made for Bangladeshi restaurants',
    heroTitle1: 'Run your restaurant.',
    heroTitle2: 'Sell everywhere.',
    heroSub:
      'Menu management, bulk import, a themed public storefront and real-time order tracking — one workspace for your whole team.',
    ctaStart: 'Start free trial',
    ctaDemo: 'View a live storefront',
    statRestaurants: 'restaurants onboard',
    statOrders: 'orders processed',
    statUptime: 'uptime SLA',
    marqueeLabel: 'Powering Dhaka’s favourite kitchens',
    howTitle: 'From menu to doorstep in three steps',
    step1Title: 'Build your menu',
    step1Desc: 'Categories, variants, add-ons, prices, photos and stock — one clean editor.',
    step2Title: 'Import & publish',
    step2Desc: 'Bulk-import from CSV or Excel, then publish a live public menu in one tap.',
    step3Title: 'Take & fulfill orders',
    step3Desc: 'Kitchen tickets, status flow and delivery handoff — your team stays in sync.',
    featuresTitle: 'Everything a growing restaurant needs',
    featuresSub:
      'One platform that replaces spreadsheets, paper tickets and photocopied menus.',
    demoTitle: 'Your brand, on every phone',
    demoSub:
      'Every workspace gets its own themed storefront — colours, tagline and menu, live on any phone.',
    ctaTitle: 'Launch your menu in minutes',
    ctaSub: 'Free 30-day trial, no card required. Your team can be taking orders today.',
    footerTag: 'Restaurant SaaS, made in Dhaka',
  },
};

const bn = {
  nav: {
    dashboard: 'ড্যাশবোর্ড',
    menu: 'মেনু',
    products: 'প্রোডাক্ট',
    promotions: 'প্রোমোশন',
    orders: 'অর্ডার',
    newOrder: 'নতুন অর্ডার',
    logOut: 'লগ আউট',
    switchWorkspace: 'ওয়ার্কস্পেস বদলান',
    selectWorkspace: 'ওয়ার্কস্পেস নির্বাচন',
    noWorkspace: 'কোনো ওয়ার্কস্পেস নেই',
    settings: 'সেটিংস',
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
    dashboard: 'ড্যাশবোর্ড',
    dashboardDesc: 'আপনার রেস্টুরেন্ট এক নজরে।',
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
  dash: {
    todayRevenue: 'আজকের আয়',
    todayOrders: 'আজকের অর্ডার',
    openOrders: 'চলমান অর্ডার',
    menuItems: 'মেনু আইটেম',
    topItems: 'সেরা আইটেম',
    noData: 'আজ এখনো কোনো অর্ডার নেই।',
    taka: '৳',
    revenueTrend: 'আয় — শেষ ৭ দিন',
    orderVolume: 'অর্ডার — শেষ ৭ দিন',
    last7Days: 'শেষ ৭ দিন',
    total: 'মোট',
    ordersTotal: 'টি অর্ডার',
    statusBreakdown: 'অর্ডারের অবস্থা',
    statusSub: 'শেষ ৭ দিনের ফুলফিলমেন্ট পরিসংখ্যান',
    topItemsSub: 'পরিমাণ অনুযায়ী, সাম্প্রতিক ৫০০ আইটেম',
  },
  settings: {
    page: 'সেটিংস',
    pageDesc: 'ওয়ার্কস্পেসের বিবরণ, ব্র্যান্ডিং ও স্টোরফ্রন্ট থিম।',
    brand: 'স্টোরফ্রন্ট ব্র্যান্ডিং',
    brandDesc: 'আপনার পাবলিক মেনুতে গ্রাহকরা যে রং ও ট্যাগলাইন দেখবেন তা বেছে নিন।',
    primaryColor: 'প্রাইমারি রং',
    accentColor: 'অ্যাকসেন্ট রং',
    tagline: 'ট্যাগলাইন',
    taglineHint: 'স্টোরফ্রন্টে রেস্টুরেন্টের নামের নিচে দেখানো হয়।',
    announcement: 'ঘোষণা',
    announcementHint: 'গ্রাহকদের দেখানো ছোট ব্যানার (ঐচ্ছিক)।',
    logoUrl: 'লোগো URL',
    heroImage: 'হিরো ছবির URL',
    save: 'ব্র্যান্ডিং সংরক্ষণ',
    saved: 'ব্র্যান্ডিং সংরক্ষিত হয়েছে',
    savedDesc: 'আপনার স্টোরফ্রন্ট এখন নতুন থিম ব্যবহার করছে।',
    preview: 'লাইভ প্রিভিউ',
    previewHint: 'গ্রাহকরা যেভাবে আপনার স্টোরফ্রন্ট দেখবেন।',
    viewStorefront: 'আমার স্টোরফ্রন্ট খুলুন',
    presets: 'দ্রুত প্রিসেট',
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
  landing: {
    navFeatures: 'ফিচার',
    navHow: 'কীভাবে কাজ করে',
    navDemos: 'লাইভ স্টোরফ্রন্ট',
    heroBadge: 'বাংলাদেশের রেস্টুরেন্টের জন্য তৈরি',
    heroTitle1: 'আপনার রেস্টুরেন্ট চালান।',
    heroTitle2: 'সব জায়গায় বিক্রি করুন।',
    heroSub:
      'মেনু ম্যানেজমেন্ট, বাল্ক ইমপোর্ট, থিমযুক্ত পাবলিক স্টোরফ্রন্ট ও রিয়েল-টাইম অর্ডার ট্র্যাকিং — আপনার পুরো টিমের জন্য একটি ওয়ার্কস্পেস।',
    ctaStart: 'ফ্রি ট্রায়াল শুরু করুন',
    ctaDemo: 'লাইভ স্টোরফ্রন্ট দেখুন',
    statRestaurants: 'রেস্টুরেন্ট অনবোর্ড',
    statOrders: 'অর্ডার প্রসেসড',
    statUptime: 'আপটাইম SLA',
    marqueeLabel: 'ঢাকার প্রিয় রান্নাঘরগুলোকে চালাচ্ছে',
    howTitle: 'মেনু থেকে দোরগোড়ায় — তিন ধাপে',
    step1Title: 'মেনু তৈরি করুন',
    step1Desc: 'ক্যাটাগরি, ভেরিয়েন্ট, অ্যাড-অন, দাম, ছবি ও স্টক — একটি পরিষ্কার এডিটরে।',
    step2Title: 'ইমপোর্ট ও পাবলিশ',
    step2Desc: 'CSV বা Excel থেকে বাল্ক-ইমপোর্ট, তারপর এক ট্যাপে লাইভ পাবলিক মেনু।',
    step3Title: 'অর্ডার নিন ও পূরণ করুন',
    step3Desc: 'কিচেন টিকিট, স্ট্যাটাস ফ্লো ও ডেলিভারি হ্যান্ডঅফ — টিম সবসময় সিঙ্কে।',
    featuresTitle: 'বেড়ে ওঠা রেস্টুরেন্টের জন্য যা দরকার',
    featuresSub: 'স্প্রেডশিট, কাগজের টিকিট ও ফটোকপি মেনুর বদলে একটি প্ল্যাটফর্ম।',
    demoTitle: 'আপনার ব্র্যান্ড, প্রতিটি ফোনে',
    demoSub:
      'প্রতিটি ওয়ার্কস্পেসের নিজস্ব থিমযুক্ত স্টোরফ্রন্ট — রং, ট্যাগলাইন ও মেনু, যেকোনো ফোনে লাইভ।',
    ctaTitle: 'মিনিটেই আপনার মেনু চালু করুন',
    ctaSub: '৩০ দিনের ফ্রি ট্রায়াল, কার্ড লাগবে না। আজই অর্ডার নেওয়া শুরু করুন।',
    footerTag: 'রেস্টুরেন্ট SaaS, তৈরি ঢাকায়',
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
