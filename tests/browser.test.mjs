import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function waitForJson(url, timeout = 15000) {
  const expires = Date.now() + timeout;
  while (Date.now() < expires) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await delay(100);
  }
  throw new Error(`Chrome DevTools не ответил: ${url}`);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  async reload(ignoreCache = true) {
    await this.send('Page.reload', { ignoreCache });
    for (let i = 0; i < 100; i += 1) {
      await delay(50);
      try {
        if ((await this.evaluate('document.readyState')) === 'complete') return;
      } catch {}
    }
    throw new Error('Страница не загрузилась после reload');
  }

  close() {
    this.socket?.close();
  }

  closeBrowser() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ id: ++this.id, method: 'Browser.close', params: {} }));
    }
  }
}

function startServer() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const target = path.resolve(root, relative);
    if (!target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(target).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('критические браузерные сценарии', { timeout: 45000 }, async (context) => {
  const chrome = findChrome();
  if (!chrome) {
    context.skip('Chrome/Chromium не найден; задайте CHROME_PATH');
    return;
  }

  const server = await startServer();
  const address = server.address();
  const appUrl = `http://127.0.0.1:${address.port}/`;
  const debugPort = 9300 + Math.floor(Math.random() * 300);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'safety-alias-test-'));
  const browser = spawn(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-gpu-compositing',
      '--disable-gpu-shader-disk-cache',
      '--in-process-gpu',
      '--disable-breakpad',
      '--disable-dev-shm-usage',
      '--disable-features=Vulkan,WebGPU,SkiaGraphite,DawnGraphite,CanvasOopRasterization,Accelerated2dCanvas',
      '--no-first-run',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
  );
  let browserErrors = '';
  browser.stderr.on('data', (chunk) => { browserErrors += chunk.toString(); });

  let client;
  try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const targetResponse = await fetch(
      `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(appUrl)}`,
      { method: 'PUT' },
    );
    const target = await targetResponse.json();
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Page.enable');
    await client.send('Network.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await client.reload();
    await delay(1000);

    const reset = async () => {
      await client.evaluate("localStorage.clear(); caches.keys().then(keys=>Promise.all(keys.map(key=>caches.delete(key))))");
      await client.reload();
      await delay(500);
    };
    const beginGame = async () => {
      await client.evaluate(`
        document.querySelector('[data-go="topics"]').click();
        document.querySelector('[data-go="setup"]').click();
        document.querySelectorAll('.teamname')[0].value='Альфа';
        document.querySelectorAll('.teamname')[1].value='Бета';
        document.getElementById('duration').value='30';
        document.getElementById('rounds').value='1';
        document.getElementById('start').click();
        document.getElementById('begin').click();
      `);
    };

    await reset();
    const teamLimit = await client.evaluate(`(() => {
      document.querySelector('[data-go="topics"]').click();
      document.querySelector('[data-go="setup"]').click();
      for(let i=0;i<10;i++) document.getElementById('plus').click();
      return {
        count:Number(document.getElementById('teamCount').textContent),
        inputs:document.querySelectorAll('.teamname').length,
        plusDisabled:document.getElementById('plus').disabled,
      };
    })()`);
    assert.deepEqual(teamLimit, { count: 8, inputs: 8, plusDisabled: true });

    await reset();
    await beginGame();
    await client.evaluate("deadline=Date.now()+1200; tick()");
    await delay(1800);
    assert.deepEqual(
      await client.evaluate("({screen:activePage,score:scores[0],remaining})"),
      { screen: 'roundEnd', score: 0, remaining: 0 },
      'Раунд должен завершаться по абсолютному deadline',
    );

    await reset();
    await beginGame();
    await client.evaluate("deadline=Date.now()+5000; document.getElementById('correct').click()");
    const beforeReload = await client.evaluate("({term:current.term,points:roundPoints})");
    await client.reload();
    await delay(400);
    const afterReload = await client.evaluate("({screen:activePage,term:current.term,points:roundPoints,remaining})");
    assert.equal(afterReload.screen, 'play');
    assert.equal(afterReload.term, beforeReload.term);
    assert.equal(afterReload.points, 1);
    assert.ok(afterReload.remaining > 0 && afterReload.remaining <= 5);

    await client.evaluate("document.getElementById('pause').click()");
    const pausedRemaining = await client.evaluate('remaining');
    await delay(1300);
    assert.equal(await client.evaluate('remaining'), pausedRemaining, 'Пауза не должна расходовать время');
    await client.evaluate("document.getElementById('resume').click()");

    await client.evaluate("roundPoints=2; scores[0]=0; roundEnding=false; endRound(); endRound()");
    assert.equal(await client.evaluate('scores[0]'), 2, 'Повторный endRound не должен удваивать счёт');

    const sequence = await client.evaluate(`(() => {
      chosen=new Set(['everyday']); used.clear(); lastCardIndex=-1; roundEnding=false;
      const values=[]; for(let i=0;i<12;i++){newCard(); values.push(lastCardIndex)} return values;
    })()`);
    assert.ok(sequence.every((value, index) => index === 0 || value !== sequence[index - 1]));

    await reset();
    await client.evaluate(`
      document.querySelector('[data-go="topics"]').click();
      document.querySelector('[data-go="setup"]').click();
      document.getElementById('duration').value='30';
      document.getElementById('rounds').value='1';
      document.getElementById('eventsEnabled').checked=true;
      document.getElementById('eventsEnabled').dispatchEvent(new Event('change'));
      document.getElementById('start').click();
      activeEvent=createRoundEvent('last_push'); eventPreparedTurn=turn; renderReadyEvent();
      document.getElementById('begin').click();
      remaining=10; document.getElementById('correct').click();
    `);
    assert.deepEqual(
      await client.evaluate("({points:roundPoints,event:activeEvent.id,correct:activeEvent.state.correctCount})"),
      { points: 2, event: 'last_push', correct: 1 },
    );
    const eventTerm = await client.evaluate('history[0].term');
    await client.reload();
    await delay(400);
    assert.deepEqual(
      await client.evaluate("({screen:activePage,event:activeEvent.id,correct:activeEvent.state.correctCount,archive:roundArchive.length})"),
      { screen: 'play', event: 'last_push', correct: 1, archive: 0 },
    );
    await client.evaluate('roundEnding=false; endRound()');
    assert.deepEqual(
      await client.evaluate("({score:scores[0],archive:roundArchive.length,reviewDisabled:document.getElementById('reviewCards').disabled})"),
      { score: 2, archive: 1, reviewDisabled: false },
    );
    await client.evaluate("document.getElementById('reviewCards').click()");
    assert.deepEqual(
      await client.evaluate("({screen:activePage,term:document.getElementById('reviewTerm').textContent,status:document.getElementById('reviewAnswerStatus').textContent,definition:document.getElementById('reviewDefinition').textContent})"),
      { screen: 'reviewScreen', term: eventTerm, status: '✓ Угадано', definition: 'Пояснение готовится' },
    );
    await client.reload();
    await delay(400);
    assert.deepEqual(
      await client.evaluate("({screen:activePage,archive:roundArchive.length,term:document.getElementById('reviewTerm').textContent})"),
      { screen: 'reviewScreen', archive: 1, term: eventTerm },
    );

    await client.evaluate('navigator.serviceWorker.ready.then(()=>true)');
    if (!(await client.evaluate('Boolean(navigator.serviceWorker.controller)'))) await client.reload(false);
    await delay(500);
    assert.equal(await client.evaluate('Boolean(navigator.serviceWorker.controller)'), true);
    assert.equal(await client.evaluate('caches.match(location.href).then(Boolean)'), true);
    await client.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    await client.reload(false);
    assert.equal(await client.evaluate('document.title'), 'Безопасный ALIAS');
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(error?.message || String(error));
    if (browserErrors.trim()) failure.message += `\nChrome stderr:\n${browserErrors.slice(-4000)}`;
    throw failure;
  } finally {
    try { client?.closeBrowser(); } catch {}
    await delay(200);
    client?.close();
    browser.kill('SIGKILL');
    browser.stderr.destroy();
    browser.unref();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await delay(200);
    if (profile.startsWith(`${os.tmpdir()}${path.sep}safety-alias-test-`)) {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
});
