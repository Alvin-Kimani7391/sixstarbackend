// ============================================================
// Shop theme contract — the single source of truth for what a
// seller's `themeConfiguration` blob can contain.
// ============================================================

const SOCIAL_PLATFORM_META = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  twitter: 'X (Twitter)',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
  telegram: 'Telegram',
  snapchat: 'Snapchat',
  threads: 'Threads',
  website: 'Website / other',
};
const SOCIAL_PLATFORMS = Object.keys(SOCIAL_PLATFORM_META);

const DEFAULT_THEME = {
  colors: {
    primary: '#f2a93b',
    secondary: '#16324f',
    background: '#fbf3e7',
    surface: '#ffffff',
    text: '#1b1f23',
    textMuted: '#7a7268',
  },
  fonts: {
    heading: 'Fraunces',
    body: 'Inter',
  },
  header: {
    style: 'centered', // 'centered' | 'left' | 'logo-only'
    sticky: true,
    showSearch: true,
    showCategoryNav: true,
    // NEW — text shown right after the logo, fully styleable
    tagline: '',
    taglineColor: '#7a7268',
    taglineSize: 'medium', // 'small' | 'medium' | 'large'
    announcementBar: {
      enabled: false,
      text: '',
      bgColor: '#16324f',
      textColor: '#ffffff',
    },
  },
  hero: {
    type: 'banner', // 'banner' | 'slideshow' | 'none'
    slides: [
      {
        image: '', heading: '', subheading: '', buttonText: '', buttonLink: '',
        // NEW — per-slide text placement + styling
        contentAlign: 'left',       // 'left' | 'center' | 'right'
        contentPosition: 'middle',  // 'top' | 'middle' | 'bottom'
        headingColor: '#ffffff',
        subheadingColor: '#ffffff',
        buttonBgColor: '#f2a93b',
        buttonTextColor: '#16324f',
        headingSize: 'large',       // 'small' | 'medium' | 'large'
      },
    ],
  },
  productGrid: {
    columns: 3, // 2 | 3 | 4
    cardStyle: 'shadow',
    showRating: true,
    showStockBadge: true,
  },
  sections: [
    { id: 's1', type: 'featured_products', title: 'Featured', productIds: [] },
    { id: 's2', type: 'all_products', title: 'All products' },
  ],
  footer: {
    style: 'simple', // 'simple' | 'expanded'
    columns: [],
    showSocial: false,
    // CHANGED — now a free list, any platform, any count (was a fixed object)
    socialLinks: [],
    showPaymentNote: true,
    copyrightText: '',
    // NEW — where the copyright line sits
    copyrightAlign: 'center', // 'left' | 'center' | 'right'
  },
};

const LIMITS = {
  maxSections: 12,
  maxSlides: 6,
  maxFooterColumns: 6,
  maxLinksPerColumn: 10,
  maxStringLen: 300,
  maxRichTextLen: 4000,
  maxProductIdsPerSection: 40,
  maxSocialLinks: 10,
};

function clampStr(val, max = LIMITS.maxStringLen) {
  if (typeof val !== 'string') return '';
  return val.slice(0, max);
}
function clampBool(val, fallback) {
  return typeof val === 'boolean' ? val : fallback;
}
function clampHex(val, fallback) {
  if (typeof val === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(val.trim())) {
    return val.trim();
  }
  return fallback;
}
function clampEnum(val, allowed, fallback) {
  return allowed.includes(val) ? val : fallback;
}

// Accepts either the NEW array shape ([{platform,url,label}]) or the OLD
// fixed-object shape ({facebook,instagram,tiktok,whatsapp}) and always
// returns the new array shape. Used on both the read path (mergeWithDefaults)
// and the write path (sanitizeIncomingTheme), so legacy shops migrate
// transparently the moment they're next viewed or saved.
function normalizeSocialLinks(raw) {
  if (Array.isArray(raw)) {
    return raw
      .filter((l) => l && typeof l === 'object' && l.url)
      .slice(0, LIMITS.maxSocialLinks)
      .map((l) => ({
        platform: SOCIAL_PLATFORMS.includes(l.platform) ? l.platform : 'website',
        url: clampStr(l.url, 300),
        label: clampStr(l.label, 40),
      }));
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw)
      .filter(([k, v]) => SOCIAL_PLATFORMS.includes(k) && v)
      .map(([platform, url]) => ({ platform, url: clampStr(url, 300), label: '' }));
  }
  return [];
}

// ---------------------------------------------------------------
// mergeWithDefaults — READ path.
// ---------------------------------------------------------------
function mergeWithDefaults(saved = {}) {
  saved = saved && typeof saved === 'object' ? saved : {};

  const colors = { ...DEFAULT_THEME.colors, ...(saved.colors || {}) };
  const fonts = { ...DEFAULT_THEME.fonts, ...(saved.fonts || {}) };

  const header = {
    ...DEFAULT_THEME.header,
    ...(saved.header || {}),
    announcementBar: {
      ...DEFAULT_THEME.header.announcementBar,
      ...(saved.header?.announcementBar || {}),
    },
  };

  const defaultSlide = DEFAULT_THEME.hero.slides[0];
  const hero = {
    ...DEFAULT_THEME.hero,
    ...(saved.hero || {}),
    slides:
      Array.isArray(saved.hero?.slides) && saved.hero.slides.length
        ? saved.hero.slides.slice(0, LIMITS.maxSlides).map((s) => ({ ...defaultSlide, ...(s || {}) }))
        : DEFAULT_THEME.hero.slides,
  };

  const productGrid = { ...DEFAULT_THEME.productGrid, ...(saved.productGrid || {}) };

  const sections =
    Array.isArray(saved.sections) && saved.sections.length
      ? saved.sections.slice(0, LIMITS.maxSections)
      : DEFAULT_THEME.sections;

  const footer = {
    ...DEFAULT_THEME.footer,
    ...(saved.footer || {}),
    columns: Array.isArray(saved.footer?.columns) ? saved.footer.columns.slice(0, LIMITS.maxFooterColumns) : [],
    socialLinks: normalizeSocialLinks(saved.footer?.socialLinks),
    copyrightAlign: clampEnum(saved.footer?.copyrightAlign, ['left', 'center', 'right'], 'center'),
  };

  return { colors, fonts, header, hero, productGrid, sections, footer };
}

// ---------------------------------------------------------------
// sanitizeIncomingTheme — WRITE path.
// ---------------------------------------------------------------
function sanitizeIncomingTheme(raw) {
  if (!raw || typeof raw !== 'object') return {};

  const out = {};

  if (raw.colors && typeof raw.colors === 'object') {
    out.colors = {};
    for (const key of Object.keys(DEFAULT_THEME.colors)) {
      if (raw.colors[key] !== undefined) {
        out.colors[key] = clampHex(raw.colors[key], DEFAULT_THEME.colors[key]);
      }
    }
  }

  if (raw.fonts && typeof raw.fonts === 'object') {
    out.fonts = {
      heading: clampStr(raw.fonts.heading, 60) || DEFAULT_THEME.fonts.heading,
      body: clampStr(raw.fonts.body, 60) || DEFAULT_THEME.fonts.body,
    };
  }

  if (raw.header && typeof raw.header === 'object') {
    out.header = {
      style: clampEnum(raw.header.style, ['centered', 'left', 'logo-only'], DEFAULT_THEME.header.style),
      sticky: clampBool(raw.header.sticky, DEFAULT_THEME.header.sticky),
      showSearch: clampBool(raw.header.showSearch, DEFAULT_THEME.header.showSearch),
      showCategoryNav: clampBool(raw.header.showCategoryNav, DEFAULT_THEME.header.showCategoryNav),
      tagline: clampStr(raw.header.tagline, 80),
      taglineColor: clampHex(raw.header.taglineColor, DEFAULT_THEME.header.taglineColor),
      taglineSize: clampEnum(raw.header.taglineSize, ['small', 'medium', 'large'], DEFAULT_THEME.header.taglineSize),
      announcementBar: {
        enabled: clampBool(raw.header.announcementBar?.enabled, false),
        text: clampStr(raw.header.announcementBar?.text),
        bgColor: clampHex(raw.header.announcementBar?.bgColor, DEFAULT_THEME.header.announcementBar.bgColor),
        textColor: clampHex(raw.header.announcementBar?.textColor, DEFAULT_THEME.header.announcementBar.textColor),
      },
    };
  }

  if (raw.hero && typeof raw.hero === 'object') {
    const slides = Array.isArray(raw.hero.slides) ? raw.hero.slides.slice(0, LIMITS.maxSlides) : [];
    const defaultSlide = DEFAULT_THEME.hero.slides[0];
    out.hero = {
      type: clampEnum(raw.hero.type, ['banner', 'slideshow', 'none'], DEFAULT_THEME.hero.type),
      slides: slides.map((s) => ({
        image: clampStr(s?.image, 1000),
        heading: clampStr(s?.heading),
        subheading: clampStr(s?.subheading),
        buttonText: clampStr(s?.buttonText, 60),
        buttonLink: clampStr(s?.buttonLink, 500),
        contentAlign: clampEnum(s?.contentAlign, ['left', 'center', 'right'], defaultSlide.contentAlign),
        contentPosition: clampEnum(s?.contentPosition, ['top', 'middle', 'bottom'], defaultSlide.contentPosition),
        headingColor: clampHex(s?.headingColor, defaultSlide.headingColor),
        subheadingColor: clampHex(s?.subheadingColor, defaultSlide.subheadingColor),
        buttonBgColor: clampHex(s?.buttonBgColor, defaultSlide.buttonBgColor),
        buttonTextColor: clampHex(s?.buttonTextColor, defaultSlide.buttonTextColor),
        headingSize: clampEnum(s?.headingSize, ['small', 'medium', 'large'], defaultSlide.headingSize),
      })),
    };
  }

  if (raw.productGrid && typeof raw.productGrid === 'object') {
    const cols = Number(raw.productGrid.columns);
    out.productGrid = {
      columns: [2, 3, 4].includes(cols) ? cols : DEFAULT_THEME.productGrid.columns,
      cardStyle: clampEnum(raw.productGrid.cardStyle, ['minimal', 'bordered', 'shadow'], DEFAULT_THEME.productGrid.cardStyle),
      showRating: clampBool(raw.productGrid.showRating, true),
      showStockBadge: clampBool(raw.productGrid.showStockBadge, true),
    };
  }

  if (Array.isArray(raw.sections)) {
    out.sections = raw.sections.slice(0, LIMITS.maxSections).map((s, i) => ({
      id: clampStr(s?.id, 40) || `s${i + 1}`,
      type: clampEnum(s?.type, ['featured_products', 'all_products', 'rich_text'], 'rich_text'),
      title: clampStr(s?.title, 120),
      body: clampStr(s?.body, LIMITS.maxRichTextLen),
      productIds: Array.isArray(s?.productIds)
        ? s.productIds.slice(0, LIMITS.maxProductIdsPerSection).map((id) => clampStr(id, 40))
        : [],
    }));
  }

  if (raw.footer && typeof raw.footer === 'object') {
    const columns = Array.isArray(raw.footer.columns) ? raw.footer.columns.slice(0, LIMITS.maxFooterColumns) : [];
    out.footer = {
      style: clampEnum(raw.footer.style, ['simple', 'expanded'], DEFAULT_THEME.footer.style),
      columns: columns.map((c) => ({
        title: clampStr(c?.title, 60),
        links: Array.isArray(c?.links)
          ? c.links.slice(0, LIMITS.maxLinksPerColumn).map((l) => ({
              label: clampStr(l?.label, 60),
              url: clampStr(l?.url, 500),
            }))
          : [],
      })),
      showSocial: clampBool(raw.footer.showSocial, false),
      socialLinks: normalizeSocialLinks(raw.footer.socialLinks),
      showPaymentNote: clampBool(raw.footer.showPaymentNote, true),
      copyrightText: clampStr(raw.footer.copyrightText, 200),
      copyrightAlign: clampEnum(raw.footer.copyrightAlign, ['left', 'center', 'right'], DEFAULT_THEME.footer.copyrightAlign),
    };
  }

  return out;
}

module.exports = { DEFAULT_THEME, SOCIAL_PLATFORM_META, mergeWithDefaults, sanitizeIncomingTheme };