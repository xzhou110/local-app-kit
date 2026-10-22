import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequestTarget } from './request-target.ts';

describe('request target', () => {
  it('answers 400 for every target that used to crash or fool a server (ai-usage-tracker, career-center, creator-advisors)', () => {
    const bad = [
      undefined, '', 'index.html', 'http://evil.example/x',
      '//', '///', '//evil.example/api/status', '/%zz', '/%', '/%C0%80',
      '/..%5cprivate', '/C:/private', '/%252e%252e/private', '/%2e%2e/private', '/../package.json', '/a/../b',
      '/NUL.txt', '/con', '/COM1.json', '/.hidden', '/file.json.', '/file.json ', '/index.html::$DATA',
      '/a#b', '/a\\b', '/a\tb', '/a b', '/api/history?cursor=%zz',
    ];
    for (const target of bad) assert.equal(parseRequestTarget(target, 8150).ok, false, String(target));
  });

  it('parses the good ones with a decoded path and the query kept', () => {
    const root = parseRequestTarget('/', 8150);
    assert.ok(root.ok);
    if (root.ok) { assert.equal(root.pathname, '/'); assert.equal(root.url.pathname, '/'); }
    const file = parseRequestTarget('/api/file?path=record%2Froles.json&profile=a', 8150);
    assert.ok(file.ok);
    if (file.ok) {
      assert.equal(file.pathname, '/api/file');
      assert.equal(file.url.searchParams.get('path'), 'record/roles.json');
      assert.equal(file.url.searchParams.get('profile'), 'a');
      assert.equal(file.url.host, '127.0.0.1:8150');
    }
    const space = parseRequestTarget('/a%20b.json');
    assert.ok(space.ok);
    if (space.ok) assert.equal(space.pathname, '/a b.json');
    for (const good of ['/assets/index-abc.js', '/resume/var_x', '/dashboard', '/UPPER.JS', '/a+b', '/x.webmanifest']) assert.equal(parseRequestTarget(good).ok, true, good);
  });
});
