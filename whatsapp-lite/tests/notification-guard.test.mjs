import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(here, '..', 'src-tauri', 'src', 'notification_guard.js'),
  'utf8',
);

function createEnv() {
  const calls = [];
  const swCalls = [];
  let clock = 1_000_000;

  function FakeNotification(title, options) {
    this.title = title;
    this.options = options || {};
    calls.push({ title, options: options || {} });
  }
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission = () => Promise.resolve('granted');
  FakeNotification.prototype.close = function () {};

  function FakeRegistration() {}
  FakeRegistration.prototype.showNotification = function (title, options) {
    swCalls.push({ title, options: options || {} });
    return Promise.resolve();
  };

  const timers = new Map();
  let nextId = 1;

  const context = {
    window: { Notification: FakeNotification, ServiceWorkerRegistration: FakeRegistration },
    Promise,
    Date: { now: () => clock },
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, at: clock + (ms || 0) });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  return {
    window: context.window,
    registration: new context.window.ServiceWorkerRegistration(),
    calls,
    swCalls,
    advance(ms) {
      clock += ms;
      for (let guard = 0; guard < 1000; guard += 1) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= clock);
        if (due.length === 0) break;
        for (const [id, timer] of due) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
  };
}

test('un chat activo no inunda: un aviso y el resto se agrupa', () => {
  const env = createEnv();
  const Guarded = env.window.Notification;

  for (let i = 0; i < 50; i += 1) {
    new Guarded('Francisca', { body: 'mensaje ' + i, tag: 'chat-1' });
  }

  assert.equal(env.calls.length, 1, 'solo el primero debe mostrarse');
  assert.equal(env.window.__waTauriNotifyGuardState.suppressed, 49);

  env.advance(5000);
  assert.equal(env.calls.length, 2, 'la agrupacion debe salir al cerrar la ventana');
  assert.match(env.calls[1].options.body, /49 mensajes nuevos/);
});

test('chats distintos conservan su propio aviso', () => {
  const env = createEnv();
  const Guarded = env.window.Notification;

  new Guarded('Ana', { body: 'a', tag: 'ana' });
  new Guarded('Luis', { body: 'l', tag: 'luis' });

  assert.equal(env.calls.length, 2);
  assert.deepEqual(env.calls.map((call) => call.title), ['Ana', 'Luis']);
});

test('el presupuesto global corta la rafaga entre chats', () => {
  const env = createEnv();
  const Guarded = env.window.Notification;

  for (let i = 0; i < 12; i += 1) {
    new Guarded('Chat ' + i, { body: 'x', tag: 'c' + i });
  }

  assert.equal(env.calls.length, 6, 'no debe pasar de GLOBAL_MAX por minuto');
});

test('la API estatica sigue delegando en la nativa', async () => {
  const env = createEnv();
  const Guarded = env.window.Notification;

  assert.equal(Guarded.permission, 'granted');
  assert.equal(await Guarded.requestPermission(), 'granted');
});

test('sin API nativa la pagina sigue funcionando', () => {
  const context = {
    window: {},
    Promise,
    Date: { now: () => 0 },
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);

  assert.doesNotThrow(() => vm.runInContext(source, context));
  assert.equal(context.window.Notification, undefined);
});

test('el service worker tampoco puede inundar la pantalla', async () => {
  const env = createEnv();

  for (let i = 0; i < 12; i += 1) {
    await env.registration.showNotification('Chat ' + i, { body: 'x', tag: 'sw' + i });
  }

  assert.equal(env.swCalls.length, 6, 'el service worker respeta GLOBAL_MAX');
  assert.equal(env.calls.length, 0, 'no debe tocar la API de ventana');
});

test('el service worker agrupa el backlog de un solo chat', async () => {
  const env = createEnv();

  for (let i = 0; i < 30; i += 1) {
    await env.registration.showNotification('Francisca', { body: 'm' + i, tag: 'chat-1' });
  }

  assert.equal(env.swCalls.length, 1);

  env.advance(5000);
  assert.equal(env.swCalls.length, 2);
  assert.match(env.swCalls[1].options.body, /29 mensajes nuevos/);
});
