// Plataforma "iPhone": la app es la misma de la tablet y de Android, pero aquí vive como app web instalada en el iPhone
// (Safari › Compartir › «Agregar a pantalla de inicio»). Todo se guarda EN el iPhone y no hace falta red ni servidor:
//  - IndexedDB, base "pableque-z": el estado completo en cada guardado + una copia por hora (se quedan las últimas 200);
//  - localStorage: segunda copia del estado (si una falla, la otra rescata);
//  - respaldo cifrado .pzb (mismo formato que Android: herramientas/descifrar_respaldo_android.py lo abre) y su importación;
//  - sin planilla (no se ofrece 'mcp') y sin Ragnar dentro de la app (no se ofrece 'sample'): "Ragnar te atiende por Telegram".
(function () {
  'use strict';
  const err = (code, message) => Object.assign(new Error(message), { code });
  const NOMBRE_DB = 'pableque-z', TIENDAS = ['estado', 'copias', 'ajustes', 'previos'];
  // El aviso de respaldo sale a los 3 días sin exportar (antes 7: con los datos solo en el iPhone, mejor no esperar tanto).
  const MAX_BYTES = 2 * 1024 * 1024, MAX_COPIAS = 200, MAX_PREVIOS = 5, SIETE_DIAS = 3 * 24 * 3600 * 1000;
  // Mismas claves que estado_valido de servidor_finanzas.py y que Almacen.kt (la prueba pruebas/test_iphone.py las compara).
  const CLAVES = ['ts', 'base', 'banco', 'pago', 'sueldo', 'items', 'depto', 'movs', 'bonos', 'extras', 'd0', 'mezcla',
    'mes', 'version', 'historial', 'reparto', 'bandeja', 'sueldoRecibido', 'extrasMes'];
  const estadoValido = o => !!o && typeof o === 'object' && !Array.isArray(o) &&
    Object.keys(o).every(k => CLAVES.includes(k)) &&
    (o.items === undefined || Array.isArray(o.items)) && (o.movs === undefined || Array.isArray(o.movs));
  const bytesDe = t => new TextEncoder().encode(t).length;
  const ls = (f) => { try { return f(window.localStorage); } catch (e) { return null; } };

  const E = { cargado: false, hayDatos: false, ultimo: null, desde: null, frase: null, lecturaFallida: false, texto: null, persistente: null, pedido: false };
  // El teclado del iPhone cambia comillas y guiones por sus versiones "bonitas": se vuelven a las simples
  // para que la frase escrita en el iPhone sea la misma que en la tablet o el PC.
  const limpiarFrase = f => String(f == null ? '' : f)
    .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/ /g, ' ');

  // Pide que iOS no borre los datos de la app cuando falte espacio (si no lo concede o falla, no pasa nada).
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(ok => { E.persistente = !!ok; }, () => {});
    }
  } catch (e) { /* se ignora */ }

  // ---------- IndexedDB ----------
  let dbp = null;
  function abrirDB() {
    if (dbp) return dbp;
    dbp = new Promise((ok, mal) => {
      if (!window.indexedDB) return mal(new Error('sin IndexedDB'));
      let r;
      try { r = indexedDB.open(NOMBRE_DB, 1); } catch (e) { return mal(e); }
      r.onupgradeneeded = () => { const d = r.result; TIENDAS.forEach(n => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n); }); };
      r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); dbp = null; }; ok(d); };
      r.onerror = () => mal(r.error || new Error('no abrió'));
      r.onblocked = () => mal(new Error('bloqueada'));
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }
  // Corre una transacción y devuelve lo que deje `fn` (se resuelve cuando la transacción TERMINÓ de escribir).
  async function transaccion(tiendas, modo, fn) {
    const d = await abrirDB();
    return new Promise((ok, mal) => {
      let t, res;
      try { t = d.transaction(tiendas, modo); } catch (e) { return mal(e); }
      t.oncomplete = () => ok(res && typeof res === 'object' && 'valor' in res ? res.valor : res);
      t.onerror = () => mal(t.error || new Error('error de escritura'));
      t.onabort = () => mal(t.error || new Error('transacción cancelada'));
      try { res = fn(t); } catch (e) { try { t.abort(); } catch (_) {} mal(e); }
    });
  }
  function leerIDB() {
    return transaccion(['estado', 'ajustes'], 'readonly', t => {
      const r = { valor: {} };
      t.objectStore('estado').get('actual').onsuccess = e => { r.valor.estado = e.target.result || null; };
      ['frase', 'ultimo', 'desde', 'pedido'].forEach(k => { t.objectStore('ajustes').get(k).onsuccess = e => { r.valor[k] = e.target.result; }; });
      return r;
    });
  }
  function escribirIDB(texto, ts) {
    return transaccion(['estado', 'copias'], 'readwrite', t => {
      const hora = new Date(ts).toISOString().slice(0, 13);          // una copia por hora: la última de esa hora
      t.objectStore('estado').put({ ts, texto }, 'actual');
      const c = t.objectStore('copias');
      c.put({ hora, ts, texto }, hora);
      c.getAllKeys().onsuccess = e => {                                // se quedan las últimas 200
        const claves = e.target.result.slice().sort();
        claves.slice(0, Math.max(0, claves.length - MAX_COPIAS)).forEach(k => c.delete(k));
      };
    });
  }
  function ajuste(k, v) {
    ls(s => s.setItem('pz_' + k, String(v)));
    return transaccion(['ajustes'], 'readwrite', t => { t.objectStore('ajustes').put(v, k); }).catch(() => {});
  }

  // ---------- carga del estado (IDB + localStorage, gana la copia más nueva) ----------
  const parsear = texto => { try { const o = JSON.parse(texto); return estadoValido(o) ? o : null; } catch (e) { return null; } };
  async function cargar() {
    let idb = null, ajustes = {}, fallo = false;
    try { const r = await leerIDB(); idb = r.estado; ajustes = r; } catch (e) { fallo = true; }
    const lsTexto = ls(s => s.getItem('pz_estado'));
    const cand = [];
    if (idb && idb.texto) { const o = parsear(idb.texto); if (o) cand.push({ de: 'idb', texto: idb.texto, o, ts: Number(o.ts) || idb.ts || 0 }); }
    if (lsTexto) { const o = parsear(lsTexto); if (o) cand.push({ de: 'ls', texto: lsTexto, o, ts: Number(o.ts) || 0 }); }
    cand.sort((a, b) => b.ts - a.ts || (a.de === 'idb' ? -1 : 1));
    const mejor = cand[0] || null;
    // frase / último respaldo / desde cuándo se usa: de IDB, o de la copia en localStorage
    E.frase = ajustes.frase || ls(s => s.getItem('pz_frase')) || null;
    E.ultimo = Number(ajustes.ultimo || ls(s => s.getItem('pz_ultimo'))) || null;
    E.desde = Number(ajustes.desde || ls(s => s.getItem('pz_desde'))) || null;
    E.pedido = String(ajustes.pedido ?? ls(s => s.getItem('pz_pedido')) ?? '') === '1';
    E.lecturaFallida = fallo && !mejor;      // no pude leer IDB y no hay copia: no pisar lo que quizá esté ahí
    if (mejor) {
      E.hayDatos = true; E.texto = mejor.texto;
      if (!E.desde) { E.desde = Date.now(); ajuste('desde', E.desde); }
      // autorreparación: la otra copia se pone al día en segundo plano
      if (mejor.de === 'idb' && lsTexto !== mejor.texto) ls(s => { s.setItem('pz_estado', mejor.texto); });
      if (mejor.de === 'ls' && !fallo) escribirIDB(mejor.texto, mejor.ts || Date.now()).catch(() => {});
    }
    E.cargado = true;
    return mejor ? mejor.o : null;
  }
  let cargando = null;
  const asegurarCarga = () => (cargando = cargando || cargar());

  async function guardar(o) {
    if (!estadoValido(o)) throw err('formato', 'Los datos tienen una forma inesperada y no los guardé.');
    const texto = JSON.stringify(o);
    if (bytesDe(texto) > MAX_BYTES) throw err('muy_grande', 'Los datos pasan de 2 MB y no los guardé.');
    await asegurarCarga();
    const ts = Number(o.ts) || Date.now();
    let bien = false, causa = null;
    if (!E.lecturaFallida) {
      try { await escribirIDB(texto, ts); bien = true; } catch (e) { causa = e; }
    }
    const l = ls(s => { s.setItem('pz_estado', texto); return true; });
    if (l) bien = true;
    if (!bien) throw err('error_guardado', 'No pude guardar en este iPhone' + (causa && causa.message ? ' (' + causa.message + ')' : '') + '.');
    E.hayDatos = true; E.texto = texto;
    if (!E.desde) { E.desde = Date.now(); ajuste('desde', E.desde); }
  }

  const db = {
    doc() {
      return {
        async get() {
          let datos;
          try { cargando = cargar(); datos = await cargando; }   // cada lectura mira lo guardado de nuevo
           catch (e) { throw err('error_lectura', 'No pude leer los datos guardados.'); }
          if (!datos) return { exists: false, data: () => null };
          return { exists: true, data: () => datos };
        },
        async set(o) { await guardar(o); }
      };
    }
  };
  const user = { async id() { return 'pablo'; } };

  // ---------- respaldo cifrado (.pzb), mismo formato que Respaldo.kt ----------
  // "PZB1" | vueltas PBKDF2 (4, big-endian) | sal (16) | IV (12) | texto cifrado + etiqueta GCM (16); los 36 primeros bytes van autenticados.
  const MAGIA = [0x50, 0x5a, 0x42, 0x31], VUELTAS = 600000, CABECERA = 36;
  const esCifrado = b => b.length > CABECERA && MAGIA.every((m, i) => b[i] === m);
  function revisarFrase(f) {
    f = limpiarFrase(f);
    if (f.length < 12) return 'La frase debe tener al menos 12 caracteres.';
    for (let i = 0; i < f.length; i++) { const c = f.charCodeAt(i); if (c < 32 || c > 126) return 'Usa solo letras sin tilde, números, espacios y signos.'; }
    return null;
  }
  async function derivar(frase, sal, vueltas) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(frase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: vueltas }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function cifrar(plano, frase) {
    const sal = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const cab = new Uint8Array(CABECERA); cab.set(MAGIA, 0); new DataView(cab.buffer).setUint32(4, VUELTAS, false); cab.set(sal, 8); cab.set(iv, 24);
    const clave = await derivar(frase, sal, VUELTAS);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: cab, tagLength: 128 }, clave, plano));
    const fuera = new Uint8Array(cab.length + ct.length); fuera.set(cab, 0); fuera.set(ct, cab.length);
    return fuera;
  }
  async function descifrar(datos, frase) {
    if (!esCifrado(datos)) throw err('formato', 'Este archivo no es un respaldo de Pableque Z.');
    const vueltas = new DataView(datos.buffer, datos.byteOffset, datos.byteLength).getUint32(4, false);
    if (vueltas < 100000 || vueltas > 5000000) throw err('formato', 'El respaldo tiene un formato que no reconozco.');
    const cab = datos.slice(0, CABECERA), sal = datos.slice(8, 24), iv = datos.slice(24, 36);
    try {
      const clave = await derivar(frase, sal, vueltas);
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: cab, tagLength: 128 }, clave, datos.slice(CABECERA)));
    } catch (e) { throw err('frase', 'Frase incorrecta o respaldo dañado.'); }
  }
  const fechaChile = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t || new Date());

  const Respaldo = {
    info() { return { cargado: E.cargado, hayDatos: E.hayDatos, ultimo: E.ultimo, desde: E.desde, fraseGuardada: !!E.frase, persistente: E.persistente, pedido: E.pedido, avisoSiete: this.pasaronSiete() }; },
    pasaronSiete() { const base = E.ultimo || E.desde; return !!(E.hayDatos && (E.pedido || (base && Date.now() - base >= SIETE_DIAS))); },
    // Después de cerrar el mes: el aviso «Haz tu respaldo» sale al tiro, hasta que exportes.
    pedir() { E.pedido = true; ajuste('pedido', '1'); },
    revisarFrase,
    async guardarFrase(f) { f = limpiarFrase(f); const m = revisarFrase(f); if (m) throw err('frase', m); E.frase = f; await ajuste('frase', f); },
    // Cifra lo guardado en el iPhone. Devuelve {bytes, nombre}. Sin frase guardada hay que pasar una.
    async crear(fraseNueva) {
      await asegurarCarga();
      const frase = fraseNueva ? limpiarFrase(fraseNueva) : E.frase;
      if (!frase) throw err('pide_frase', 'Falta la frase del respaldo.');
      const m = revisarFrase(frase); if (m) throw err('frase', m);
      if (!E.texto) throw err('sin_datos', 'Todavía no hay nada guardado en este iPhone.');
      const bytes = await cifrar(new TextEncoder().encode(E.texto), frase);
      return { bytes, nombre: 'pableque-z-respaldo-' + fechaChile() + '.pzb' };
    },
    // Entrega el archivo: hoja de compartir de iOS («Guardar en Archivos»); si no se puede, descarga normal.
    // Debe llamarse directo desde un toque. Devuelve 'compartido' | 'descargado' | 'cancelado'.
    async entregar(r) {
      const f = new File([r.bytes], r.nombre, { type: 'application/octet-stream' });
      if (navigator.canShare && navigator.share) {
        let puede = false; try { puede = navigator.canShare({ files: [f] }); } catch (e) {}
        if (puede) {
          try { await navigator.share({ files: [f], title: 'Respaldo Pableque Z' }); await this.marcarExportado(); return 'compartido'; }
          catch (e) { if (e && e.name === 'AbortError') return 'cancelado'; }
        }
      }
      const url = URL.createObjectURL(f), a = document.createElement('a');
      a.href = url; a.download = r.nombre; a.rel = 'noopener'; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 30000);
      await this.marcarExportado();
      return 'descargado';
    },
    async marcarExportado() { E.ultimo = Date.now(); E.pedido = false; await ajuste('ultimo', E.ultimo); await ajuste('pedido', '0'); },
    // Lee un archivo elegido por Pablo: .pzb (con frase) o estado.json en claro. Devuelve {tipo, estado}.
    async leerArchivo(archivo, frase) {
      if (archivo.size > 6 * 1024 * 1024) throw err('formato', 'El archivo es demasiado grande para ser un respaldo de Pableque Z.');
      const bytes = new Uint8Array(await archivo.arrayBuffer());
      let tipo = 'json', plano = bytes;
      if (esCifrado(bytes)) {
        tipo = 'pzb';
        const f = frase ? limpiarFrase(frase) : E.frase;
        if (!f) throw err('pide_frase', 'Escribe la frase de este respaldo.');
        plano = await descifrar(bytes, f);
      }
      let o;
      try { o = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plano)); } catch (e) { throw err('formato', 'No pude leer los datos del archivo: no parece un respaldo de Pableque Z.'); }
      if (o && typeof o === 'object' && !Array.isArray(o) && o.data && typeof o.data === 'object' && !('items' in o)) o = o.data;   // {data: …} de la tablet
      if (!estadoValido(o)) throw err('formato', 'El archivo no tiene la forma de los datos de Pableque Z.');
      if (bytesDe(JSON.stringify(o)) > MAX_BYTES) throw err('muy_grande', 'Los datos pasan de 2 MB.');
      return { tipo, estado: o };
    },
    // Antes de reemplazar: copia de lo que hay guardado ahora (se quedan las últimas 5).
    async copiaPrevia() {
      await asegurarCarga();
      if (!E.texto) return false;
      const k = new Date().toISOString();
      await transaccion(['previos'], 'readwrite', t => {
        const p = t.objectStore('previos'); p.put({ ts: Date.now(), texto: E.texto }, k);
        p.getAllKeys().onsuccess = e => { const c = e.target.result.slice().sort(); c.slice(0, Math.max(0, c.length - MAX_PREVIOS)).forEach(x => p.delete(x)); };
      });
      return true;
    },
    // Solo para las pruebas: cifrar/descifrar directo.
    _cifrar: cifrar, _descifrar: descifrar
  };

  window.PablequeRespaldo = Respaldo;
  const capacidades = { db, user, mcp: null, sample: null };
  window.claude = { use: n => Promise.resolve(capacidades[n] || null) };
  window.EN_TABLET = true;      // la app es la fuente de sus datos (misma lógica que en la tablet y en Android)
  window.EN_IPHONE = true;
})();

window.PZ_VERSION = '01-11-2026 16:35';
