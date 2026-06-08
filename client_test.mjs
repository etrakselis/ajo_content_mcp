import test from 'node:test';
import assert from 'node:assert/strict';

test('client HTTP example is intentionally skipped without a running local server', async (t) => {
  t.skip('Requires a manually running MCP HTTP server at http://localhost:3000/mcp');
  assert.ok(true);
});
