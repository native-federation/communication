import { connectTransport } from '@softarc/native-federation-communication';

const app = {
  name: 'react-native',
  send: envelope => window.ReactNativeWebView?.postMessage(JSON.stringify(envelope)),
  listen: receive => {
    window.__NF_FROM_APP__ = json => receive(JSON.parse(json));
    window.ReactNativeWebView?.postMessage('nf:ready');
    return () => delete window.__NF_FROM_APP__;
  },
};

connectTransport(app, ['cart:changed', 'auth:user']);
