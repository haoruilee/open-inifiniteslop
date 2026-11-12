import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSeoRedirect } from './seo-routing.js';

for (const [path, target] of [
  ['/about/', '/about'], ['/about?utm_source=test', '/about'],
  ['/archive/?page=01', '/archive'], ['/archive?page=02&utm_source=test', '/archive?page=2'],
  ['/archive?page=bad', '/archive'], ['/watch/023/', '/watch/23'],
  ['/watch/23?utm_campaign=test', '/watch/23'],
  ['/watch/023/thumbnail.svg/', '/watch/23/thumbnail.svg'],
]) {
  test(`one-hop canonical ${path}`, () => {
    const request = new Request(`https://infiniteaislop.ai${path}`);
    const response = canonicalSeoRedirect(request);
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('Location'), `https://infiniteaislop.ai${target}`);
    assert.equal(canonicalSeoRedirect(new Request(response.headers.get('Location'))), null);
  });
}
for (const path of ['/about', '/archive', '/archive?page=2', '/watch/23', '/watch/0/',
  '/watch/9007199254740992', '/archive?page=0', '/archive?page=21', '/api/health',
  '/api/media/23?token=example', '/status.json', '/', '/assets/app.js', '/unknown']) {
  test(`unchanged ${path}`, () => {
    assert.equal(canonicalSeoRedirect(new Request(`https://infiniteaislop.ai${path}`)), null);
  });
}
test('HEAD redirects without a body; POST and alternate hosts are untouched', async () => {
  const response = canonicalSeoRedirect(new Request('https://infiniteaislop.ai/about/', {method: 'HEAD'}));
  assert.equal(response.status, 301);
  assert.equal(await response.text(), '');
  assert.equal(canonicalSeoRedirect(new Request('https://infiniteaislop.ai/about/', {method: 'POST'})), null);
  assert.equal(canonicalSeoRedirect(new Request('https://preview.example/about/')), null);
});
