import { handleWebhook } from '../functions/lib/webhook.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/webhook-venda') {
      return handleWebhook(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
