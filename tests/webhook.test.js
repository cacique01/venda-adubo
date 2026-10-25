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

// ---- Pedido em texto ("Fechando: ...") escrito pelo agente da Sendfy ----

const catalog = [
  { id: 'fr4', linha: 'frutifera', tamanho: 4, nome: 'Frutífera Premium 4kg', preco: 25 },
  { id: 'tb5', linha: 'turbinado', tamanho: 5, nome: 'Turbinado 5kg', preco: 25 },
];

function catalogMock({ commitStatus = 200 } = {}) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('oauth2.googleapis.com')) {
      return Response.json({ access_token: 'firebase-token', expires_in: 3600 });
    }
    if (String(url).endsWith(':runQuery')) {
      const filters = JSON.parse(options.body).structuredQuery.where.compositeFilter.filters;
      const line = filters[1].fieldFilter.value.stringValue;
      const size = Number(filters[2].fieldFilter.value.integerValue);
      const found = catalog.find((item) => item.linha === line && item.tamanho === size);
      return Response.json(found ? [{
        document: {
          name: `projects/teste-projeto/databases/(default)/documents/produtos/${found.id}`,
          fields: {
            nome: { stringValue: found.nome },
            preco: { doubleValue: found.preco },
          },
        },
      }] : [{}]);
    }
    return new Response('', { status: commitStatus });
  };
  return { calls, fetch };
}

async function sendOrder(fechando, extra = {}, mock = catalogMock()) {
  const response = await handleWebhook(
    request({ token: 'segredo', phone: '5565999998888', name: 'Maria', fechando, ...extra }),
    environment,
    { fetch: mock.fetch, now: () => now },
  );
  return { response, mock, body: await response.json() };
}

test('parseFechando reads a single product with free delivery', async () => {
  const { parseFechando } = await import('../functions/lib/webhook.js');
  const result = parseFechando(
    'Fechando: 2 Frutífera Premium 4kg = R$50, entrega grátis, total R$50. '
    + 'Entrega na Rua dos Canários, Cristo Rei, Várzea Grande, segunda à noite, pagamento no dinheiro. Confirma?',
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.items, [{ line: 'frutifera', size: 4, quantity: 2 }]);
  assert.equal(result.shipping, 0);
  assert.equal(result.declaredTotal, 50);
  assert.equal(result.payment, 'Dinheiro');
  assert.equal(result.delivery, 'Rua dos Canários, Cristo Rei, Várzea Grande, segunda à noite');
});

test('parseFechando reads several products and a delivery fee', async () => {
  const { parseFechando } = await import('../functions/lib/webhook.js');
  const result = parseFechando(
    'Fechando: 1 Frutífera 4kg + 2 Turbinado 5kg = R$75, taxa de entrega R$10, total R$85. '
    + 'Entrega na Rua X, 120, sábado de manhã, pagamento no Pix. Confirma?',
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.items, [
    { line: 'frutifera', size: 4, quantity: 1 },
    { line: 'turbinado', size: 5, quantity: 2 },
  ]);
  assert.equal(result.shipping, 10);
  assert.equal(result.declaredTotal, 85);
  assert.equal(result.payment, 'PIX');
});

test('parseFechando rejects text without an order', async () => {
  const { parseFechando } = await import('../functions/lib/webhook.js');
  assert.ok(parseFechando('Oi, tudo bem?').errors.length > 0);
  assert.ok(parseFechando('Fechando: pagamento no pix').errors.length > 0);
});

test('records a multi-product order with delivery fee in one atomic commit', async () => {
  const { response, mock, body } = await sendOrder(
    'Fechando: 1 Frutífera 4kg + 2 Turbinado 5kg = R$75, taxa de entrega R$10, total R$85. '
    + 'Entrega na Rua X, 120, sábado de manhã, pagamento no Pix. Confirma?',
  );
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.total, 85);

  const commits = mock.calls.filter((call) => call.url.endsWith(':commit'));
  assert.equal(commits.length, 1);
  const writes = JSON.parse(commits[0].options.body).writes;
  // venda + (baixa + movimentação) x 2 produtos
  assert.equal(writes.length, 5);
  const sale = writes[0].update.fields;
  assert.equal(sale.itens.arrayValue.values.length, 2);
  assert.equal(sale.frete.integerValue, '10');
  assert.equal(sale.total.integerValue, '85');
  assert.equal(sale.pagamento.stringValue, 'PIX');
  assert.match(sale.obs.stringValue, /Rua X, 120/);
  assert.match(writes[1].transform.document, /\/produtos\/fr4$/);
  assert.equal(writes[1].transform.fieldTransforms[0].increment.integerValue, '-1');
  assert.match(writes[3].transform.document, /\/produtos\/tb5$/);
  assert.equal(writes[3].transform.fieldTransforms[0].increment.integerValue, '-2');
  assert.match(writes[2].update.name, /\/movimentacoes\/mv_wa_[0-9a-f]{24}_1$/);
  assert.match(writes[4].update.name, /\/movimentacoes\/mv_wa_[0-9a-f]{24}_2$/);
});

test('free delivery order uses the catalog price and flags a total mismatch', async () => {
  const { body, mock } = await sendOrder(
    'Fechando: 2 Frutífera Premium 4kg = R$50, entrega grátis, total R$60. '
    + 'Entrega na Rua A, segunda, pagamento no dinheiro. Confirma?',
  );
  assert.equal(body.total, 50);
  const writes = JSON.parse(mock.calls.find((c) => c.url.endsWith(':commit')).options.body).writes;
  assert.match(writes[0].update.fields.obs.stringValue, /bot informou total de R\$ 60\.00/);
});

test('merges repeated lines of the same product and detects duplicates', async () => {
  const text = 'Fechando: 1 Turbinado 5kg + 1 Turbinado 5kg = R$50, entrega grátis, total R$50. '
    + 'Entrega na Rua A, pagamento no pix. Confirma?';
  const first = await sendOrder(text);
  const writes = JSON.parse(first.mock.calls.find((c) => c.url.endsWith(':commit')).options.body).writes;
  assert.equal(writes.length, 3);
  assert.equal(writes[1].transform.fieldTransforms[0].increment.integerValue, '-2');

  const duplicate = await sendOrder(text, {}, catalogMock({ commitStatus: 409 }));
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.body.duplicada, true);
});

test('reports an unknown product from the order text', async () => {
  const { response, body } = await sendOrder(
    'Fechando: 1 Turbinado 50kg = R$270, entrega grátis, total R$270. Entrega na Rua A, pagamento no pix. Confirma?',
  );
  assert.equal(response.status, 404);
  assert.match(body.erro, /turbinado 50kg/);
});
