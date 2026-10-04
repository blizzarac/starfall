/**
 * Balance report: one bot per job path plays for a few game hours.
 * Run with `npm run balance`; writes docs/balance.md.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { it } from 'vitest';
import { loadContent } from '../src/data/content';
import { AREAS, BUILDS, newRun, type Bot } from './bot';

const HOURS = Number(process.env.SIM_HOURS ?? 6);
const SEEDS = Number(process.env.SIM_SEEDS ?? 1);

it('balance report', () => {
  const content = loadContent();
  const results: Array<{ name: string; bot: Bot }> = [];
  for (const [name, build] of Object.entries(BUILDS)) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const bot = newRun(content, build, seed);
      const t0 = performance.now();
      bot.run(HOURS * 60);
      console.log(`${name} seed ${seed}: base ${bot.world.player.baseLevel}, job ${bot.world.player.jobId} ${bot.world.player.jobLevel} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
      results.push({ name, bot });
    }
  }
  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/balance.md', report(results));
}, 3_600_000);

function report(results: Array<{ name: string; bot: Bot }>): string {
  const lines: string[] = [];
  lines.push(`# Balance report`, '', `${HOURS} simulated hours per job path (\`npm run balance\`). Travel is instant; times are fighting, resting and shopping.`, '');
  lines.push('## Minutes to reach base level', '');
  const marks = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  lines.push(`| Path | ${marks.join(' | ')} |`, `|---|${marks.map(() => '---:').join('|')}|`);
  for (const { name, bot } of results) lines.push(`| ${name} | ${marks.map((m) => (bot.stats.levelAt[m] !== undefined ? Math.round(bot.stats.levelAt[m]!) : '–')).join(' | ')} |`);
  lines.push('', '## Job changes (minute)', '', '| Path | First job | Second job |', '|---|---:|---:|');
  for (const { name, bot } of results) {
    const [a, b] = bot.build.path;
    const f = (v?: number) => (v === undefined ? '–' : String(Math.round(v)));
    lines.push(`| ${name} | ${f(bot.stats.jobChangeAt[a])} | ${f(bot.stats.jobChangeAt[b])} |`);
  }
  lines.push('', '## Overall', '', '| Path | Kills/min | Deaths/hour | Potions/hour | Gold earned/hour | Final level |', '|---|---:|---:|---:|---:|---|');
  for (const { name, bot } of results) {
    const h = bot.minutes / 60;
    const p = bot.world.player;
    lines.push(
      `| ${name} | ${(bot.stats.kills / bot.minutes).toFixed(1)} | ${(bot.stats.deaths / h).toFixed(1)} | ${(bot.stats.potions / h).toFixed(0)} | ${Math.round(bot.stats.goldEarned / h)} | ${p.baseLevel} / ${p.jobId} ${p.jobLevel} |`,
    );
  }
  lines.push('', '## Per area', '', '| Path | Area | Minutes | Kills/min | XP/min | Deaths/hour |', '|---|---|---:|---:|---:|---:|');
  for (const { name, bot } of results) {
    for (const a of AREAS) {
      const min = bot.stats.areaMinutes[a.label];
      if (!min || min < 1) continue;
      lines.push(`| ${name} | ${a.label} | ${Math.round(min)} | ${((bot.stats.areaKills[a.label] ?? 0) / min).toFixed(1)} | ${Math.round((bot.stats.areaXp[a.label] ?? 0) / min)} | ${(((bot.stats.areaDeaths[a.label] ?? 0) / min) * 60).toFixed(1)} |`);
    }
  }
  return lines.join('\n') + '\n';
}
