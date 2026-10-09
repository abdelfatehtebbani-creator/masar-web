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
  if (page && page !== 'login' && page !== 'index' && page !== 'install' && !window.MASAR_TPL.currentUserId) { toLogin(); return; }

  // ----- iPhone / iPad -----
  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = !!(window.navigator.standalone) || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  if (isIOS) {
    // iOS يكبّر الصفحة تلقائيًا عند التركيز على حقل خطه أصغر من ١٦px؛ نمنع ذلك دون تغيير تخطيط أي حقل
    document.addEventListener('DOMContentLoaded', function () {
      var vp = document.querySelector('meta[name=viewport]');
      if (vp && !/maximum-scale/.test(vp.content)) vp.setAttribute('content', vp.content + ', maximum-scale=1');
    });
  }

  // ----- "تذكّرني على هذا الجهاز" (رمز استعادة، لا كلمة مرور ولا مفتاح جلسة) -----
  // يحفظ الجهاز {userId, rememberToken} فقط إن اختار المستخدم ذلك عند الدخول. عند فتح التطبيق بلا جلسة يستدعي resumeSession فيتحقق الخادم من الرمز (لا يكفي المعرّف) وينشئ جلسة عادية
  // جديدة ويدوّر الرمز. بلا الخيار لا يبقى شيء بعد إغلاق التطبيق (مفتاح الجلسة في رابط الصفحة فقط). الخروج يمسح الرمز محليًا ويُنسي الجهاز في الخادم.
  var RT_KEY = 'masar_rt';
  function readRt() { try { var j = JSON.parse((L && L.getItem(RT_KEY)) || 'null'); return j && j.u && j.t ? j : null; } catch (e) { return null; } }
  function saveRt(u, t) { try { if (L) L.setItem(RT_KEY, JSON.stringify({ u: String(u), t: String(t) })); } catch (e) { /* تجاهل */ } }
  function clearRt() { try { if (L) L.removeItem(RT_KEY); } catch (e) { /* تجاهل */ } }
  window.MASAR_INTERNAL = { readRt: readRt };

  // ----- google.script.run عبر fetch (كل مرجع غير قابل للتعديل: with* تُرجع مُشغِّلًا جديدًا فلا تتشارك النداءات المعالجات) -----
  var expiring = false;
  function callApi(action, args) {
    // الخروج: يُرفَق رمز الجهاز ليُنسيه الخادم، ويُمسح محليًا فورًا (لا ننتظر الردّ؛ الصفحة قد تنتقل قبله) ويُرسَل بـkeepalive كي لا يُلغى الطلب عند الانتقال
    if (action === 'logout') { var rtOut = readRt(); if (rtOut) args = [args[0], rtOut.t]; clearRt(); }
    var body = JSON.stringify({ action: action, args: args.map(function (a) { return a === undefined ? null : a; }) });
    return fetch(CFG.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, redirect: 'follow', keepalive: action === 'logout' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP_' + r.status); return r.text(); })
      .then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { throw new Error('BAD_RESPONSE'); } return j; })
      .then(function (r) {
        if (action === 'login' && r && r.success && r.data) {
          if (args[2] === true && r.data.rememberToken) saveRt(r.data.userId, r.data.rememberToken); else clearRt();
        }
        if (action === 'resumeSession' && r) {
          if (r.success && r.data && r.data.rememberToken) saveRt(r.data.userId, r.data.rememberToken);
          else if (r.error && r.error.code === 'REMEMBER_INVALID') clearRt();
        }
        if ((action === 'login' || action === 'resumeSession') && r && r.success && r.data) { try { if (r.data.language && L) L.setItem('masar_lang', String(r.data.language).toLowerCase() === 'en' ? 'en' : 'ar'); } catch (e) { /* تجاهل */ } }
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

  if (page === 'login' && CFG.resume !== false && !q.has('noresume') && readRt()) {
    document.addEventListener('DOMContentLoaded', function () {
      var rt = readRt(); if (!rt) return;
      var ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:2147483100;background:#3D2B1E;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;font:700 17px sans-serif;text-align:center;padding:24px;';
      var t = document.createElement('div'); t.textContent = lang() === 'en' ? 'Restoring your session…' : 'جارٍ استعادة جلستك…';
      var b = document.createElement('button'); b.type = 'button';
      b.textContent = lang() === 'en' ? 'Sign in as someone else' : 'تسجيل الدخول بحساب آخر';
      b.style.cssText = 'border:1px solid rgba(255,255,255,.5);background:transparent;color:#fff;font:600 14px sans-serif;padding:10px 22px;border-radius:999px;cursor:pointer;';
      var cancelled = false;
      b.addEventListener('click', function () { cancelled = true; ov.remove(); });
      ov.appendChild(t); ov.appendChild(b); document.body.appendChild(ov);
      callApi('resumeSession', [rt.u, rt.t]).then(function (r) {
        if (cancelled) return;
        if (r && r.success && r.data && typeof window.masarResumeLogin === 'function') { ov.remove(); window.masarResumeLogin(r.data); }
        else ov.remove();
      }, function () { ov.remove(); });
    });
  }
  if (page === 'login' && isIOS && !standalone) {
    document.addEventListener('DOMContentLoaded', function () {
      try { if (L && L.getItem('masar_ios_hint')) return; } catch (e) { /* تجاهل */ }
      var h = document.createElement('div');
      h.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;background:#fff;color:#3D2B1E;border:1px solid #e3d6c8;border-radius:14px;padding:12px 14px;font:600 13px/1.6 sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.18);text-align:center;';
      h.innerHTML = (lang() === 'en' ? 'To install: tap <b>Share</b> then <b>Add to Home Screen</b>.' : 'لتثبيت التطبيق: اضغط <b>مشاركة</b> (⬆️) ثم <b>إضافة إلى الشاشة الرئيسية</b>.') + ' <button type="button" style="border:none;background:#EE7126;color:#fff;border-radius:999px;padding:4px 14px;font:700 12px sans-serif;margin-inline-start:6px;cursor:pointer;">OK</button>';
      h.querySelector('button').addEventListener('click', function () { try { if (L) L.setItem('masar_ios_hint', '1'); } catch (e) { /* تجاهل */ } h.remove(); });
      document.body.appendChild(h);
    });
  }

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
