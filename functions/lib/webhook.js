const OAUTH_URL = 'https://oauth2.googleapis.com/token';
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const FIRESTORE_BASE_URL = 'https://firestore.googleapis.com/v1';

let cachedAccessToken = null;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function firestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isSafeInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  return {
    mapValue: {
      fields: Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, firestoreValue(child)]),
      ),
    },
  };
}

function fromFirestoreValue(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) return fromFirestoreFields(value.mapValue.fields || {});
  return undefined;
}

function fromFirestoreFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, fromFirestoreValue(value)]),
  );
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function parseMoney(value) {
  return Number(String(value).replace(',', '.'));
}

function parsePayment(text) {
  const paymentText = normalizeText(text);
  return paymentText.includes('pix')
    ? 'PIX'
    : paymentText.includes('dinheiro') || paymentText.includes('especie')
      ? 'Dinheiro'
      : paymentText.includes('cart')
        ? 'Cartão'
        : paymentText.includes('prazo') || paymentText.includes('fiado')
          ? 'A prazo'
          : null;
}

// Lê a mensagem de fechamento escrita pelo agente da Sendfy, por exemplo:
// "Fechando: 1 Frutífera 4kg + 2 Turbinado 5kg = R$75, entrega grátis, total R$75.
//  Entrega na Rua X, 120, Bairro, sábado de manhã, pagamento no Pix. Confirma?"
export function parseFechando(raw) {
  const errors = [];
  const text = normalizeText(raw);
  const start = text.indexOf('fechando');
  if (start < 0) return { errors: ['texto do pedido sem "Fechando:"'], items: [] };
  const body = text.slice(start);

  const found = new Map();
  for (const match of body.matchAll(/(\d+)\s*(?:x\s*)?(frutifer[ao]|turbinado)(?:\s+premium)?\s*(\d+)\s*kg/g)) {
    const line = match[2].startsWith('frutifer') ? 'frutifera' : 'turbinado';
    const size = Number.parseInt(match[3], 10);
    const quantity = Number.parseInt(match[1], 10);
    const key = `${line}|${size}`;
    const current = found.get(key) || { line, size, quantity: 0 };
    current.quantity += quantity;
    found.set(key, current);
  }
  const items = [...found.values()];
  if (!items.length) errors.push('nenhum produto reconhecido no pedido');
  if (items.length > 10) errors.push('itens demais no pedido (máximo 10)');
  if (items.some((item) => item.size < 1 || item.quantity < 1 || item.quantity > 500)) {
    errors.push('quantidade inválida (1 a 500)');
  }

  let shipping = 0;
  if (!/(entrega|frete)\s+gratis/.test(body)) {
    const fee = body.match(/(?:frete|taxa(?:\s+de\s+entrega)?)\s*(?:de\s*)?r\$\s*(\d+(?:[.,]\d{1,2})?)/);
    if (fee) shipping = parseMoney(fee[1]);
  }

  const totalMatch = body.match(/total\s*(?:de\s*)?r\$\s*(\d+(?:[.,]\d{1,2})?)/);
  const declaredTotal = totalMatch ? parseMoney(totalMatch[1]) : null;

  const paymentIndex = body.lastIndexOf('pagamento');
  const payment = parsePayment(paymentIndex >= 0 ? body.slice(paymentIndex) : body);
  if (!payment) errors.push('forma de pagamento inválida');

  const deliveryMatch = String(raw).match(/entrega\s+(?:na|no|em)\s+(.+?),\s*pagamento/i);
  const delivery = deliveryMatch ? deliveryMatch[1].trim().slice(0, 200) : '';

  return { errors, items, payment, shipping, declaredTotal, delivery };
}

function validatePayload(body) {
  const errors = [];
  const phone = onlyDigits(body.phone || body.whatsapp_number || body.telefone);
  if (phone.length < 10 || phone.length > 15) errors.push('telefone inválido');

  const client = String(body.cliente || body.name || body.nome || '').trim().slice(0, 80);
  if (!client) errors.push('nome do cliente ausente');

  const summary = String(body.fechando || body.resumo || body.pedido_texto || '').trim();
  if (summary) {
    const parsed = parseFechando(summary);
    errors.push(...parsed.errors);
    return {
      errors,
      data: {
        phone,
        client,
        items: parsed.items,
        payment: parsed.payment,
        shipping: parsed.shipping || 0,
        declaredTotal: parsed.declaredTotal ?? null,
        delivery: parsed.delivery || '',
      },
    };
  }

  const productLine = normalizeText(body.linha || body.produto);
  const line = productLine.includes('frut')
    ? 'frutifera'
    : productLine.includes('turb') || productLine.includes('comum')
      ? 'turbinado'
      : null;
  if (!line) errors.push('linha do produto inválida (use Turbinado ou Frutífera)');

  const sizeMatch = String(body.tamanho || body.produto || '').match(/\d+/);
  const size = sizeMatch ? Number.parseInt(sizeMatch[0], 10) : null;
  if (!size || size < 1) errors.push('tamanho inválido');

  const quantityMatch = String(body.quantidade || body.qtd || '').match(/\d+/);
  const quantity = quantityMatch ? Number.parseInt(quantityMatch[0], 10) : null;
  if (!quantity || quantity < 1 || quantity > 500) errors.push('quantidade inválida (1 a 500)');

  const payment = parsePayment(body.pagamento);
  if (!payment) errors.push('forma de pagamento inválida');

  return {
    errors,
    data: {
      phone,
      client,
      items: [{ line, size, quantity }],
      payment,
      shipping: 0,
      declaredTotal: null,
      delivery: '',
    },
  };
}

function localDate(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba' }).format(date);
}

function buildSale(entries, data, date) {
  const itens = entries.map(({ product, quantity }) => {
    const unit = Number(product.preco);
    return {
      prodId: product.id,
      nome: product.nome,
      icon: product.icon || 'package',
      qtd: quantity,
      unit,
      subtotal: Number((quantity * unit).toFixed(2)),
    };
  });
  const subtotal = Number(itens.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2));
  const shipping = Number(data.shipping) || 0;
  const total = Number((subtotal + shipping).toFixed(2));

  const missing = entries.filter(({ product }) => product.naoCadastrado);
  const notes = ['Venda via WhatsApp (Sendfy)'];
  if (missing.length) {
    notes.push(
      `Atenção: produto não cadastrado no estoque (sem baixa): ${missing.map(({ product }) => product.nome).join(', ')}`,
    );
    if (missing.some(({ product }) => product.valorNaoInformado)) {
      notes.push('Valor do produto não informado pelo bot (lançado como R$ 0,00)');
    }
  }
  if (data.delivery) notes.push(`Entrega: ${data.delivery}`);
  if (shipping > 0) notes.push(`Frete R$ ${shipping.toFixed(2)}`);
  if (data.declaredTotal != null && Math.abs(data.declaredTotal - total) > 0.009) {
    notes.push(`Atenção: o bot informou total de R$ ${data.declaredTotal.toFixed(2)} e o sistema calculou R$ ${total.toFixed(2)}`);
  }

  return {
    data: localDate(date),
    itens,
    subtotal,
    frete: shipping,
    total,
    cliente: data.client,
    telefone: data.phone,
    responsavel: 'WhatsApp',
    vendedor: 'WhatsApp',
    vendedorEmail: '',
    vendedorUid: '',
    pagamento: data.payment,
    obs: notes.join(' | '),
    status: 'Confirmada',
    origem: 'whatsapp',
    estoqueBaixado: missing.length === 0,
  };
}

async function saleId(data, entries, date) {
  const window = Math.floor(date.getTime() / 120000);
  const products = [...entries]
    .sort((a, b) => String(a.product.id || a.product.nome).localeCompare(String(b.product.id || b.product.nome)))
    .flatMap((entry) => [entry.product.id || entry.product.nome, entry.quantity]);
  const input = new TextEncoder().encode(
    [data.phone, ...products, data.payment, window].join('|'),
  );
  const digest = await crypto.subtle.digest('SHA-1', input);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `wa_${hash.slice(0, 24)}`;
}

async function tokenMatches(received, expected) {
  if (typeof received !== 'string' || !received || typeof expected !== 'string' || !expected) {
    return false;
  }
  const encoder = new TextEncoder();
  const receivedHash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(received)));
  const expectedHash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(expected)));
  let difference = 0;
  for (let i = 0; i < receivedHash.length; i++) difference |= receivedHash[i] ^ expectedHash[i];
  return difference === 0;
}

function serviceAccountKey(pem) {
  const base64 = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function createSignedAssertion(env, now) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = encodeBase64Url(JSON.stringify({
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: FIRESTORE_SCOPE,
    aud: OAUTH_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsignedToken = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    serviceAccountKey(env.FIREBASE_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedToken),
  );
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${unsignedToken}.${encodedSignature}`;
}

async function accessToken(env, fetchImpl, now) {
  const currentTime = now.getTime();
  if (
    cachedAccessToken
    && cachedAccessToken.email === env.FIREBASE_CLIENT_EMAIL
    && cachedAccessToken.expiresAt > currentTime + 60000
  ) {
    return cachedAccessToken.value;
  }

  const assertion = await createSignedAssertion(env, now);
  const response = await fetchImpl(OAUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) {
    console.error('Falha ao obter token OAuth do Firebase:', response.status);
    throw new Error('Falha de autenticação com Firebase');
  }

  const result = await response.json();
  if (!result.access_token || !Number.isFinite(result.expires_in)) {
    throw new Error('Resposta OAuth inválida do Firebase');
  }
  cachedAccessToken = {
    email: env.FIREBASE_CLIENT_EMAIL,
    value: result.access_token,
    expiresAt: currentTime + result.expires_in * 1000,
  };
  return cachedAccessToken.value;
}

async function firestoreRequest(url, token, fetchImpl, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) {
    const details = await response.text();
    const error = new Error(`Firestore respondeu HTTP ${response.status}`);
    error.status = response.status;
    if (response.status !== 409) {
      console.error('Falha na API REST do Firestore:', response.status, details.slice(0, 500));
    }
    throw error;
  }
  return response;
}

async function findProduct(env, token, data, fetchImpl) {
  const url = `${FIRESTORE_BASE_URL}/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}`
    + '/databases/(default)/documents:runQuery';
  const query = {
    structuredQuery: {
      from: [{ collectionId: 'produtos' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'whatsapp' }, op: 'EQUAL', value: { booleanValue: true } } },
            { fieldFilter: { field: { fieldPath: 'linha' }, op: 'EQUAL', value: { stringValue: data.line } } },
            { fieldFilter: { field: { fieldPath: 'tamanho' }, op: 'EQUAL', value: { integerValue: String(data.size) } } },
          ],
        },
      },
      limit: 1,
    },
  };
  const response = await firestoreRequest(url, token, fetchImpl, {
    method: 'POST',
    body: JSON.stringify(query),
  });
  const results = await response.json();
  const document = results.find((result) => result.document)?.document;
  if (!document) return null;
  return {
    id: document.name.split('/').pop(),
    ...fromFirestoreFields(document.fields || {}),
  };
}

async function createSale(env, token, id, sale, entries, fetchImpl) {
  const url = `${FIRESTORE_BASE_URL}/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}`
    + `/databases/(default)/documents:commit`;
  const base = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const toFields = (data) => Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, firestoreValue(value)]),
  );
  // Um único commit atômico: a venda, a baixa de cada produto e o registro das movimentações
  // gravam juntos ou não gravam. A venda vem primeiro; se ela já existir (webhook repetido)
  // o commit inteiro falha com 409 e o estoque não é baixado duas vezes.
  const writes = [
    {
      update: { name: `${base}/vendas/${id}`, fields: toFields(sale) },
      currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: 'criadoEm', setToServerValue: 'REQUEST_TIME' }],
    },
  ];
  entries.forEach(({ product, quantity }, index) => {
    if (product.naoCadastrado) return;
    writes.push({
      transform: {
        document: `${base}/produtos/${product.id}`,
        fieldTransforms: [
          { fieldPath: 'estoque', increment: { integerValue: String(-quantity) } },
          { fieldPath: 'atualizadoEm', setToServerValue: 'REQUEST_TIME' },
        ],
      },
    });
    const movement = {
      prodId: product.id,
      prodNome: product.nome,
      tipo: 'venda',
      qtd: -quantity,
      motivo: `Venda para ${sale.cliente}`,
      usuario: 'WhatsApp',
      usuarioEmail: '',
      vendaId: id,
    };
    const movementId = entries.length === 1 ? `mv_${id}` : `mv_${id}_${index + 1}`;
    writes.push({
      update: { name: `${base}/movimentacoes/${movementId}`, fields: toFields(movement) },
      currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: 'criadoEm', setToServerValue: 'REQUEST_TIME' }],
    });
  });
  return firestoreRequest(url, token, fetchImpl, {
    method: 'POST',
    body: JSON.stringify({ writes }),
  });
}

async function readRequestBody(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 64 * 1024) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 64 * 1024) return null;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

export async function handleWebhook(request, env, dependencies = {}) {
  if (request.method !== 'POST') return json(405, { ok: false, erro: 'use POST' });

  let body;
  try {
    body = await readRequestBody(request);
  } catch {
    return json(400, { ok: false, erro: 'corpo da requisição inválido' });
  }
  if (body === null) return json(413, { ok: false, erro: 'corpo da requisição muito grande' });
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(400, { ok: false, erro: 'corpo da requisição inválido' });
  }

  const receivedToken = body.token || request.headers.get('x-webhook-token');
  if (!(await tokenMatches(receivedToken, env.WEBHOOK_TOKEN))) {
    return json(401, { ok: false, erro: 'token inválido' });
  }

  const { errors, data } = validatePayload(body);
  if (errors.length) return json(400, { ok: false, erro: errors.join('; ') });

  const requiredConfig = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
  ];
  const missingConfig = requiredConfig.filter((key) => !env[key]);
  if (missingConfig.length) {
    console.error('Configuração ausente no Cloudflare:', missingConfig.join(', '));
    return json(500, { ok: false, erro: 'webhook não configurado' });
  }

  const fetchImpl = dependencies.fetch || fetch;
  const now = dependencies.now || (() => new Date());

  try {
    const date = now();
    const token = await accessToken(env, fetchImpl, date);
    const entries = [];
    const unregistered = [];
    for (const item of data.items) {
      const product = await findProduct(env, token, item, fetchImpl);
      if (!product) {
        // Produto fora do cadastro: a venda é registrada mesmo assim, sem baixa de estoque.
        const entry = {
          product: {
            id: '',
            nome: `${item.line === 'frutifera' ? 'Frutífera Premium' : 'Turbinado'} ${item.size}kg`,
            icon: 'package',
            preco: 0,
            naoCadastrado: true,
          },
          quantity: item.quantity,
        };
        entries.push(entry);
        unregistered.push(entry);
        continue;
      }
      if (!(Number(product.preco) > 0)) {
        return json(422, { ok: false, erro: 'produto sem preço cadastrado' });
      }
      entries.push({ product, quantity: item.quantity });
    }

    if (unregistered.length) {
      // O valor vem do bot: total informado, menos o frete e menos os itens cadastrados,
      // dividido entre as unidades que não estão no cadastro.
      const knownSubtotal = entries
        .filter(({ product }) => !product.naoCadastrado)
        .reduce((sum, { product, quantity }) => sum + Number(product.preco) * quantity, 0);
      const units = unregistered.reduce((sum, { quantity }) => sum + quantity, 0);
      const remaining = data.declaredTotal == null
        ? 0
        : data.declaredTotal - (Number(data.shipping) || 0) - knownSubtotal;
      const unit = remaining > 0 ? Number((remaining / units).toFixed(2)) : 0;
      for (const entry of unregistered) {
        entry.product.preco = unit;
        entry.product.valorNaoInformado = unit === 0;
      }
    }

    const id = await saleId(data, entries, date);
    const sale = buildSale(entries, data, date);
    try {
      await createSale(env, token, id, sale, entries, fetchImpl);
    } catch (error) {
      if (error.status === 409) return json(200, { ok: true, duplicada: true, id });
      throw error;
    }
    return json(200, { ok: true, id, total: sale.total });
  } catch (error) {
    console.error('webhook-venda erro:', error.message);
    return json(500, { ok: false, erro: 'erro interno' });
  }
}
