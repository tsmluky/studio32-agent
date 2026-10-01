'use strict';

// Snapshot del volumen JSON. No sustituye el backup de Supabase ni Calendar.
// node scripts/backup-data.cjs create <DATA_DIR> <archivo-nuevo.json>
// node scripts/backup-data.cjs restore <archivo.json> <directorio-vacio>
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const MAX_BYTES = 100 * 1024 * 1024;

function safeRelative(relative) {
    return typeof relative === 'string' && relative.length > 0 && !/[\\:\x00-\x1f]/.test(relative)
        && relative.split('/').every(part => part && part !== '.' && part !== '..');
}

function create(source, destination) {
    const root = path.resolve(source), output = path.resolve(destination);
    const relativeOutput = path.relative(root, output);
    if (!relativeOutput.startsWith('..' + path.sep) && relativeOutput !== '..' && !path.isAbsolute(relativeOutput)) throw new Error('Guardar el snapshot fuera del volumen origen.');
    const files = [];
    let bytes = 0;
    function walk(directory) {
        if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('No se admiten symlinks en el snapshot.');
        for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
            const absolute = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) throw new Error('No se admiten symlinks en el snapshot.');
            if (entry.isDirectory()) { walk(absolute); continue; }
            if (!entry.isFile() || entry.name === '.health' || entry.name.endsWith('.tmp')) continue;
            const content = fs.readFileSync(absolute);
            if (absolute.endsWith('.json')) JSON.parse(content.toString('utf8'));
            bytes += content.length;
            if (bytes > MAX_BYTES) throw new Error('Snapshot supera el límite de 100 MB.');
            const relative = path.relative(root, absolute).split(path.sep).join('/');
            if (!safeRelative(relative)) throw new Error('Ruta no compatible en snapshot.');
            files.push({ path:relative, sha256:hash(content), data:content.toString('base64') });
        }
    }
    walk(root);
    const snapshot = { version:1, created_at:new Date().toISOString(), bytes, files };
    // wx: no sobrescribir backups anteriores; permisos de archivo privados en POSIX.
    fs.writeFileSync(output, JSON.stringify(snapshot), { flag:'wx', mode:0o600 });
    return { files:files.length, bytes };
}

function restore(source, destination) {
    const snapshot = JSON.parse(fs.readFileSync(source, 'utf8'));
    if (snapshot.version !== 1 || !Array.isArray(snapshot.files)) throw new Error('Snapshot no compatible.');
    const root = path.resolve(destination);
    if (fs.existsSync(root) && (fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory() || fs.readdirSync(root).length)) throw new Error('Restaurar solo en un directorio vacío, sin symlink.');
    const seen = new Set();
    let bytes = 0;
    const verified = snapshot.files.map(file => {
        if (!safeRelative(file.path) || seen.has(file.path.toLowerCase()) || typeof file.data !== 'string') throw new Error('Ruta de snapshot no válida o duplicada.');
        seen.add(file.path.toLowerCase());
        const content = Buffer.from(file.data, 'base64');
        bytes += content.length;
        if (bytes > MAX_BYTES || hash(content) !== file.sha256) throw new Error('Snapshot manipulado o demasiado grande.');
        if (file.path.endsWith('.json')) JSON.parse(content.toString('utf8'));
        return { relative:file.path, content };
    });
    // Verificar todo antes de escribir un solo archivo.
    fs.mkdirSync(root, { recursive:true, mode:0o700 });
    for (const file of verified) {
        const output = path.join(root, ...file.relative.split('/'));
        fs.mkdirSync(path.dirname(output), { recursive:true, mode:0o700 });
        fs.writeFileSync(output, file.content, { flag:'wx', mode:0o600 });
    }
    return { files:verified.length, bytes };
}

if (require.main === module) {
    const [mode, source, destination] = process.argv.slice(2);
    if (!source || !destination || !['create','restore'].includes(mode)) {
        console.error('Uso: node scripts/backup-data.cjs create|restore <origen> <destino>');
        process.exitCode = 1;
    } else {
        try { console.log(JSON.stringify(mode === 'create' ? create(source, destination) : restore(source, destination))); }
        catch (error) { console.error(error.message); process.exitCode = 1; }
    }
}
module.exports = { create, restore };
