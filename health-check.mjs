#!/usr/bin/env node
// health-check.mjs — проверка источников до включения в ежедневный прогон.
//
// Запуск:
//   node scripts/health-check.mjs            # все источники
//   node scripts/health-check.mjs --only=ru  # только Россия
//   node scripts/health-check.mjs --strict   # exit 1, если есть упавшие
//   node scripts/health-check.mjs --json=docs/health.json

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { SOURCES, fetchFeed } from './news-agent.mjs';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [key, ...rest] = a.split('=');
    return [key, rest.length ? rest.join('=') : true];
  })
);

const only = typeof args.get('--only') === 'string' ? args.get('--only') : null;
const strict = args.has('--strict');
const jsonPath = typeof args.get('--json') === 'string' ? args.get('--json') : null;

const targets = SOURCES.filter((s) => !only || s.region === only || s.id === only);
const useColor = process.stdout.isTTY;
const paint = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);

console.log(`Проверяю ${targets.length} источников…\n`);

const rows = await Promise.all(
  targets.map(async (src) => {
    const result = await fetchFeed(src, { timeoutMs: 20000 });
    return { src, ...result };
  })
);

const idWidth = Math.max(...rows.map((r) => r.src.id.length), 2);
console.log(`${'ID'.padEnd(idWidth)}  ${'REGION'.padEnd(6)} ${'OK'.padEnd(3)} ${'HTTP'.padStart(4)} ${'MS'.padStart(6)} ${'ITEMS'.padStart(5)}  NOTE`);
console.log('-'.repeat(idWidth + 40));

for (const row of rows.sort((a, b) => Number(b.ok) - Number(a.ok) || b.items.length - a.items.length)) {
  const ok = row.ok ? paint('32', 'OK ') : paint('31', 'ERR');
  const note = row.ok ? row.src.name : row.error;
  console.log(
    `${row.src.id.padEnd(idWidth)}  ${row.src.region.padEnd(6)} ${ok} ${String(row.status ?? '—').padStart(4)} ` +
    `${String(row.ms).padStart(6)} ${String(row.items.length).padStart(5)}  ${note}`
  );
}

const okRows = rows.filter((r) => r.ok);
const failed = rows.filter((r) => !r.ok);
const totalItems = rows.reduce((sum, r) => sum + r.items.length, 0);
const median = okRows.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(okRows.length / 2)] ?? 0;

console.log(
  `\nИтог: ${okRows.length}/${rows.length} источников ответили, ${totalItems} записей, медиана ${median} мс.`
);
if (failed.length) {
  console.log(`Упали: ${failed.map((r) => `${r.src.id} (${r.error})`).join(', ')}`);
  console.log('Это нормально для части зарубежных фидов на домашнем IP: решающий прогон — на GitHub Actions.');
}

if (jsonPath) {
  const out = resolve(process.cwd(), jsonPath);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(
    out,
    JSON.stringify(
      {
        checked: new Date().toISOString(),
        ok: okRows.length,
        total: rows.length,
        sources: rows.map((r) => ({
          id: r.src.id,
          region: r.src.region,
          ok: r.ok,
          status: r.status,
          ms: r.ms,
          items: r.items.length,
          error: r.ok ? null : r.error
        }))
      },
      null,
      2
    ) + '\n',
    'utf-8'
  );
  console.log(`Отчёт: ${out}`);
}

process.exit(strict && failed.length ? 1 : 0);
