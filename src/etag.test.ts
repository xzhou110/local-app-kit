import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseIfMatch, quoteEtag, sha256 } from './etag.ts';

describe('etag', () => {
  it('sha256 is stable (career-center server.test)', () => {
    assert.equal(sha256('a'), 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
    assert.equal(sha256(Buffer.from('a')), sha256('a'));
  });

  it('reads every If-Match form the apps send', () => {
    assert.equal(parseIfMatch(undefined), undefined);
    assert.equal(parseIfMatch(''), undefined);
    assert.equal(parseIfMatch('*'), '*');
    assert.equal(parseIfMatch('"abc"'), 'abc');
    assert.equal(parseIfMatch('abc'), 'abc');
    assert.equal(parseIfMatch('W/"abc"'), 'abc');
    assert.equal(parseIfMatch(['"x"', '"y"']), 'x');
    assert.equal(quoteEtag('abc'), '"abc"');
  });
});
