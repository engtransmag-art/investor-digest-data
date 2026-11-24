#!/usr/bin/env node
// news-agent.mjs — ежедневный агент инвестиционного дайджеста для сайта на Tilda.
//
// Node 18+, без внешних зависимостей.
// Вход:  RSS 2.0 / RDF / Atom (список SOURCES ниже)
// Выход: docs/news.json         — данные для блока T123 (контракт не менялся)
//        docs/news-report.json  — статус источников для бейджа «источников 18/26»
//
// Запуск:  node scripts/news-agent.mjs [--out=docs] [--max=60] [--days=14] [--no-translate]
// Env:     TRANSLATE_API_KEY (DeepL), DEEPL_ENDPOINT, MAX_ITEMS, FRESH_DAYS

import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const UA = 'tilda-news-digest/1.0 (RSS digest; +https://github.com/)';
const PER_SOURCE_CAP = 5;
const WORLD_SHARE = 0.3; // минимум мировой повестки в дайджесте

// ─────────────────────────────────────────────────────────────
// Источники. Проверены 2026-11-24 (health-check проходит по всем).
// kind: 'business' — берём всё; 'general' — только материалы, попавшие в темы.
// ─────────────────────────────────────────────────────────────
export const SOURCES = [
  // Россия
  { id: 'rbc',         region: 'ru', lang: 'ru', name: 'РБК',               url: 'https://rssexport.rbc.ru/rbcnews/news/30/full.rss' },
  { id: 'vedomosti',   region: 'ru', lang: 'ru', name: 'Ведомости',         url: 'https://www.vedomosti.ru/rss/news.xml' },
  { id: 'ved_fin',     region: 'ru', lang: 'ru', name: 'Ведомости Финансы', url: 'https://www.vedomosti.ru/rss/rubric/finance' },
  { id: 'kommersant',  region: 'ru', lang: 'ru', name: 'Коммерсантъ',       url: 'https://www.kommersant.ru/RSS/news.xml' },
  { id: 'komm_money',  region: 'ru', lang: 'ru', name: 'Коммерсантъ Деньги',url: 'https://www.kommersant.ru/RSS/money.xml' },
  { id: 'tass',        region: 'ru', lang: 'ru', name: 'ТАСС',              url: 'https://tass.ru/rss/v2.xml' },
  { id: 'interfax',    region: 'ru', lang: 'ru', name: 'Интерфакс',         url: 'https://www.interfax.ru/rss.asp' },
  { id: 'bfm',         region: 'ru', lang: 'ru', name: 'BFM',               url: 'https://www.bfm.ru/news.rss' },
  { id: 'finam',       region: 'ru', lang: 'ru', name: 'Финам',             url: 'https://www.finam.ru/analysis/conews/rsspoint/' },
  { id: 'finmarket',   region: 'ru', lang: 'ru', name: 'Финмаркет',         url: 'https://www.finmarket.ru/rss/mainnews.asp' },
  { id: 'banki',       region: 'ru', lang: 'ru', name: 'Banki.ru',          url: 'https://www.banki.ru/xml/news.rss' },
  { id: 'cbr',         region: 'ru', lang: 'ru', name: 'Банк России',       url: 'https://www.cbr.ru/rss/RssNews' },
  { id: 'smartlab',    region: 'ru', lang: 'ru', name: 'Smart-Lab',         url: 'https://smart-lab.ru/rss/' },
  { id: 'rg',          region: 'ru', lang: 'ru', name: 'Российская газета', url: 'https://rg.ru/xml/index.xml' },
  { id: 'ria',         region: 'ru', lang: 'ru', name: 'РИА Новости',       url: 'https://ria.ru/export/rss2/archive/index.xml' },
  { id: 'lenta',       region: 'ru', lang: 'ru', name: 'Лента.ру',          url: 'https://lenta.ru/rss/news' },

  // Мир
  { id: 'ft',          region: 'world', lang: 'en', name: 'Financial Times', url: 'https://www.ft.com/rss/home' },
  { id: 'ft_markets',  region: 'world', lang: 'en', name: 'FT Markets',      url: 'https://www.ft.com/markets?format=rss' },
  { id: 'ft_companies',region: 'world', lang: 'en', name: 'FT Companies',    url: 'https://www.ft.com/companies?format=rss' },
  { id: 'bloomberg',   region: 'world', lang: 'en', name: 'Bloomberg',       url: 'https://feeds.bloomberg.com/markets/news.rss' },
  { id: 'cnbc',        region: 'world', lang: 'en', name: 'CNBC',            url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  { id: 'wsj',         region: 'world', lang: 'en', name: 'WSJ Markets',     url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml' },
  { id: 'marketwatch', region: 'world', lang: 'en', name: 'MarketWatch',     url: 'https://www.marketwatch.com/rss/topstories' },
  { id: 'investing',   region: 'world', lang: 'en', name: 'Investing.com',   url: 'https://www.investing.com/rss/news_25.rss' },
  { id: 'seeking',     region: 'world', lang: 'en', name: 'Seeking Alpha',   url: 'https://seekingalpha.com/feed.xml' },
  { id: 'economist',   region: 'world', lang: 'en', name: 'The Economist',   url: 'https://www.economist.com/finance-and-economics/rss.xml' },
  { id: 'fed',         region: 'world', lang: 'en', name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
  { id: 'aljazeera',   region: 'world', lang: 'en', name: 'Al Jazeera',      url: 'https://www.aljazeera.com/xml/rss/all.xml' }
];

// ─────────────────────────────────────────────────────────────
// 26 тем: [тег RU, [ключи]]. Русские ключи — основы слова (без окончаний),
// латинские — отдельные слова (проверяются по границам, чтобы «ai» не ловило «said»).
// ─────────────────────────────────────────────────────────────
export const TOPICS = [
  ['МАКРО',          ['инфляц', 'дефляц', 'ключев', 'ставк', 'центробанк', 'цб', 'макро', 'ввп', 'дефицит', 'профицит', 'безработиц', 'inflation', 'key rate', 'cpi', 'gdp', 'payroll', 'fed', 'fomc', 'ecb', 'rate cut', 'rate hike']],
  ['РЫНКИ',          ['индекс', 'мосбирж', 'ртс', 'imoex', 'котиров', 'рынк', 'торги', 'капитализац', 'index', 'stocks', 'shares', 'equity', 'nasdaq', 's&p', 'dow jones', 'wall street', 'rally', 'selloff']],
  ['ДИВИДЕНДЫ',      ['дивиденд', 'реестр', 'выплат', 'dividend', 'payout']],
  ['КОМПАНИИ',       ['газпром', 'лукойл', 'роснефт', 'сбер', 'втб', 'мтс', 'яндекс', 'норникел', 'северстал', 'татнефт', 'норильск', 'earnings', 'quarterly', 'revenue']],
  ['КОРПОРАЦИИ',     ['nvidia', 'apple', 'microsoft', 'google', 'alphabet', 'amazon', 'meta', 'tesla', 'openai', 'samsung', 'ceo', 'corporation', 'корпорац']],
  ['САНКЦИИ',        ['санкц', 'ограничит', 'замороз', 'подсанкц', 'sanction', 'blacklist', 'ofac', 'embargo']],
  ['МЕЖДУНАРОДКА',   ['брикс', 'brics', 'атэс', 'apec', 'g20', 'g7', 'саммит', 'summit', 'оон', 'wto', 'всемирная торговая', 'международн']],
  ['M&A',            ['поглощ', 'слиян', 'приобрет', 'merger', 'acquisition', 'acquires', 'buyout', 'takeover']],
  ['ТЕХНОЛОГИИ',     ['технолог', 'искусственн', 'нейросет', 'чип', 'полупроводник', 'semiconductor', 'chip', 'artificial intelligence', 'tech']],
  ['НЕФТЬ',          ['нефт', 'brent', 'wti', 'баррел', 'opec', 'опек', 'oil']],
  ['ГАЗ',            ['газ', 'lng', 'gas', 'газопровод']],
  ['ЗОЛОТО',         ['золот', 'gold', 'драгметалл']],
  ['КРИПТОВАЛЮТЫ',   ['биткоин', 'btc', 'ethereum', 'крипт', 'bitcoin', 'crypto', 'stablecoin', 'стейблкоин']],
  ['ОБЛИГАЦИИ',      ['облигац', 'бонд', 'офз', 'ofz', 'bond', 'treasury yield']],
  ['НЕДВИЖИМОСТЬ',   ['недвижим', 'ипотек', 'застройщ', 'real estate', 'mortgage', 'housing']],
  ['РЕГУЛИРОВАНИЕ',  ['регулир', 'закон', 'штраф', 'лиценз', 'импорт', 'экспорт', 'пошлин', 'тариф', 'regulation', 'regulator', 'antitrust', 'fine']],
  ['ГОСУПРАВЛЕНИЕ',  ['правительств', 'минфин', 'минцифр', 'госдум', 'ministry', 'government', 'treasury', 'бюджет', 'budget']],
  ['ГОСПОДДЕРЖКА',   ['субсид', 'господдержк', 'льгот', 'subsid', 'bailout', 'state aid']],
  ['ИНФРАСТРУКТУРА', ['инфраструктур', 'дорог', 'мост', 'строительств', 'infrastructure']],
  ['ЭНЕРГЕТИКА',     ['энергетик', 'электроэнерг', 'электроснабж', 'электросет', 'генерац', 'energy', 'power grid', 'utility']],
  ['ФИНАНСЫ',        ['банк', 'кредит', 'вклад', 'прибыл', 'выручк', 'убыт', 'отчетност', 'finance', 'bank', 'loan', 'lending']],
  ['РЕГИОНЫ',        ['региональн', 'region']],
  ['СТАРТАПЫ',       ['стартап', 'startup', 'start-up', 'venture', 'венчур']],
  ['IPO',            ['ipo', 'размещен', 'листинг', 'listing', 'spinoff']],
  ['ФОНДЫ',          ['фонд', 'fund', 'etf', 'паевой']],
  ['АНАЛИТИКА',      ['аналитик', 'прогноз', 'ожида', 'forecast', 'analyst', 'outlook', 'rating']]
];

export const TAG_EN = {
  'МАКРО': 'MACRO', 'РЫНКИ': 'MARKETS', 'ДИВИДЕНДЫ': 'DIVIDENDS', 'КОМПАНИИ': 'COMPANIES',
  'КОРПОРАЦИИ': 'CORPORATIONS', 'САНКЦИИ': 'SANCTIONS', 'МЕЖДУНАРОДКА': 'INTERNATIONAL',
  'M&A': 'M&A', 'ТЕХНОЛОГИИ': 'TECH', 'НЕФТЬ': 'OIL', 'ГАЗ': 'GAS', 'ЗОЛОТО': 'GOLD',
  'КРИПТОВАЛЮТЫ': 'CRYPTO', 'ОБЛИГАЦИИ': 'BONDS', 'НЕДВИЖИМОСТЬ': 'REAL ESTATE',
  'РЕГУЛИРОВАНИЕ': 'REGULATION', 'ГОСУПРАВЛЕНИЕ': 'GOV', 'ГОСПОДДЕРЖКА': 'GOV SUPPORT',
  'ИНФРАСТРУКТУРА': 'INFRASTRUCTURE', 'ЭНЕРГЕТИКА': 'ENERGY', 'ФИНАНСЫ': 'FINANCE',
  'РЕГИОНЫ': 'REGIONS', 'СТАРТАПЫ': 'STARTUPS', 'IPO': 'IPO', 'ФОНДЫ': 'FUNDS',
  'АНАЛИТИКА': 'ANALYTICS'
};

// ── Текстовые утилиты ────────────────────────────────────────

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&#39;': "'" };

export const decodeEntities = (s) => String(s ?? '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m);

export const stripCdata = (s) => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

/** Убирает разметку и нормализует пробелы. */
export const clean = (s) => decodeEntities(stripCdata(s))
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const firstTag = (block, names) => {
  for (const name of names) {
    const m = new RegExp(`<${escapeRe(name)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRe(name)}>`, 'i').exec(block);
    if (m) {
      const value = clean(m[1]);
      if (value) return value;
    }
  }
  return '';
};

const attr = (tagAttrs, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tagAttrs || '');
  return m ? (m[2] ?? m[3] ?? m[4]) : null;
};

const absolutize = (href, base) => {
  const raw = clean(href || '');
  if (!raw) return '';
  try {
    return new URL(raw, base).toString();
  } catch {
    return /^https?:\/\//i.test(raw) ? raw : '';
  }
};

/**
 * Ссылка на материал. Атомные фиды отдают self-closing `<link href="…"/>`,
 * где регэксп вида `<link>…</link>` возвращает пустоту — это и была ошибка
 * в первой версии агента. Разбираем атрибуты, отбрасываем rel=self/enclosure.
 */
export function pickLink(block, base) {
  let fallback = '';
  for (const m of block.matchAll(/<link\b([^>]*)>/gi)) {
    const href = attr(m[1], 'href');
    if (!href) continue;
    const rel = (attr(m[1], 'rel') || 'alternate').toLowerCase();
    if (['self', 'edit', 'replies', 'enclosure', 'via', 'hub'].includes(rel)) continue;
    const url = absolutize(href, base);
    if (!url) continue;
    if (rel === 'alternate') return url;
    if (!fallback) fallback = url;
  }
  if (fallback) return fallback;

  const rssLink = firstTag(block, ['link']);
  if (rssLink) return absolutize(rssLink, base);

  const guid = /<guid\b([^>]*)>([\s\S]*?)<\/guid>/i.exec(block);
  if (guid) {
    const permaLink = attr(guid[1], 'isPermaLink');
    if (permaLink === null || permaLink.toLowerCase() !== 'false') {
      const url = absolutize(clean(guid[2]), base);
      if (url) return url;
    }
  }

  const id = /<id\b[^>]*>([\s\S]*?)<\/id>/i.exec(block);
  if (id && /^https?:\/\//i.test(clean(id[1]))) return clean(id[1]);

  return '';
}

const parseDate = (raw) => {
  if (!raw) return null;
  const value = clean(raw).replace(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/, '$3-$2-$1');
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * Разбор RSS 2.0 / RDF / Atom.
 * @param {string} xml тело фида
 * @param {{id:string,lang:string,region:string,name:string,url:string}} src источник
 */
export function parseFeed(xml, src) {
  const items = [];
  const re = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of xml.matchAll(re)) {
    if (items.length >= 80) break;
    const block = m[2];

    const title = firstTag(block, ['title']);
    if (!title) continue;

    const description = firstTag(block, ['content:encoded', 'description', 'summary', 'content']).slice(0, 800);
    const link = pickLink(block, src.url);
    const pubDate = parseDate(firstTag(block, ['pubDate', 'dc:date', 'published', 'updated', 'date']));

    items.push({
      title,
      description,
      link,
      pubDate,
      sourceId: src.id,
      sourceName: src.name,
      region: src.region,
      lang: src.lang
    });
  }
  return items;
}

// ── Классификация ────────────────────────────────────────────

/** Совпадение с начала слова: «поставка» не содержит «ставку», «вакцинация» — «акцию». */
const stemAt = (text, stem) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(stem)}`, 'u').test(text);

const hasWord = (text, word) => {
  const re = new RegExp(`(^|[^a-z0-9])${escapeRe(word)}([^a-z0-9]|$)`, 'i');
  return re.test(text);
};

const isLatinKeyword = (kw) => /^[a-z0-9$&.'\-\s]+$/i.test(kw);

/** Сопоставление с темами: попадание в заголовок весит 3, в описание — 1. */
export function matchTopics(title, description = '') {
  const t = ` ${String(title ?? '').toLowerCase()} `;
  const d = ` ${String(description ?? '').toLowerCase()} `;
  let best = null;
  let bestScore = 0;
  let inTitle = false;

  for (const [tag, keywords] of TOPICS) {
    let score = 0;
    for (const kw of keywords) {
      const hit = isLatinKeyword(kw) ? hasWord : stemAt;
      if (hit(t, kw)) {
        score += 3;
        inTitle = true;
      } else if (hit(d, kw)) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = tag;
    }
  }
  return { tag: best, score: bestScore, inTitle };
}

export function classify(title, description = '') {
  return matchTopics(title, description).tag || 'РЫНКИ';
}

/** Происшествия: их заголовки случайно цепляют «газ», «банк», «рубль». */
const INCIDENTS = ['погиб', 'убит', 'взрыв', 'пожар', 'обстрел', 'атака', 'теракт', 'дтп', 'мошенник', 'аферист', 'уголовн', 'задержан', 'полиц', 'спецоперац', 'военн', 'фронт', 'мобилиз', 'ликвидир', 'дрон', 'всу', 'удар', 'поражение'];

/** Обзорные жанры и служебные заголовки, которые формально упоминают компании, но к повестке не относятся. */
const NOISE_PREFIXES = ['обзор', 'рецепт', 'гороскоп', 'погода', 'тест-драйв'];
const NOISE_TITLES = [/earnings call presentation/i, /results - earnings call/i, /seeking alpha/i];

/**
 * Материал попадает в дайджест, только если тема определяется по заголовку
 * и это не происшествие. Иначе в ленту просачиваются снегопады, хоккей и криминал:
 * тематические ключи вроде «газ» или «банк» цепляют их случайно.
 */
export function isRelevantNews(title) {
  const text = ` ${String(title ?? '').trim().toLowerCase()} `;
  if (NOISE_PREFIXES.some((prefix) => text.trimStart().startsWith(prefix))) return false;
  if (NOISE_TITLES.some((re) => re.test(title))) return false;
  if (INCIDENTS.some((kw) => stemAt(text, kw))) return false;
  return matchTopics(title).inTitle;
}

// ── Дедупликация ─────────────────────────────────────────────

export const normalizeTitle = (title) => String(title ?? '')
  .toLowerCase()
  .replace(/[«»„“”"'`’]/g, ' ')
  .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.hostname = u.hostname.replace(/^www\./i, '');
    for (const p of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'yclid', 'gclid', 'fbclid', 'from']) {
      u.searchParams.delete(p);
    }
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    u.search = u.search === '?' ? '' : u.search;
    return u.toString();
  } catch {
    return String(url ?? '');
  }
}

const tokens = (title) => normalizeTitle(title).split(' ').filter((w) => w.length >= 2);

/**
 * Похожесть заголовков по Жаккару на словах (≥2 символов, чтобы «ЦБ», «ЕС», «МТС» не терялись).
 * Порог 0.72 и минимум 3 общих слова: «Сбер отчитался за 9 месяцев» и
 * «ВТБ отчитался за 9 месяцев» — разные новости, а не дубль.
 */
const similar = (a, b) => {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size < 3 || setB.size < 3) return false;
  if (Math.abs(setA.size - setB.size) > 2) return false;
  let common = 0;
  for (const word of setA) if (setB.has(word)) common += 1;
  if (common < 3) return false;
  return common / (setA.size + setB.size - common) >= 0.72;
};

/** Убирает дубли по URL и по почти одинаковому заголовку (в т.ч. между источниками). */
export function dedupe(items) {
  const urls = new Set();
  const recent = [];
  const out = [];

  for (const item of items) {
    const url = canonicalUrl(item.link);
    if (url && urls.has(url)) continue;

    const titleTokens = tokens(item.title);
    if (recent.some((t) => similar(t, titleTokens))) continue;

    if (url) urls.add(url);
    recent.push(titleTokens);
    if (recent.length > 300) recent.shift();
    out.push(item);
  }
  return out;
}

// ── Сеть ─────────────────────────────────────────────────────

/** Кодировка: заголовок → BOM → <?xml encoding?> → utf-8. */
export function decodeBody(buffer, contentType = '') {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);

  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 500));
    charset = /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

const describeError = (err) => {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timeout';
  const code = err?.cause?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  if (code === 'UND_ERR_CONNECT_TIMEOUT') return 'connect timeout';
  if (code === 'CERT_HAS_EXPIRED' || code === 'SELF_SIGNED_CERT_IN_CHAIN' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') return `tls: ${code}`;
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'connection reset';
  return err?.message || String(err);
};

/**
 * Скачивает и разбирает один фид. Никогда не бросает исключение:
 * ошибка возвращается в поле error — её видно в news-report.json.
 */
export async function fetchFeed(src, { timeoutMs = 15000 } = {}) {
  const started = Date.now();
  try {
    const res = await fetch(src.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': UA,
        accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8',
        'accept-language': src.lang === 'ru' ? 'ru,en;q=0.5' : 'en;q=0.8,ru;q=0.3'
      }
    });

    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || '';
    const body = decodeBody(buffer, contentType);
    const elapsed = Date.now() - started;

    if (!res.ok) return { src, ok: false, status: res.status, ms: elapsed, items: [], error: `HTTP ${res.status}` };
    if (/^\s*(<!doctype html|<html)/i.test(body.slice(0, 300))) {
      return { src, ok: false, status: res.status, ms: elapsed, items: [], error: 'HTML вместо фида (антибот)' };
    }

    const items = parseFeed(body, src);
    if (!items.length) {
      return { src, ok: false, status: res.status, ms: elapsed, items: [], error: 'фид пустой (0 записей)' };
    }
    return { src, ok: true, status: res.status, ms: elapsed, bytes: buffer.byteLength, items };
  } catch (err) {
    return { src, ok: false, status: null, ms: Date.now() - started, items: [], error: describeError(err) };
  }
}

// ── Перевод (опционально, DeepL) ─────────────────────────────

const deepEndpoint = (key) => process.env.DEEPL_ENDPOINT
  || (key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com');

async function translateChunk(texts, targetLang, key) {
  const params = new URLSearchParams();
  params.set('target_lang', targetLang);
  for (const text of texts) params.append('text', text);
  const res = await fetch(`${deepEndpoint(key)}/v2/translate`, {
    method: 'POST',
    headers: { authorization: `DeepL-Auth-Key ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error(`DeepL HTTP ${res.status}`);
  const json = await res.json();
  return json.translations?.map((t) => t.text) ?? [];
}

/** Батчевый перевод заголовков: 40 текстов на запрос, ошибки не критичны. */
async function translateAll(texts, targetLang, key) {
  const out = new Array(texts.length).fill(null);
  for (let i = 0; i < texts.length; i += 40) {
    const chunk = texts.slice(i, i + 40);
    try {
      const translated = await translateChunk(chunk, targetLang, key);
      translated.forEach((text, j) => { out[i + j] = text; });
    } catch (err) {
      console.warn(`[news-agent] перевод ${targetLang} не удался: ${err.message}`);
    }
  }
  return out;
}

// ── Сборка ───────────────────────────────────────────────────

const fmtDate = (iso, lang) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return lang === 'en' ? `${d.toLocaleString('en', { month: 'short' })} ${dd}` : `${dd}.${mm}`;
};

const writeAtomic = async (path, data) => {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, data, 'utf-8');
  await rename(tmp, path);
};

export function buildPayload(items, { updated = new Date().toISOString() } = {}) {
  const news = items.map((it) => {
    const tag = classify(it.title, it.description);
    return {
      date: { ru: fmtDate(it.pubDate, 'ru'), en: fmtDate(it.pubDate, 'en') },
      region: it.region,
      tag: { ru: tag, en: TAG_EN[tag] || tag },
      source: { ru: it.sourceName, en: it.sourceName },
      title: { ru: it.titleRu || it.title, en: it.titleEn || it.title },
      url: it.link
    };
  });

  const dates = items.map((i) => i.pubDate).filter(Boolean).sort();
  return {
    updated,
    period: news.length ? { from: fmtDate(dates[0], 'ru'), to: fmtDate(dates[dates.length - 1], 'ru') } : null,
    news
  };
}

/** Отбор: свежесть → сортировка → дедуп → квоты по источникам и регионам. */
export function selectItems(rawItems, { days = Number(process.env.FRESH_DAYS || 14), max = Number(process.env.MAX_ITEMS || 60) } = {}) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const fresh = rawItems.filter((it) => it.pubDate && new Date(it.pubDate).getTime() > cutoff && it.title.length > 20);
  fresh.sort((a, b) => b.pubDate.localeCompare(a.pubDate));

  const unique = dedupe(fresh);
  const perSource = new Map();

  const take = (pool, limit) => {
    const out = [];
    for (const item of pool) {
      if (out.length >= limit) break;
      const used = perSource.get(item.sourceId) || 0;
      if (used >= PER_SOURCE_CAP) continue;
      perSource.set(item.sourceId, used + 1);
      out.push(item);
    }
    return out;
  };

  // Мировая повестка идёт отдельной квотой, иначе 16 российских источников
  // вытесняют FT/WSJ/CNBC из первых 60 карточек.
  const worldTarget = Math.round(max * WORLD_SHARE);
  const pickedWorld = take(unique.filter((i) => i.region === 'world'), worldTarget);
  const pickedRu = take(unique.filter((i) => i.region !== 'world'), max - pickedWorld.length);

  const picked = [...pickedWorld, ...pickedRu];
  if (picked.length < max) {
    const chosen = new Set(picked);
    picked.push(...take(unique.filter((i) => !chosen.has(i)), max - picked.length));
  }

  picked.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
  return picked;
}

export async function run(options = {}) {
  const days = Number(options.days ?? process.env.FRESH_DAYS ?? 14);
  const max = Number(options.max ?? process.env.MAX_ITEMS ?? 60);
  const outDir = resolve(ROOT, options.out ?? process.env.OUT_DIR ?? 'docs');
  const translate = options.translate !== false && Boolean(process.env.TRANSLATE_API_KEY);

  console.log(`[news-agent] старт ${new Date().toISOString()} · ${SOURCES.length} источников`);

  const results = await Promise.all(SOURCES.map((src) => fetchFeed(src)));
  const rawItems = results.flatMap((r) => r.items);
  const okCount = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  console.log(`[news-agent] сеть: ок ${okCount}/${SOURCES.length}, записей ${rawItems.length}`);
  for (const r of failed) console.warn(`[news-agent]   ✗ ${r.src.id}: ${r.error}`);

  const relevant = rawItems.filter((it) => isRelevantNews(it.title));

  const picked = selectItems(relevant, { days, max });
  const byRegion = picked.reduce((acc, it) => ((acc[it.region] = (acc[it.region] || 0) + 1), acc), {});

  if (translate && picked.length) {
    const key = process.env.TRANSLATE_API_KEY;
    const ruItems = picked.filter((it) => it.lang === 'ru');
    const enItems = picked.filter((it) => it.lang === 'en');
    console.log(`[news-agent] перевод: ${ruItems.length} ru→en, ${enItems.length} en→ru`);
    const [toEn, toRu] = await Promise.all([
      translateAll(ruItems.map((i) => i.title.slice(0, 400)), 'EN-US', key),
      translateAll(enItems.map((i) => i.title.slice(0, 400)), 'RU', key)
    ]);
    ruItems.forEach((it, i) => { if (toEn[i]) it.titleEn = toEn[i]; });
    enItems.forEach((it, i) => { if (toRu[i]) it.titleRu = toRu[i]; });
  }

  const updated = new Date().toISOString();
  const payload = buildPayload(picked, { updated });
  const report = {
    updated,
    ok: picked.length > 0,
    degraded: okCount < Math.ceil(SOURCES.length * 0.6),
    sources: results.map((r) => ({
      id: r.src.id,
      name: r.src.name,
      region: r.src.region,
      ok: r.ok,
      status: r.status,
      ms: r.ms,
      count: r.items.length,
      error: r.ok ? null : r.error
    })),
    stats: {
      sources: SOURCES.length,
      sourcesOk: okCount,
      raw: rawItems.length,
      relevant: relevant.length,
      written: payload.news.length,
      byRegion
    }
  };

  await writeAtomic(join(outDir, 'news.json'), JSON.stringify(payload, null, 2) + '\n');
  await writeAtomic(join(outDir, 'news-report.json'), JSON.stringify(report, null, 2) + '\n');

  console.log(`[news-agent] готово: ${payload.news.length} карточек → ${join(outDir, 'news.json')}`);
  console.log(`[news-agent] регионы: ${JSON.stringify(byRegion)} · источников ок ${okCount}/${SOURCES.length}`);
  return { payload, report, exitCode: payload.news.length ? 0 : 1 };
}

// ── CLI ──────────────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = new Map(
    process.argv.slice(2).map((a) => {
      const [key, ...rest] = a.split('=');
      return [key, rest.length ? rest.join('=') : true];
    })
  );

  run({
    out: args.get('--out'),
    max: args.get('--max'),
    days: args.get('--days'),
    translate: !args.has('--no-translate')
  })
    .then(({ exitCode }) => process.exit(exitCode))
    .catch((err) => {
      console.error('[news-agent] FAIL', err);
      process.exit(1);
    });
}
