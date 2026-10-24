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

function validatePayload(body) {
  const errors = [];
  const phone = onlyDigits(body.phone || body.whatsapp_number || body.telefone);
  if (phone.length < 10 || phone.length > 15) errors.push('telefone inválido');

  const client = String(body.cliente || body.name || body.nome || '').trim().slice(0, 80);
  if (!client) errors.push('nome do cliente ausente');

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

  const paymentText = normalizeText(body.pagamento);
  const payment = paymentText.includes('pix')
    ? 'PIX'
    : paymentText.includes('dinheiro') || paymentText.includes('especie')
      ? 'Dinheiro'
      : paymentText.includes('cart')
        ? 'Cartão'
        : paymentText.includes('prazo') || paymentText.includes('fiado')
          ? 'A prazo'
          : null;
  if (!payment) errors.push('forma de pagamento inválida');

  return {
    errors,
    data: { phone, client, line, size, quantity, payment },
  };
}

function localDate(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba' }).format(date);
}

function buildSale(product, data, date) {
  const unit = Number(product.preco);
  const cost = Number(product.custo) || 0;
  const subtotal = Number((data.quantity * unit).toFixed(2));
  return {
    data: localDate(date),
    itens: [{
      prodId: product.id,
      nome: product.nome,
      icon: product.icon || 'package',
      qtd: data.quantity,
      unit,
      custo: cost,
      subtotal,
    }],
    total: subtotal,
    cliente: data.client,
    telefone: data.phone,
    responsavel: 'WhatsApp',
    vendedor: 'WhatsApp',
    vendedorEmail: '',
    vendedorUid: '',
    pagamento: data.payment,
    obs: 'Venda via WhatsApp (Sendfy)',
    status: 'Confirmada',
    origem: 'whatsapp',
  };
}

async function saleId(data, productId, date) {
  const window = Math.floor(date.getTime() / 120000);
  const input = new TextEncoder().encode(
    [data.phone, productId, data.quantity, data.payment, window].join('|'),
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

async function createSale(env, token, id, sale, fetchImpl) {
  const url = `${FIRESTORE_BASE_URL}/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}`
    + `/databases/(default)/documents:commit`;
  const documentName = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/vendas/${id}`;
  return firestoreRequest(url, token, fetchImpl, {
    method: 'POST',
    body: JSON.stringify({
      writes: [{
        update: {
          name: documentName,
          fields: Object.fromEntries(
            Object.entries(sale).map(([key, value]) => [key, firestoreValue(value)]),
          ),
        },
        currentDocument: { exists: false },
        updateTransforms: [{ fieldPath: 'criadoEm', setToServerValue: 'REQUEST_TIME' }],
      }],
    }),
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
    const product = await findProduct(env, token, data, fetchImpl);
    if (!product) {
      return json(404, {
        ok: false,
        erro: `produto não encontrado: ${data.line} ${data.size}kg`,
      });
    }
    if (!(Number(product.preco) > 0)) {
      return json(422, { ok: false, erro: 'produto sem preço cadastrado' });
    }

    const id = await saleId(data, product.id, date);
    const sale = buildSale(product, data, date);
    try {
      await createSale(env, token, id, sale, fetchImpl);
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
