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
  function lang() { try { return (L && L.getItem('masar_lang_' + String(CFG.env || 'PROD'))) || 'ar'; } catch (e) { return 'ar'; } }

  var pageParams = {}; ['basis', 'scope', 'date', 'shipment', 'k'].forEach(function (k) { if (p(k)) pageParams[k] = String(p(k)).slice(0, 40); });
  window.MASAR_TPL = {
    appBaseUrl: base,
    currentUserId: page === 'login' ? '' : p('uid'),
    currentStoreId: p('storeId'), currentStoreName: p('storeName'), currentAssignmentId: p('assignmentId'), currentFullName: p('fullName'),
    currentOrderId: p('id'), currentTab: p('tab'), attImgId: p('img'), attAudioId: p('audio'), invoiceKind: p('kind'),
    userLang: lang(), timeoutScale: 3, pageParams: pageParams,
    testLoginEnabled: !!(CFG.env && CFG.env !== 'PROD'), // تلميح للواجهة فقط (بناء DIV)؛ الخادم هو من يسمح فعليًا
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
  // المفاتيح تحمل اسم البيئة: موقع DIV وPROD على نطاق واحد (github.io) فيتشاركان التخزين المحلي، ولا يجوز أن يمسح أحدهما رمز الآخر
  var NS = String(CFG.env || 'PROD');
  var RT_KEY = 'masar_rt_' + NS;
  function readRt() { try { var j = JSON.parse((L && L.getItem(RT_KEY)) || 'null'); return j && j.u && j.t ? j : null; } catch (e) { return null; } }
  function saveRt(u, t) { try { if (L) L.setItem(RT_KEY, JSON.stringify({ u: String(u), t: String(t) })); } catch (e) { /* تجاهل */ } }
  function clearRt() { try { if (L) L.removeItem(RT_KEY); } catch (e) { /* تجاهل */ } }
  window.MASAR_INTERNAL = { readRt: readRt };

  // ----- google.script.run عبر fetch (كل مرجع غير قابل للتعديل: with* تُرجع مُشغِّلًا جديدًا فلا تتشارك النداءات المعالجات) -----
  var expiring = false;
  // ----- تجديد الجلسة بصمت للأجهزة المتذكَّرة -----
  // الجلسة العادية تنتهي بعد ٦ ساعات كحدٍّ أقصى. إن انتهت أثناء الاستعمال وكان للجهاز رمز "تذكّرني" سارٍ: تستعيد الواجهة جلسة جديدة (resumeSession) وتُعيد النداء الفاشل مرة واحدة،
  // وتحوّل كل نداء لاحق بالمفتاح القديم إلى الجديد (الصفحات تحمل المفتاح القديم ثابتًا في CURRENT_USER_ID)؛ لا إعادة تحميل فلا يضيع عمل غير محفوظ. بلا رمز تذكّر: الدخول من جديد كما كان.
  var SK_KEY = 'masar_sk_' + NS;
  var SESSION_KEY_RE = /^[A-Za-z0-9_-]{3,40}\.[0-9a-f]{32,64}$/;
  var keyMap = {}; try { keyMap = JSON.parse((S && S.getItem(SK_KEY)) || '{}') || {}; } catch (e) { keyMap = {}; }
  function saveKeyMap() { try { if (S) S.setItem(SK_KEY, JSON.stringify(keyMap)); } catch (e) { /* تجاهل */ } }
  var renewing = null;
  function renewSession(expiredKey) {
    if (renewing) return renewing;
    var rt = readRt(); if (!rt) return Promise.resolve(null);
    renewing = rawCall('resumeSession', [rt.u, rt.t]).then(function (r) {
      renewing = null;
      if (r && r.success && r.data && r.data.sessionKey) {
        Object.keys(keyMap).forEach(function (k) { if (keyMap[k] === expiredKey) keyMap[k] = r.data.sessionKey; });
        keyMap[expiredKey] = r.data.sessionKey; saveKeyMap();
        return r.data.sessionKey;
      }
      return null;
    }, function () { renewing = null; return null; });
    return renewing;
  }
  function handleExpired(action, r) {
    if (r && r.success === false && r.error && r.error.code === 'SESSION_EXPIRED' && action !== 'login' && action !== 'logout' && page !== 'login' && !expiring) {
      expiring = true; setTimeout(toLogin, 50);
    }
    return r;
  }
  function callApi(action, args) {
    var a = args.slice();
    if (typeof a[0] === 'string' && keyMap[a[0]] && action !== 'login' && action !== 'resumeSession' && action !== 'testLogin') a[0] = keyMap[a[0]];
    return rawCall(action, a).then(function (r) {
      var expired = r && r.success === false && r.error && r.error.code === 'SESSION_EXPIRED';
      var renewable = expired && page !== 'login' && ['login', 'logout', 'resumeSession', 'testLogin'].indexOf(action) === -1 && typeof a[0] === 'string' && SESSION_KEY_RE.test(a[0]) && !!readRt();
      if (!renewable) return handleExpired(action, r);
      return renewSession(a[0]).then(function (newKey) {
        if (!newKey) return handleExpired(action, r);
        var b = a.slice(); b[0] = newKey;
        return rawCall(action, b).then(function (r2) { return handleExpired(action, r2); });
      });
    });
  }
  // ----- نقل النداءات: دُفعات القراءة (٢٠٢٦-١٠-١٠) -----
  // كل نداء إلى Apps Script يدفع كلفة ثابتة (~٣ث: بدء تنفيذ + تحويل Google). القراءات الصرفة (قائمة pureReads المولَّدة من الخادم عند البناء) التي تُصدرها الصفحة في اللحظة نفسها
  // (مثل ٨ عدّادات للشاشة الرئيسية) تُجمَع في نداء واحد `batch` (حتى ١٢)، فيُنفَّذ في تنفيذ واحد يتشارك قراءة الجداول داخله. كل عنصر يمرّ بالتحقق نفسه على الخادم وتصل نتيجته لصاحبه
  // بنفس الشكل؛ الحفظ لا يُجمَع أبدًا. إن لم يعرف الخادم `batch` (نشر أقدم) يُعطَّل التجميع ويُعاد النداء فرديًا بلا خسارة.
  var PURE = {}; (CFG.pureReads || []).forEach(function (n) { PURE[n] = 1; }); delete PURE.getChangeTokens; delete PURE.getTestLoginAccounts;
  var BATCH_KEY = 'masar_nobatch_' + NS, BATCH_WINDOW_MS = 30, BATCH_MAX = 12;
  var batchOff = false; try { batchOff = !!(S && S.getItem(BATCH_KEY)); } catch (e) { batchOff = false; }
  var queue = [], timer = null;
  function doFetch(action, body, keepalive) {
    return fetch(CFG.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, redirect: 'follow', keepalive: !!keepalive })
      .then(function (r) { if (!r.ok) throw new Error('HTTP_' + r.status); return r.text(); })
      .then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { throw new Error('BAD_RESPONSE'); } return j; });
  }
  function sendChunk(chunk) {
    if (chunk.length === 1) { doFetch(chunk[0].action, chunk[0].body).then(chunk[0].res, chunk[0].rej); return; }
    var payload = JSON.stringify({ action: 'batch', args: [chunk.map(function (c) { return { action: c.action, args: c.args }; })] });
    doFetch('batch', payload).then(function (r) {
      if (r && r.success && r.data && Array.isArray(r.data.results) && r.data.results.length === chunk.length) { chunk.forEach(function (c, i) { c.res(r.data.results[i]); }); return; }
      if (r && r.success === false && r.error && r.error.code === 'UNKNOWN_ACTION') { batchOff = true; try { if (S) S.setItem(BATCH_KEY, '1'); } catch (e) { /* تجاهل */ } }
      chunk.forEach(function (c) { doFetch(c.action, c.body).then(c.res, c.rej); }); // رجوع آمن: فرديًا
    }, function (err) { chunk.forEach(function (c) { c.rej(err); }); });
  }
  function flushQueue() { timer = null; var items = queue; queue = []; while (items.length) sendChunk(items.splice(0, BATCH_MAX)); }
  function transport(action, args, body) {
    if (action === 'logout') return doFetch(action, body, true);
    if (batchOff || !PURE[action]) return doFetch(action, body);
    return new Promise(function (res, rej) { queue.push({ action: action, args: args, body: body, res: res, rej: rej }); if (!timer) timer = setTimeout(flushQueue, BATCH_WINDOW_MS); });
  }
  function rawCall(action, args) {
    // الخروج: يُرفَق رمز الجهاز ليُنسيه الخادم، ويُمسح محليًا فورًا (لا ننتظر الردّ؛ الصفحة قد تنتقل قبله) ويُرسَل بـkeepalive كي لا يُلغى الطلب عند الانتقال
    if (action === 'logout') { var rtOut = readRt(); if (rtOut) args = [args[0], rtOut.t]; clearRt(); }
    var body = JSON.stringify({ action: action, args: args.map(function (a) { return a === undefined ? null : a; }) });
    return transport(action, args, body)
      .then(function (r) {
        if (action === 'login' && r && r.success && r.data) {
          if (args[2] === true && r.data.rememberToken) saveRt(r.data.userId, r.data.rememberToken); else clearRt();
        }
        if (action === 'testLogin') clearRt(); // جلسة الاختبار لا تُحفَظ للاستعادة إطلاقًا
        if (action === 'resumeSession' && r) {
          if (r.success && r.data && r.data.rememberToken) saveRt(r.data.userId, r.data.rememberToken);
          else if (r.error && r.error.code === 'REMEMBER_INVALID') clearRt();
        }
        if ((action === 'login' || action === 'resumeSession') && r && r.success && r.data) { try { if (r.data.language && L) L.setItem('masar_lang_' + NS, String(r.data.language).toLowerCase() === 'en' ? 'en' : 'ar'); } catch (e) { /* تجاهل */ } }
        if (action === 'setUserLanguage' && args[1] && L) { try { L.setItem('masar_lang_' + NS, String(args[1]).toLowerCase() === 'en' ? 'en' : 'ar'); } catch (e) { /* تجاهل */ } }
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

  // ----- ضغط الصور قبل الرفع (الواجهة الثابتة فقط) -----
  // صور كاميرا الهاتف ٥–١٢ ميغابايت؛ كل نداء رفع يمرّ بتحويل Google (~٣ث) فيطول الرفع على شبكة الجوال. تُصغَّر الصورة إلى ضلع أقصى ١٦٠٠px وجودة JPEG ٠٫٨٢ (تكفي لقراءتها ولطباعة صغيرة)،
  // ولا تُكبَّر الصور الأصغر، ولا يُمسّ SVG/GIF. تُرجع Promise بـ{base64, type, name}؛ عند أي فشل/عدم دعم: الملف الأصلي كما هو (لا ضرر).
  window.masarPrepareImage = function (file, opts) {
    opts = opts || {}; var maxDim = opts.maxDim || 1600, quality = opts.quality || 0.82;
    function plain() { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res({ base64: String(fr.result).split(',')[1], type: file.type, name: file.name }); }; fr.onerror = rej; fr.readAsDataURL(file); }); }
    if (!file || !/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type || '') || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return plain();
    return createImageBitmap(file).then(function (bmp) {
      var scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size < 600 * 1024) { bmp.close && bmp.close(); return plain(); }
      var c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
      return new Promise(function (res) {
        c.toBlob(function (blob) {
          if (!blob || blob.size >= file.size) { res(null); return; }
          var fr = new FileReader(); fr.onload = function () { res({ base64: String(fr.result).split(',')[1], type: 'image/jpeg', name: String(file.name || 'photo').replace(/\.[A-Za-z0-9]+$/, '') + '.jpg' }); }; fr.onerror = function () { res(null); }; fr.readAsDataURL(blob);
        }, 'image/jpeg', quality);
      }).then(function (r) { return r || plain(); });
    }).catch(function () { return plain(); });
  };

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
