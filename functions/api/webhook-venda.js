import { handleWebhook } from '../lib/webhook.js';

export async function onRequest(context) {
  return handleWebhook(context.request, context.env);
}
