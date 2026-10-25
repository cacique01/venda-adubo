import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { handleWebhook } from '../functions/lib/webhook.js';

const now = new Date('2026-10-21T12:00:00Z');
const keyPair = await webcrypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const privateKeyDer = new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', keyPair.privateKey));
let privateKeyBinary = '';
for (const byte of privateKeyDer) privateKeyBinary += String.fromCharCode(byte);
const environment = {
  WEBHOOK_TOKEN: 'segredo',
  FIREBASE_PROJECT_ID: 'teste-projeto',
  FIREBASE_CLIENT_EMAIL: 'firebase@example.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${btoa(privateKeyBinary)}\n-----END PRIVATE KEY-----`,
};
const product = {
  id: 'dF4',
  nome: '4kg Frutífero Direto',
  icon: 'tree-pine',
  preco: 35,
  custo: 8,
};
const payload = {
  token: 'segredo',
  phone: '5565999998888',
  name: 'Maria',
  linha: 'Frutífera',
  tamanho: '4',
  quantidade: '2',
  pagamento: 'PIX',
};

function request(body, options = {}) {
  return new Request('https://example.com/api/webhook-venda', {
    method: options.method || 'POST',
    headers: options.headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function firestoreMock({ foundProduct = product, commitStatus = 200 } = {}) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('oauth2.googleapis.com')) {
      return Response.json({ access_token: 'firebase-token', expires_in: 3600 });
    }
    if (String(url).endsWith(':runQuery')) {
      const results = foundProduct ? [{
        document: {
          name: `projects/teste-projeto/databases/(default)/documents/produtos/${foundProduct.id}`,
          fields: Object.fromEntries(
            Object.entries(foundProduct)
              .filter(([key]) => key !== 'id')
              .map(([key, value]) => [key, typeof value === 'number'
                ? { doubleValue: value }
                : { stringValue: value }]),
          ),
        },
      }] : [];
      return Response.json(results);
    }
    return new Response('', { status: commitStatus });
  };
  return { calls, fetch };
}

test('rejects methods other than POST', async () => {
  const response = await handleWebhook(request(undefined, { method: 'GET' }), environment);
  assert.equal(response.status, 405);
});

test('rejects request bodies larger than 64 KB', async () => {
  const response = await handleWebhook(
    request('x'.repeat(64 * 1024 + 1)),
    environment,
  );
  assert.equal(response.status, 413);
});

test('rejects an invalid token without contacting Firebase', async () => {
  const mock = firestoreMock();
  const response = await handleWebhook(
    request({ ...payload, token: 'incorreto' }),
    environment,
    { fetch: mock.fetch, now: () => now },
  );
  assert.equal(response.status, 401);
  assert.equal(mock.calls.length, 0);
});

test('rejects invalid sale data', async () => {
  const mock = firestoreMock();
  const response = await handleWebhook(
    request({ ...payload, pagamento: 'boleto' }),
    environment,
    { fetch: mock.fetch, now: () => now },
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).erro, /forma de pagamento inválida/);
  assert.equal(mock.calls.length, 0);
});

test('creates a WhatsApp sale through Firestore REST', async () => {
  const mock = firestoreMock();
  const response = await handleWebhook(
    request(Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'token')), {
      headers: { 'x-webhook-token': 'segredo' },
    }),
    { ...environment, WEBHOOK_TOKEN: 'segredo' },
    { fetch: mock.fetch, now: () => now },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    id: 'wa_f0a5cb9598a5935505e0cfcf',
    total: 70,
  });

  const queryCall = mock.calls.find((call) => call.url.endsWith(':runQuery'));
  const query = JSON.parse(queryCall.options.body);
  assert.equal(query.structuredQuery.from[0].collectionId, 'produtos');
  assert.equal(query.structuredQuery.limit, 1);

  const commitCall = mock.calls.find((call) => call.url.endsWith(':commit'));
  const write = JSON.parse(commitCall.options.body).writes[0];
  assert.equal(write.currentDocument.exists, false);
  assert.deepEqual(write.updateTransforms, [
    { fieldPath: 'criadoEm', setToServerValue: 'REQUEST_TIME' },
  ]);
  assert.equal(write.update.fields.total.integerValue, '70');
  assert.equal(write.update.fields.telefone.stringValue, '5565999998888');
  assert.equal(write.update.fields.origem.stringValue, 'whatsapp');
  assert.equal(write.update.fields.estoqueBaixado.booleanValue, true);

  // baixa de estoque e movimentação saem no mesmo commit atômico
  const writes = JSON.parse(commitCall.options.body).writes;
  assert.equal(writes.length, 3);
  assert.match(writes[1].transform.document, /\/produtos\/dF4$/);
  assert.deepEqual(writes[1].transform.fieldTransforms[0], {
    fieldPath: 'estoque',
    increment: { integerValue: '-2' },
  });
  assert.match(writes[2].update.name, /\/movimentacoes\/mv_wa_f0a5cb9598a5935505e0cfcf$/);
  assert.equal(writes[2].update.fields.qtd.integerValue, '-2');
  assert.equal(writes[2].update.fields.tipo.stringValue, 'venda');
});

test('treats Firestore document conflicts as duplicate webhook deliveries', async () => {
  const mock = firestoreMock({ commitStatus: 409 });
  const response = await handleWebhook(
    request(payload),
    environment,
    { fetch: mock.fetch, now: () => now },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).duplicada, true);
});

test('reports a missing product', async () => {
  const mock = firestoreMock({ foundProduct: null });
  const response = await handleWebhook(
    request(payload),
    environment,
    { fetch: mock.fetch, now: () => now },
  );
  assert.equal(response.status, 404);
});

test('reports products without a price', async () => {
  const mock = firestoreMock({ foundProduct: { ...product, preco: 0 } });
  const response = await handleWebhook(
    request(payload),
    environment,
    { fetch: mock.fetch, now: () => now },
  );
  assert.equal(response.status, 422);
});

test('accepts the Sendfy form-encoded payload', async () => {
  const mock = firestoreMock();
  const form = new URLSearchParams(payload);
  form.delete('token');
  const response = await handleWebhook(
    request(form.toString(), { headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-webhook-token': 'segredo' } }),
    environment,
    { fetch: mock.fetch, now: () => now },
  );
  assert.equal(response.status, 200);
});
