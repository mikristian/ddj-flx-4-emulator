#!/usr/bin/env node
// Prevent the public gallery from silently drifting back to unrelated FLX4
// prototypes or screenshots of different installed app versions.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const docs = read('README.md');
const gallery = path.join(root, 'docs/screenshots');

const variants = [
  {
    label: 'FLX4 Live 2D · Fixed 3D',
    version: '0.3.0',
    screenshot: 'flx4-live-fixed-3d-v0.3.0.png',
    sha256: '4c766c3c62096aca188b5ff30ef936ae1d50924bed493dab5d9159af8bba6c3c',
    packager: 'FLX4Live2D/native/package_mac_app.sh',
    required: [
      'FLX4Live2D/realistic.html',
      'FLX4Live2D/realistic3d.js',
      'FLX4Live2D/sampler-companion.js',
      'FLX4Live2D/bridge.py',
      'FLX4Live2D/native/FLX4Live2D.swift',
    ],
    entry: 'FLX4Live2D/realistic.html',
    entryScript: 'realistic3d.js',
  },
  {
    label: 'FLX4 Flat 2D',
    version: '1.1.1',
    screenshot: 'flx4-flat-2d-v1.1.1.png',
    sha256: '47beeff57d3983afbed8ff7b23d0806290cce0593999b176c246facf79e8edfe',
    packager: 'FLX4FlatDrumApp/native/package_flat.sh',
    required: [
      'FLX4FlatDrumApp/ui/index.html',
      'FLX4FlatDrumApp/ui/style.css',
      'FLX4FlatDrumApp/ui/app.js',
      'FLX4FlatDrumApp/native/FLX4LiveBridge.py',
      'FLX4FlatDrumApp/native/FLX4Flat2D.swift',
    ],
    entry: 'FLX4FlatDrumApp/ui/index.html',
    entryScript: 'app.js',
  },
];

const screenshots = fs.readdirSync(gallery).filter(name => name.toLowerCase().endsWith('.png')).sort();
assert.deepEqual(screenshots, variants.map(v => v.screenshot).sort(), 'Gallery must contain exactly these two app screenshots.');

for (const variant of variants) {
  assert.ok(docs.includes(`docs/screenshots/${variant.screenshot}`), `README is missing ${variant.label}`);
  const shot = fs.readFileSync(path.join(gallery, variant.screenshot));
  assert.ok(shot.length > 100_000, `${variant.screenshot} is unexpectedly small`);
  assert.equal(shot.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Expected a PNG screenshot');
  assert.equal(crypto.createHash('sha256').update(shot).digest('hex'), variant.sha256,
    `Wrong screenshot associated with ${variant.label}`);
  const packager = read(variant.packager);
  assert.ok(packager.includes(`<key>CFBundleShortVersionString</key><string>${variant.version}</string>`),
    `App packaging version differs from gallery: ${variant.label}`);
  for (const name of variant.required) {
    assert.ok(fs.statSync(path.join(root, name)).isFile(), `Missing app source: ${name}`);
  }
  assert.ok(read(variant.entry).includes(variant.entryScript), `Entry page disconnected: ${variant.entry}`);
  console.log(`OK: ${variant.label} v${variant.version}, screenshot SHA and app source`);
}

console.log('Release gallery verified: exactly two real app screenshots, with matching versioned sources.');
