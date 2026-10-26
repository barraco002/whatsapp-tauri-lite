/*
 * notification_guard.js
 *
 * Limite de notificaciones para WhatsApp Web dentro de WebView2.
 *
 * Motivo (incidente 2026-10-24): WhatsApp Web emite una notificacion del sistema por
 * cada mensaje entrante. En una rafaga (un chat activo, un grupo, una resincronizacion
 * tras vincular un dispositivo) Windows encadena decenas de toasts, la barra de tareas
 * parpadea y la composicion del WebView2 repinta la pantalla entera en cada uno.
 *
 * Este script se inyecta ANTES que el codigo de la pagina y cubre las dos vias por las
 * que una web puede crear un toast:
 *   - window.Notification
 *   - ServiceWorkerRegistration.prototype.showNotification
 *
 * Reglas:
 *   - permite un toast por chat cada CHAT_WINDOW_MS,
 *   - limita el total a GLOBAL_MAX toasts por minuto,
 *   - agrupa los mensajes suprimidos en un unico aviso ("N mensajes nuevos"),
 *   - y si algo falla deja la API nativa intacta.
 *
 * No lee, guarda ni envia contenido: solo cuenta y retrasa.
 */
(function () {
  'use strict';
  try {
    if (window.__waTauriNotifyGuard) return;
    var Native = window.Notification;
    var swProto = window.ServiceWorkerRegistration && window.ServiceWorkerRegistration.prototype;
    var nativeShowNotification = swProto && typeof swProto.showNotification === 'function'
      ? swProto.showNotification
      : null;
    if (typeof Native !== 'function' && !nativeShowNotification) return;

    var CHAT_WINDOW_MS = 5000;
    var GLOBAL_WINDOW_MS = 60000;
    var GLOBAL_MAX = 6;
    var MAX_PENDING = 999;

    var chats = Object.create(null);
    var globalShown = [];
    var state = { shown: 0, suppressed: 0, grouped: 0 };

    window.__waTauriNotifyGuard = true;
    window.__waTauriNotifyGuardState = state;

    function now() {
      return Date.now();
    }

    function chatKey(title, tag) {
      if (tag) return 'tag:' + tag;
      return 'title:' + String(title || '');
    }

    function prune(t) {
      while (globalShown.length && t - globalShown[0] >= GLOBAL_WINDOW_MS) {
        globalShown.shift();
      }
    }

    function nativeEmit(title, options) {
      return new Native(title, options);
    }

    function deliver(title, options, emit) {
      globalShown.push(now());
      state.shown += 1;
      try {
        return (emit || nativeEmit)(title, options);
      } catch (e) {
        return null;
      }
    }

    function flush(key) {
      var st = chats[key];
      if (!st) return;
      st.timer = null;
      var t = now();
      prune(t);
      if (globalShown.length >= GLOBAL_MAX) {
        st.timer = setTimeout(function () { flush(key); }, Math.ceil(GLOBAL_WINDOW_MS / 6));
        return;
      }
      var pending = st.pending;
      st.pending = 0;
      if (!pending) return;
      var body = st.body;
      if (pending > 1) {
        body = pending + ' mensajes nuevos' + (body ? ' - ' + body : '');
        state.grouped += 1;
      }
      st.lastShown = t;
      deliver(st.title, {
        body: body,
        icon: st.icon,
        tag: st.tag,
        renotify: false
      }, st.emit);
    }

    /* Decide si un aviso sale ahora (true) o queda agrupado para el siguiente turno. */
    function admit(title, options, emit) {
      options = options || {};
      var t = now();
      var key = chatKey(title, options.tag);
      var st = chats[key];
      if (!st) {
        st = chats[key] = {
          lastShown: 0,
          pending: 0,
          timer: null,
          title: title,
          body: options.body || '',
          icon: options.icon,
          tag: options.tag || key,
          emit: emit
        };
      }
      st.title = title;
      st.emit = emit;
      if (options.body) st.body = options.body;
      if (options.icon) st.icon = options.icon;

      prune(t);
      var quiet = (t - st.lastShown) < CHAT_WINDOW_MS;
      var budget = globalShown.length < GLOBAL_MAX;

      if (!quiet && budget && !st.timer) {
        st.lastShown = t;
        var value = deliver(title, {
          body: options.body,
          icon: options.icon,
          tag: st.tag,
          renotify: false
        }, emit);
        return { shown: true, value: value };
      }

      st.pending = Math.min(MAX_PENDING, st.pending + 1);
      state.suppressed += 1;
      if (!st.timer) {
        var wait = Math.max(500, CHAT_WINDOW_MS - (t - st.lastShown));
        st.timer = setTimeout(function () { flush(key); }, wait);
      }
      return { shown: false, value: null };
    }

    function StubNotification(title, options) {
      this.title = title;
      this.body = (options && options.body) || '';
      this.tag = (options && options.tag) || '';
      this.silent = true;
    }
    StubNotification.prototype.close = function () {};
    StubNotification.prototype.addEventListener = function () {};
    StubNotification.prototype.removeEventListener = function () {};

    function Guarded(title, options) {
      var result = admit(title, options, nativeEmit);
      if (result.shown && result.value) return result.value;
      return new StubNotification(title, options);
    }

    Guarded.prototype = Native.prototype;
    Object.defineProperty(Guarded, 'permission', {
      get: function () { return Native.permission; },
      configurable: true
    });
    Guarded.requestPermission = function (callback) {
      try {
        return Native.requestPermission(callback);
      } catch (e) {
        if (typeof callback === 'function') callback('granted');
        return Promise.resolve('granted');
      }
    };
    if ('maxActions' in Native) {
      Object.defineProperty(Guarded, 'maxActions', {
        get: function () { return Native.maxActions; },
        configurable: true
      });
    }

    window.Notification = Guarded;

    if (nativeShowNotification) {
      swProto.showNotification = function (title, options) {
        var registration = this;
        try {
          var result = admit(title, options, function (t, o) {
            return nativeShowNotification.call(registration, t, o);
          });
          if (result.shown) return result.value;
          return Promise.resolve();
        } catch (e) {
          return nativeShowNotification.call(registration, title, options);
        }
      };
    }
  } catch (e) {
    /* ante cualquier fallo, WhatsApp conserva la API nativa */
  }
})();
