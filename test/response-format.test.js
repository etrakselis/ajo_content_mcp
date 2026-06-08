import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSuccessResult } from '../dist/result-format.js';

test('formatSuccessResult includes status, headers, and data', () => {
  const headers = new Headers({
    etag: '"abc123"',
    location: '/templates/123',
    'x-request-id': 'req-1',
    'content-type': 'application/json'
  });

  const result = formatSuccessResult({
    status: 201,
    statusText: 'Created',
    headers
  }, { id: '123', name: 'Test Template' });

  assert.equal(Array.isArray(result.content), true);
  assert.equal(result.content[0].type, 'text');

  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.status, 201);
  assert.equal(parsed.statusText, 'Created');
  assert.equal(parsed.headers.etag, '"abc123"');
  assert.equal(parsed.headers.location, '/templates/123');
  assert.equal(parsed.headers['x-request-id'], 'req-1');
  assert.deepEqual(parsed.data, { id: '123', name: 'Test Template' });
});
