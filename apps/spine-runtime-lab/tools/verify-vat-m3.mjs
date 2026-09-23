import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const edgePath = process.env.EDGE_PATH
  ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const argumentsWithoutFlags = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
const shouldExport = process.argv.includes('--export');
const socketName = process.argv.find((argument) => argument.startsWith('--socket='))?.slice('--socket='.length) ?? null;
const pageUrl = argumentsWithoutFlags[0]
  ?? 'http://127.0.0.1:18089/?vat2=1&count=20&pma=straight&analyzeFps=30&independent=1';
const artifactDir = resolve(argumentsWithoutFlags[1] ?? 'artifacts/vat-m3');
const debuggingPort = 19223;
const profileDir = mkdtempSync(join(tmpdir(), 'spine-vat-m3-'));
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

let edge;
let socket;
let nextId = 1;
const pending = new Map();
const consoleErrors = [];

async function connectCdp() {
  const deadline = Date.now() + 15_000;
  let targets;
  while (Date.now() < deadline) {
    try {
      targets = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`).then((response) => response.json());
      if (targets.some((target) => target.type === 'page')) break;
    } catch {
      // Edge has not opened the DevTools endpoint yet.
    }
    await delay(100);
  }
  const target = targets?.find((candidate) => candidate.type === 'page');
  if (!target) throw new Error('Edge CDP target did not become ready');

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(message.params.exceptionDetails.text);
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    }
  });
}

function cdp(method, params = {}) {
  const id = nextId++;
  return new Promise((resolveRequest, rejectRequest) => {
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitForVat() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const state = await evaluate(`({
      ready: window.__SPINE_VAT_V2_READY__ ?? null,
      error: window.__SPINE_VAT_V2_ERROR__ ?? null
    })`);
    if (state.error) throw new Error(state.error);
    if (state.ready) return state.ready;
    await delay(250);
  }
  throw new Error('VAT v2 did not become ready within 120 seconds');
}

function verify(result) {
  const failures = [];
  if (result.ready.instances !== 20) failures.push(`expected 20 instances, got ${result.ready.instances}`);
  if (result.ready.drawGroups !== 4) failures.push(`expected 4 lanes, got ${result.ready.drawGroups}`);
  if (result.metrics.instances !== 80) failures.push(`expected 80 GPU instances, got ${result.metrics.instances}`);
  if (result.metrics.drawCalls !== 8) failures.push(`expected 8 draw calls, got ${result.metrics.drawCalls}`);
  if (new Set(result.before.map((state) => state.clip)).size < 3) failures.push('instances do not cover three clips');
  if (new Set(result.before.map((state) => state.frame)).size < 5) failures.push('instance phases are not visibly independent');
  const paused = result.before.map((state, index) => ({ state, index })).filter(({ state }) => state.paused);
  if (paused.length < 2) failures.push('demo does not include paused instances');
  for (const { index } of paused) {
    if (result.before[index].frame !== result.after[index].frame) failures.push(`paused instance ${index} advanced`);
  }
  const moving = result.before.map((state, index) => ({ state, index })).filter(({ state }) => !state.paused);
  if (!moving.some(({ index }) => result.before[index].frame !== result.after[index].frame)) {
    failures.push('playing instances did not advance');
  }
  if (socketName) {
    if (!Array.isArray(result.beforeSocket) || result.beforeSocket.length !== 6) {
      failures.push(`socket ${socketName} did not return a 2D affine matrix`);
    } else if (result.beforeSocket.every((value, index) => value === result.afterSocket?.[index])) {
      failures.push(`socket ${socketName} did not move with the animation`);
    }
  }
  if (result.consoleErrors.length > 0) failures.push(`browser errors: ${result.consoleErrors.join(' | ')}`);
  if (failures.length > 0) throw new Error(failures.join('\n'));
}

try {
  edge = spawn(edgePath, [
    '--headless=new',
    '--disable-gpu-sandbox',
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,720',
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  await connectCdp();
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Page.navigate', { url: pageUrl });
  const ready = await waitForVat();
  const exported = shouldExport
    ? await evaluate('window.__SPINE_VAT_V2_EXPORT__()')
    : null;
  await delay(6_000);
  const before = await evaluate('window.__SPINE_VAT_V2_STATES__()');
  const beforeSocket = socketName
    ? await evaluate(`window.__SPINE_VAT_V2_SOCKET__(1, ${JSON.stringify(socketName)})`)
    : null;
  await delay(500);
  const after = await evaluate('window.__SPINE_VAT_V2_STATES__()');
  const afterSocket = socketName
    ? await evaluate(`window.__SPINE_VAT_V2_SOCKET__(1, ${JSON.stringify(socketName)})`)
    : null;
  const metrics = await evaluate('window.__SPINE_LAB_METRICS__');
  const gpu = await evaluate(`(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    if (!gl) return null;
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    };
  })()`);
  mkdirSync(artifactDir, { recursive: true });
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(artifactDir, 'independent-20.png'), Buffer.from(screenshot.data, 'base64'));
  const result = {
    pageUrl,
    ready,
    metrics,
    gpu,
    exported,
    before,
    after,
    socketName,
    beforeSocket,
    afterSocket,
    consoleErrors,
  };
  verify(result);
  writeFileSync(join(artifactDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    pass: true,
    ready,
    metrics,
    gpu,
    exported,
    pausedInstances: before.filter((state) => state.paused).length,
    distinctClips: new Set(before.map((state) => state.clip)).size,
    distinctFrames: new Set(before.map((state) => state.frame)).size,
    screenshot: join(artifactDir, 'independent-20.png'),
  }, null, 2));
} finally {
  try {
    if (socket?.readyState === WebSocket.OPEN) await cdp('Browser.close');
  } catch {
    edge?.kill();
  }
  socket?.close();
  edge?.kill();
  await delay(500);
  try {
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.warn(`[VatM3] temporary Edge profile cleanup deferred: ${String(error)}`);
  }
}
