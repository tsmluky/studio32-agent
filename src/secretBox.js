'use strict';

// Cifrado de secretos de integraciones y firma de parámetros de ida y vuelta.
//
// Una sola clave de servidor, INTEGRATION_SECRET_KEY (32 bytes en base64:
// `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`),
// de la que se derivan dos claves distintas: una para cifrar y otra para firmar, de
// modo que un texto firmado nunca sirve como cifrado ni al revés.
//
// - cifrar/descifrar: AES-256-GCM. Guarda los refresh tokens de Google en Supabase
//   sin que la base de datos sola baste para usarlos.
// - firmar/verificar: HMAC-SHA256 con caducidad. Es el `state` del viaje a Google:
//   dice a qué organización y a qué usuario pertenece la conexión, y el servidor solo
//   se lo cree si lo firmó él y no ha caducado. Sin esto, cualquiera podría fabricar
//   una vuelta de Google que enganchara SU cuenta al negocio de otro.

const crypto = require('crypto');

function claveMaestra() {
    const raw = process.env.INTEGRATION_SECRET_KEY;
    if (!raw) throw new Error('Falta INTEGRATION_SECRET_KEY en el servidor.');
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('INTEGRATION_SECRET_KEY tiene que ser de 32 bytes en base64.');
    return key;
}

function derivar(uso) {
    return Buffer.from(crypto.hkdfSync('sha256', claveMaestra(), Buffer.alloc(0), Buffer.from(`studio32:${uso}`), 32));
}

function disponible() {
    try { claveMaestra(); return true; } catch (_) { return false; }
}

function cifrar(texto) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', derivar('cifrado'), iv);
    const datos = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), datos.toString('base64url')].join('.');
}

function descifrar(sobre) {
    const [version, iv, tag, datos] = String(sobre || '').split('.');
    if (version !== 'v1' || !iv || !tag || !datos) throw new Error('Secreto con formato desconocido.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivar('cifrado'), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(datos, 'base64url')), decipher.final()]).toString('utf8');
}

function firmar(payload, { caducaEnSegundos = 600 } = {}) {
    const cuerpo = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + caducaEnSegundos, n: crypto.randomBytes(8).toString('hex') })).toString('base64url');
    const firma = crypto.createHmac('sha256', derivar('firma')).update(cuerpo).digest('base64url');
    return `${cuerpo}.${firma}`;
}

// Devuelve el payload si la firma es buena y no ha caducado; null en cualquier otro
// caso. Nunca lanza por un texto manipulado: una vuelta falsa es "no válida", no un
// error del servidor.
function verificar(texto) {
    const [cuerpo, firma] = String(texto || '').split('.');
    if (!cuerpo || !firma) return null;
    let esperada;
    try { esperada = crypto.createHmac('sha256', derivar('firma')).update(cuerpo).digest(); }
    catch (_) { return null; }
    const recibida = Buffer.from(firma, 'base64url');
    if (recibida.length !== esperada.length || !crypto.timingSafeEqual(recibida, esperada)) return null;
    let payload;
    try { payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')); }
    catch (_) { return null; }
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
}

module.exports = { disponible, cifrar, descifrar, firmar, verificar };
