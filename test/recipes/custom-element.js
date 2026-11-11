import { bus } from '@softarc/native-federation-communication';

class CartBadge extends HTMLElement {
  #connection;

  connectedCallback() {
    this.#connection = new AbortController();
    const { signal } = this.#connection;
    bus.on('cart:changed', ({ count }) => (this.textContent = String(count)), { signal });
    bus.on('shell:theme', ({ name }) => this.setAttribute('theme', name), { signal });
  }

  disconnectedCallback() {
    this.#connection?.abort();
  }
}

customElements.define('cart-badge', CartBadge);
