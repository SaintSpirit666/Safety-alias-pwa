import { spawnSync } from 'node:child_process';

const args = ['--test', 'tests/browser.test.mjs'];
for (let attempt = 1; attempt <= 2; attempt += 1) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status === 0) process.exit(0);
  if (attempt === 1) {
    console.warn('Headless Chrome завершился с ошибкой; повторяем браузерный тест один раз.');
  } else {
    process.exit(result.status || 1);
  }
}
