// @vitest-environment jsdom
// The recipes that need a DOM; recipes.spec.ts runs the rest without one, as the docs promise.
import './recipes/testing-setup.js';

const recipe = (name: string) => import(`./recipes/${name}.js`);

describe('the custom element recipe', () => {
  it('follows its channels while connected', async () => {
    await recipe('custom-element');
    const badge = document.createElement('cart-badge');
    globalThis.__NF_BUS__?.emit('cart:changed', { count: 1 });

    document.body.append(badge);
    globalThis.__NF_BUS__?.emit('shell:theme', { name: 'dark' });
    badge.remove();
    globalThis.__NF_BUS__?.emit('cart:changed', { count: 2 });

    expect(badge.textContent).toBe('1');
    expect(badge.getAttribute('theme')).toBe('dark');
  });
});

describe('the WebView page recipe', () => {
  afterEach(() => {
    delete (window as { __SHOP_FROM_APP__?: unknown }).__SHOP_FROM_APP__;
  });

  // The fixture connects at import, to whichever bus testing-setup installed for this test.
  it('posts listed emits to the app and emits what the app injects, without echo', async () => {
    const postMessage = vi.fn();
    vi.stubGlobal('ReactNativeWebView', { postMessage });
    await recipe('webview-page');
    const fromApp = (window as { __SHOP_FROM_APP__?: (json: string) => void }).__SHOP_FROM_APP__;

    globalThis.__NF_BUS__?.emit('cart:changed', { count: 1 });
    globalThis.__NF_BUS__?.emit('recipe:unlisted', 1);
    fromApp?.(JSON.stringify({ channel: 'auth:user', value: { id: 1 }, retain: true }));

    // The ready message comes first: listen runs as soon as connectTransport has claimed the transport name.
    expect(postMessage.mock.calls).toEqual([
      [JSON.stringify({ type: 'webview-ready' })],
      [JSON.stringify({ channel: 'cart:changed', value: { count: 1 }, retain: true })],
    ]);
    expect(globalThis.__NF_BUS__?.peek('auth:user')).toEqual({ id: 1 });
  });
});
