/**
 * Verificare de compatibilitate inainte de a incarca modulele.
 * WebView-ul Android trebuie sa suporte import maps (Chrome 89+) si WebGL.
 * Daca ceva lipseste, anuntam nativ ca sa apara un mesaj natural, nu o pagina alba.
 */
(function () {
  function fail(reason) {
    try {
      if (window.NexusNative && window.NexusNative.avatarFailed) {
        window.NexusNative.avatarFailed(reason);
      }
    } catch (e) { /* ignora */ }
    var el = document.getElementById('loader-text');
    if (el) el.textContent = 'Nexus nu poate porni scena 3D pe acest dispozitiv.';
  }

  var importMapOk = typeof HTMLScriptElement !== 'undefined' &&
    typeof HTMLScriptElement.supports === 'function'
    ? HTMLScriptElement.supports('importmap')
    : true; // browsere vechi fara .supports: lasam modulul sa incerce

  if (!importMapOk) {
    fail('import maps nesuportate (actualizeaza Android System WebView)');
    return;
  }

  try {
    var c = document.createElement('canvas');
    var gl = c.getContext('webgl2') || c.getContext('webgl') ||
      c.getContext('experimental-webgl');
    if (!gl) fail('WebGL indisponibil');
  } catch (e) {
    fail('WebGL indisponibil');
  }
})();
