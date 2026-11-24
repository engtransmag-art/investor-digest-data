#!/usr/bin/env node
// test-parser.mjs — офлайн-тесты парсера и отбора. Без сети и зависимостей.
// Запуск: node scripts/test-parser.mjs

import assert from 'node:assert/strict';
import {
  parseFeed,
  pickLink,
  classify,
  isRelevantNews,
  dedupe,
  canonicalUrl,
  normalizeTitle,
  decodeBody,
  buildPayload,
  selectItems,
  SOURCES,
  TOPICS,
  TAG_EN
} from './news-agent.mjs';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
};

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example</title>
  <link rel="self" href="https://example.com/feed.atom"/>
  <entry>
    <title>Fed holds rates steady as inflation cools</title>
    <link rel="alternate" href="https://example.com/a?utm_source=rss&amp;id=7"/>
    <published>2026-11-23T10:00:00Z</published>
    <summary><![CDATA[The <b>Fed</b> kept the key rate unchanged.]]></summary>
  </entry>
  <entry>
    <title>Nvidia earnings beat estimates</title>
    <link href="/news/nvidia-earnings"/>
    <link rel="self" href="https://example.com/self"/>
    <updated>2026-11-22T08:30:00+03:00</updated>
  </entry>
  <entry>
    <title>Без ссылки вообще</title>
    <id>tag:example.com,2026:3</id>
    <updated>2026-11-21T00:00:00Z</updated>
  </entry>
</feed>`;

const rss = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
  <title>RSS</title>
  <link>https://example.ru/</link>
  <item>
    <title>ЦБ сохранил ключевую ставку на заседании</title>
    <link>https://example.ru/news/1</link>
    <description><![CDATA[Совет директоров Банка России принял решение.]]></description>
    <pubDate>Mon, 23 Nov 2026 09:00:00 +0300</pubDate>
    <guid isPermaLink="false">abc-123</guid>
  </item>
  <item>
    <title>Газпром отчитался за квартал</title>
    <description>Выручка выросла, дивиденды под вопросом</description>
    <guid isPermaLink="false">def-456</guid>
    <pubDate>не дата</pubDate>
  </item>
</channel></rss>`;

const rdf = `<?xml version="1.0" encoding="utf-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel><title>RDF</title></channel>
  <item rdf:about="https://example.com/rdf/1">
    <title>Brent подорожал до 90 долларов</title>
    <link>https://example.com/rdf/1</link>
    <dc:date>2026-11-20T12:00:00Z</dc:date>
  </item>
</rdf:RDF>`;

const src = { id: 'test', lang: 'ru', region: 'ru', name: 'Test', url: 'https://example.com/feed.xml' };

console.log('Парсер:');
test('Atom: ссылка из href, rel=self игнорируется, сущности раскрыты', () => {
  const items = parseFeed(atom, src);
  assert.equal(items.length, 3);
  assert.equal(items[0].link, 'https://example.com/a?utm_source=rss&id=7');
  assert.equal(items[0].pubDate, '2026-11-23T10:00:00.000Z');
});
test('Atom: относительная ссылка становится абсолютной', () => {
  const items = parseFeed(atom, src);
  assert.equal(items[1].link, 'https://example.com/news/nvidia-earnings');
});
test('Atom: без ссылки остаётся пустая строка, а не мусор', () => {
  const items = parseFeed(atom, src);
  assert.equal(items[2].link, '');
  assert.equal(items[2].pubDate, '2026-11-21T00:00:00.000Z');
});
test('RSS: CDATA, pubDate RFC-822, description очищен от тегов', () => {
  const items = parseFeed(rss, src);
  assert.equal(items[0].link, 'https://example.ru/news/1');
  assert.equal(items[0].pubDate, '2026-11-23T06:00:00.000Z');
  assert.match(items[0].description, /Совет директоров Банка России/);
});
test('RSS: битая дата → null, isPermaLink=false не превращается в ссылку', () => {
  const items = parseFeed(rss, src);
  assert.equal(items[1].pubDate, null);
  assert.equal(items[1].link, '');
});
test('RDF: dc:date и item rdf:about', () => {
  const items = parseFeed(rdf, src);
  assert.equal(items[0].pubDate, '2026-11-20T12:00:00.000Z');
  assert.equal(items[0].link, 'https://example.com/rdf/1');
});
test('pickLink: rel=enclosure не считается ссылкой на материал', () => {
  const block = '<link rel="enclosure" href="https://cdn.example.com/audio.mp3"/>';
  assert.equal(pickLink(block, 'https://example.com/'), '');
});
test('decodeBody: windows-1251 из XML-декларации', () => {
  const buf = Buffer.concat([
    Buffer.from('<?xml version="1.0" encoding="windows-1251"?><rss><channel><item><title>', 'latin1'),
    Buffer.from([0xd6, 0xc1]), // «ЦБ» в cp1251
    Buffer.from('</title></item></channel></rss>', 'latin1')
  ]);
  assert.match(decodeBody(buf, 'application/rss+xml'), /ЦБ/);
});
test('decodeBody: UTF-8 BOM не ломает разбор', () => {
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<rss/>')]);
  assert.equal(decodeBody(buf, ''), '<rss/>');
});

console.log('\nКлассификация:');
test('МАКРО по «ключевой ставке»', () => {
  assert.equal(classify('Совет директоров ЦБ сохранил ключевую ставку'), 'МАКРО');
});
test('КОМПАНИИ или КОРПОРАЦИИ для Nvidia', () => {
  assert.ok(['КОМПАНИИ', 'КОРПОРАЦИИ'].includes(classify('Nvidia earnings beat estimates')));
});
test('«ai» не ловится внутри «said»', () => {
  assert.notEqual(classify('CEO said nothing important'), 'ТЕХНОЛОГИИ');
});
test('САНКЦИИ', () => {
  assert.equal(classify('ЕС ввёл новые санкции против банков'), 'САНКЦИИ');
});
test('каждый тег имеет английский перевод', () => {
  for (const [tag] of TOPICS) assert.ok(TAG_EN[tag], `нет перевода для ${tag}`);
});
test('общие новости про хоккей не проходят фильтр', () => {
  assert.equal(isRelevantNews('Сборная России выиграла матч по хоккею'), false);
});
test('обзор гаджета не проходит фильтр', () => {
  assert.equal(isRelevantNews('Обзор Яндекс Пин: диктофон, который слышит больше, чем понимает'), false);
});
test('санкции и ставка проходят фильтр', () => {
  assert.ok(isRelevantNews('ЕС ввёл новые санкции против банков'));
  assert.ok(isRelevantNews('ЦБ сохранил ключевую ставку'));
  assert.ok(isRelevantNews('Brent подорожал до 90 долларов за баррель'));
});
test('английские заголовки про рынок проходят фильтр', () => {
  assert.ok(isRelevantNews('US tech stocks set to slip after blistering rally'));
  assert.ok(isRelevantNews('Fed holds rates steady as inflation cools'));
});
test('происшествия не проходят, даже если цепляют слово «газ»', () => {
  assert.equal(isRelevantNews('После взрыва газа в доме на Алтае ищут двух человек'), false);
  assert.equal(isRelevantNews('Мошенники похитили у пенсионерки 12 млн рублей'), false);
});

console.log('\nДедупликация:');
test('одна ссылка с разными utm — один материал', () => {
  const items = [
    { title: 'A', link: 'https://ex.com/x?utm_source=tg', sourceId: 'a' },
    { title: 'B', link: 'https://www.ex.com/x', sourceId: 'b' }
  ];
  assert.equal(dedupe(items).length, 1);
});
test('канонический URL убирает www, якорь и utm', () => {
  assert.equal(canonicalUrl('https://www.ex.com/x/?utm_campaign=q&id=3#top'), 'https://ex.com/x?id=3');
});
test('почти одинаковые заголовки схлопываются', () => {
  const items = [
    { title: 'ЦБ сохранил ключевую ставку на уровне 16%', link: 'https://a.ru/1', sourceId: 'a' },
    { title: 'ЦБ сохранил ключевую ставку на уровне 16 процентов', link: 'https://b.ru/2', sourceId: 'b' }
  ];
  assert.equal(dedupe(items).length, 1);
});
test('разные заголовки не схлопываются', () => {
  const items = [
    { title: 'ЦБ сохранил ключевую ставку', link: 'https://a.ru/1', sourceId: 'a' },
    { title: 'Газпром снизил добычу газа', link: 'https://b.ru/2', sourceId: 'b' }
  ];
  assert.equal(dedupe(items).length, 2);
});
test('normalizeTitle убирает пунктуацию и регистр', () => {
  assert.equal(normalizeTitle('«ЦБ» — ставка!'), 'цб ставка');
});

console.log('\nОтбор и контракт:');
test('лимит на источник — не больше 5 карточек', () => {
  const sectors = ['Нефтянка', 'Газ', 'Золото', 'Банки', 'Ритейл', 'Телеком', 'Металлы', 'Химия', 'Энергетика', 'Девелопмент', 'Логистика', 'Агро'];
  const items = sectors.map((sector, i) => ({
    title: `${sector} отчиталась за квартал`,
    pubDate: new Date(Date.now() - i * 3600_000).toISOString(),
    sourceId: 'one',
    region: 'ru',
    lang: 'ru',
    sourceName: 'One',
    link: `https://ex.com/${i}`,
    description: ''
  }));
  assert.equal(selectItems(items, { days: 14, max: 60 }).length, 5);
});
test('разные компании с одинаковым шаблоном заголовка не считаются дублем', () => {
  const items = [
    { title: 'Сбер отчитался за 9 месяцев', link: 'https://a.ru/1', sourceId: 'a' },
    { title: 'ВТБ отчитался за 9 месяцев', link: 'https://b.ru/2', sourceId: 'b' }
  ];
  assert.equal(dedupe(items).length, 2);
});
test('старое отбрасывается', () => {
  const items = [
    { title: 'Свежая новость про рынок и ставку', pubDate: new Date().toISOString(), sourceId: 's', region: 'ru', lang: 'ru', sourceName: 'S', link: 'https://ex.com/1', description: '' },
    { title: 'Старая новость про рынок и ставку', pubDate: new Date(Date.now() - 30 * 86400_000).toISOString(), sourceId: 's', region: 'ru', lang: 'ru', sourceName: 'S', link: 'https://ex.com/2', description: '' }
  ];
  assert.equal(selectItems(items, { days: 14, max: 60 }).length, 1);
});
test('контракт news.json: date/region/tag/source/title/url + period', () => {
  const payload = buildPayload([
    { title: 'Инфляция замедлилась', description: '', pubDate: '2026-11-23T06:00:00.000Z', region: 'ru', lang: 'ru', sourceName: 'РБК', link: 'https://ex.com/1', sourceId: 'rbc' }
  ], { updated: '2026-11-24T06:30:00.000Z' });
  const card = payload.news[0];
  assert.deepEqual(card.date, { ru: '23.11', en: 'Nov 23' });
  assert.equal(card.tag.ru, 'МАКРО');
  assert.equal(card.tag.en, 'MACRO');
  assert.deepEqual(card.source, { ru: 'РБК', en: 'РБК' });
  assert.deepEqual(card.title, { ru: 'Инфляция замедлилась', en: 'Инфляция замедлилась' });
  assert.equal(card.url, 'https://ex.com/1');
  assert.deepEqual(payload.period, { from: '23.11', to: '23.11' });
  assert.equal(payload.updated, '2026-11-24T06:30:00.000Z');
});

console.log('\nСписок источников:');
test('у всех источников уникальный id, https и заполненные поля', () => {
  const ids = new Set();
  for (const s of SOURCES) {
    assert.ok(!ids.has(s.id), `дубль id: ${s.id}`);
    ids.add(s.id);
    assert.match(s.url, /^https:\/\//, `${s.id}: не https`);
    assert.ok(['ru', 'world'].includes(s.region), `${s.id}: регион`);
    assert.ok(['ru', 'en'].includes(s.lang), `${s.id}: язык`);
    assert.ok(s.name, `${s.id}: имя`);
  }
});

console.log(`\nПройдено: ${passed}`);
