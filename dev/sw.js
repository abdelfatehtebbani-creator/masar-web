/* sw.js -- service worker لقشرة الواجهة فقط (مولَّد بواسطة tools/build_web.js؛ الإصدار يتغيّر مع كل بناء فيُحدَّث المخبَّأ).
 * يخبّئ ملفات الواجهة الثابتة (HTML/JS/الأيقونات) -- ولا يخبّئ أبدًا أي نداء للخادم (script.google.com / googleusercontent) ولا أي بيانات أعمال.
 * استراتيجية: stale-while-revalidate للقشرة، وصفحة "لا اتصال" عند فشل التنقّل بلا شبكة. */
const VERSION = '448153c94f';
const CACHE = 'masar-shell-' + VERSION;
const SHELL = ["./","index.html","masar-config.js","masar-runtime.js","manifest.webmanifest","offline.html","install.html","fonts.css","fonts/cairo-arabic.woff2","fonts/cairo-latin.woff2","fonts/cairo-latin-ext.woff2","icon-180.png","icon-192.png","icon-512.png","login.html","admin_dashboard.html","admin_settings.html","admin_users_roles.html","admin_stores_depts.html","admin_products_v2.html","admin_lists_settings.html","cashier_dashboard.html","cashier_new_order.html","cashier_new_special.html","cashier_tracking.html","cashier_receive.html","cashier_return.html","cashier_edit.html","driver_shipments.html","production_section_dashboard.html","production_supply_request.html","production_section_store_order.html","pm_quarantine.html","pm_approvals.html","pm_orders_overview.html","distribution_shifts.html","distribution_hub.html","distribution_cancel_edit_review.html","distribution_pending_orders.html","distribution_approve_order.html","distribution_receive_compare.html","distribution_prepare_shipment.html","distribution_shipments.html","distribution_loading_sheet.html","distribution_invoice.html","fgs_dashboard.html","rms_dashboard.html","rms_store_orders.html","rms_store_order_detail.html","fgs_store_orders.html","fgs_store_order_detail.html","mgmt_reports.html","vc_dashboard.html","po_dashboard.html","distribution_tracking.html","pm_overview.html","view_attachment.html","print_invoice.html","asset-82d7b1e2.png"];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('masar-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // أي نطاق آخر (الخادم/الخطوط) يمرّ مباشرة
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // التنقّل: نطابق الملف بلا معاملات الاستعلام (الصفحة نفسها ثابتة، والهوية في الرابط تُقرأ بالمتصفح)
    const key = req.mode === 'navigate' || req.destination === 'document' ? new Request(url.origin + url.pathname) : req;
    // التنقّل يُطابَق بلا معاملات الاستعلام (الهوية في الرابط)؛ الملفات الفرعية بمطابقة تامة (?v=<بصمة> تضمن عدم تقديم نسخة قديمة من masar-runtime/config بعد تحديثهما)
    const cached = await cache.match(key, { ignoreSearch: key !== req });
    const network = fetch(req).then(res => { if (res && res.ok) cache.put(key, res.clone()); return res; });
    if (cached) { network.catch(() => {}); return cached; }
    try { return await network; }
    catch (e) {
      if (req.mode === 'navigate') { const off = await cache.match('offline.html'); if (off) return off; }
      return new Response('', { status: 504 });
    }
  })());
});
