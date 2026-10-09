/* masar-runtime.js -- طبقة تشغيل الواجهة الثابتة (PWA). مولَّد/منسوخ بواسطة tools/build_web.js -- لا تعدّله داخل web-dist.
 * يحلّ محل ما كانت تقدّمه Apps Script للصفحة: (١) قيم القالب (<?!= ?>) من معاملات الرابط والتخزين المحلي، (٢) google.script.run عبر fetch إلى api()،
 * (٣) بوابة الدخول (لا هوية => شاشة الدخول)، (٤) انتهاء الجلسة => شاشة الدخول، (٥) تسجيل service worker لقشرة الواجهة فقط (بلا بيانات أعمال). */
(function () {
  'use strict';
  var CFG = window.MASAR_CONFIG || {};
  var q = new URLSearchParams(location.search);
  var S = null; try { S = window.sessionStorage; } catch (e) { S = null; }
  var L = null; try { L = window.localStorage; } catch (e) { L = null; }
  var page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
  var base = location.href.split('#')[0].split('?')[0].replace(/[^\/]*$/, '');
  function p(k) { return q.has(k) ? q.get(k) : ''; }
  function lang() { try { return (L && L.getItem('masar_lang')) || 'ar'; } catch (e) { return 'ar'; } }

  var pageParams = {}; ['basis', 'scope', 'date', 'shipment', 'k'].forEach(function (k) { if (p(k)) pageParams[k] = String(p(k)).slice(0, 40); });
  window.MASAR_TPL = {
    appBaseUrl: base,
    currentUserId: page === 'login' ? '' : p('uid'),
    currentStoreId: p('storeId'), currentStoreName: p('storeName'), currentAssignmentId: p('assignmentId'), currentFullName: p('fullName'),
    currentOrderId: p('id'), currentTab: p('tab'), attImgId: p('img'), attAudioId: p('audio'), invoiceKind: p('kind'),
    userLang: lang(), timeoutScale: 3, pageParams: pageParams,
    reloadQuery: page === 'login' ? 'page=login' : location.search.slice(1).replace(/'/g, '%27')
  };

  // بوابة الدخول: أي صفحة غير الدخول بلا مفتاح جلسة => الدخول
  function toLogin() { try { location.replace(base + '?page=login'); } catch (e) { location.href = base + '?page=login'; } }
  if (page && page !== 'login' && page !== 'index' && !window.MASAR_TPL.currentUserId) { toLogin(); return; }

  // ----- google.script.run عبر fetch (كل مرجع غير قابل للتعديل: with* تُرجع مُشغِّلًا جديدًا فلا تتشارك النداءات المعالجات) -----
  var expiring = false;
  function callApi(action, args) {
    var body = JSON.stringify({ action: action, args: args.map(function (a) { return a === undefined ? null : a; }) });
    return fetch(CFG.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP_' + r.status); return r.text(); })
      .then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { throw new Error('BAD_RESPONSE'); } return j; })
      .then(function (r) {
        if (action === 'login' && r && r.success && r.data) { try { if (r.data.language && L) L.setItem('masar_lang', String(r.data.language).toLowerCase() === 'en' ? 'en' : 'ar'); } catch (e) { /* تجاهل */ } }
        if (action === 'setUserLanguage' && args[1] && L) { try { L.setItem('masar_lang', String(args[1]).toLowerCase() === 'en' ? 'en' : 'ar'); } catch (e) { /* تجاهل */ } }
        if (r && r.success === false && r.error && r.error.code === 'SESSION_EXPIRED' && action !== 'login' && action !== 'logout' && page !== 'login' && !expiring) {
          expiring = true; setTimeout(toLogin, 50);
        }
        return r;
      });
  }
  function runner(h) {
    var proxy = new Proxy({}, {
      get: function (t, prop) {
        if (prop === 'withSuccessHandler') return function (fn) { return runner({ s: fn, f: h.f, u: h.u }); };
        if (prop === 'withFailureHandler') return function (fn) { return runner({ s: h.s, f: fn, u: h.u }); };
        if (prop === 'withUserObject') return function (o) { return runner({ s: h.s, f: h.f, u: o }); };
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return function () {
          var args = Array.prototype.slice.call(arguments), s = h.s, f = h.f, u = h.u;
          callApi(prop, args).then(function (r) { if (s) s(r, u); },
            function (err) { if (f) f({ message: String(err && err.message || err) }, u); else { try { console.error(err); } catch (e) { /* تجاهل */ } } });
        };
      }
    });
    return proxy;
  }
  window.google = window.google || {};
  window.google.script = window.google.script || {};
  Object.defineProperty(window.google.script, 'run', { configurable: true, get: function () { return runner({ s: null, f: null, u: undefined }); } });

  // شريط البيئة (غير الإنتاج)
  if (CFG.env && CFG.env !== 'PROD') {
    document.addEventListener('DOMContentLoaded', function () {
      var d = document.createElement('div');
      d.textContent = CFG.env + ' · WEB';
      d.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:2147483647;background:#B23B2E;color:#fff;font:700 11px sans-serif;padding:3px 9px;border-radius:999px;pointer-events:none;opacity:.9;';
      document.body.appendChild(d);
    });
  }

  // service worker: قشرة الواجهة فقط
  if (CFG.pwa && 'serviceWorker' in navigator && location.protocol === 'https:') {
    var hadController = !!navigator.serviceWorker.controller;
    // نسخة جديدة من الواجهة فُعِّلت: لا نُعيد التحميل تلقائيًا (قد يفقد المستخدم عملًا)، نعرض زرًا صغيرًا
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showUpdate); else showUpdate();
    });
    window.addEventListener('load', function () { navigator.serviceWorker.register(base + 'sw.js').catch(function () { /* التثبيت اختياري */ }); });
  }
  function showUpdate() {
    if (document.getElementById('masarUpdateBtn') || !document.body) return;
    var b = document.createElement('button');
    b.id = 'masarUpdateBtn'; b.type = 'button';
    b.textContent = lang() === 'en' ? '🔄 App updated — tap to reload' : '🔄 تحديث جديد للتطبيق — اضغط لإعادة التحميل';
    b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:2147483200;border:none;border-radius:999px;padding:11px 20px;background:#EE7126;color:#fff;font:700 14px sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3);cursor:pointer;';
    b.addEventListener('click', function () { location.reload(); });
    document.body.appendChild(b);
  }
})();
