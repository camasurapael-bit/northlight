/* Applies the saved colour theme before first paint (no flash), or follows the phone's light/dark setting. */
(function () {
  var KEY = 'northlight.prefs.v1', root = document.documentElement, mq = null;
  function saved() { try { return (JSON.parse(localStorage.getItem(KEY) || '{}') || {}).theme || ''; } catch (e) { return ''; } }
  function system() { return mq && mq.matches ? 'light' : 'dark'; }
  try { mq = window.matchMedia('(prefers-color-scheme: light)'); } catch (e) {}
  function apply() {
    var t = saved() || system();
    root.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'light' ? '#f5f6fb' : '#0b0d14');
  }
  apply();
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (!saved()) apply(); });
  else if (mq && mq.addListener) mq.addListener(function () { if (!saved()) apply(); });
  window.NSTheme = { apply: apply };
})();
