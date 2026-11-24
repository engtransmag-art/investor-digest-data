#!/usr/bin/env node
// report-summary.mjs — markdown-сводка прогона для GitHub Actions Job Summary.
// Ничего не пишет на диск, печатает в stdout (workflow перенаправляет в $GITHUB_STEP_SUMMARY).

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const file = resolve(process.cwd(), process.env.OUT_DIR || 'docs', 'news-report.json');

let report;
try {
  report = JSON.parse(await readFile(file, 'utf-8'));
} catch {
  console.log('### Дайджест не собран\n\nФайл `docs/news-report.json` не найден — агент упал до записи отчёта.');
  process.exit(0);
}

const failed = report.sources.filter((s) => !s.ok);
const fmtTime = (iso) => new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' });

console.log('### Дайджест собран');
console.log('');
console.log(`Обновлено: **${fmtTime(report.updated)} МСК** · карточек: **${report.stats.written}** · источников: **${report.stats.sourcesOk}/${report.stats.sources}**`);
console.log('');
console.log('| Показатель | Значение |');
console.log('| --- | --- |');
console.log(`| Сырых записей | ${report.stats.raw} |`);
console.log(`| Прошли фильтр | ${report.stats.relevant} |`);
console.log(`| В ленте | ${report.stats.written} |`);
console.log(`| Россия / мир | ${report.stats.byRegion.ru || 0} / ${report.stats.byRegion.world || 0} |`);

if (failed.length) {
  console.log('');
  console.log(`<details><summary>Не ответили: ${failed.length}</summary>`);
  console.log('');
  console.log('| Источник | Ошибка |');
  console.log('| --- | --- |');
  for (const source of failed) console.log(`| ${source.id} | ${source.error} |`);
  console.log('');
  console.log('</details>');
}
