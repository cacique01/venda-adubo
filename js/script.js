// ── metas (vêm do Firestore: doc config/metas) ─────────────────────
// Somente leitura aqui; salvarMeta() grava no banco e o listener atualiza window._metas.
const metas = {
    get valor() { return window._metas?.valor || 0; },
    get unidades() { return window._metas?.unidades || 0; }
};

// Lista usada só na importação única para o Firestore (veja importarProdutosIniciais)
const PRODUTOS_PADRAO = [
    { id: 'dT1',  icon: 'sprout', nome: '1kg Turbinado Direto',    preco: 9 },
    { id: 'dT4',  icon: 'leaf', nome: '4kg Turbinado Direto',    preco: 25 },
    { id: 'cT1',  icon: 'sprout', nome: '1kg Turbinado Consignado',preco: 12 },
    { id: 'cT4',  icon: 'leaf', nome: '4kg Turbinado Consignado',preco: 20 },
    { id: 'dF1',  icon: 'citrus', nome: '1kg Frutífero Direto',    preco: 12 },
    { id: 'dF4',  icon: 'tree-pine', nome: '4kg Frutífero Direto',    preco: 7 },
    { id: 'cF1',  icon: 'citrus', nome: '1kg Frutífero Consignado',preco: 35 },
    { id: 'cF4',  icon: 'tree-pine', nome: '4kg Frutífero Consignado',preco: 20 },
    { id: 'p50',  icon: 'package', nome: '50kg Granel',             preco: 270 },
    { id: 'p100', icon: 'factory', nome: '100kg Granel',            preco: 400 },
];
const ICONES_LEGADOS = {
    '\u{1F331}': 'sprout', '\u{1F33F}': 'leaf', '\u{1F34A}': 'citrus',
    '\u{1F333}': 'tree-pine', '\u{1F4E6}': 'package', '\u{1F3ED}': 'factory'
};
const ICONES_VALIDOS = new Set([
    'sprout', 'leaf', 'citrus', 'tree-pine', 'package', 'factory', 'wallet', 'user-round',
    'credit-card', 'calendar-days', 'badge-dollar-sign', 'clipboard-list', 'circle-check',
    'receipt-text', 'pencil', 'circle-x', 'trash-2', 'save', 'file-text', 'file-spreadsheet', 'minus', 'plus',
    'gem', 'apple', 'flower-2', 'leafy-green', 'tree-deciduous'
]);
function normalizarIcone(icon) {
    const nome = ICONES_LEGADOS[icon] || icon;
    return ICONES_VALIDOS.has(nome) ? nome : 'package';
}
function iconeMarkup(icon, classe = 'ui-icon') {
    return `<i class="${classe}" data-lucide="${normalizarIcone(icon)}" aria-hidden="true"></i>`;
}
function renderizarIcones(root = document) {
    if (window.lucide) window.lucide.createIcons({ root });
}

const observadorIcones = new MutationObserver(registros => {
    const novosIcones = registros.some(registro => [...registro.addedNodes].some(node =>
        node.nodeType === 1 && (node.matches('i[data-lucide]') || node.querySelector('i[data-lucide]'))
    ));
    if (novosIcones) renderizarIcones();
});
// Observa mudanças no DOM para renderizar ícones adicionados dinamicamente
observadorIcones.observe(document.body, { childList: true, subtree: true });
renderizarIcones();

// Compat: objeto precos legado para não quebrar cálculos antigos
function getPrecosLegado() {
    const m = {};
    listaProdutos().forEach(p => { m[p.id] = p.preco; });
    return m;
}

let vendaPendente = null;
let editId = null;

// ── gastos variáveis ──────────────────────────────────────────────
function gastos() { return window._gastos || []; }

function gastosMes() {
    const mes = new Date().toISOString().slice(0, 7);
    return gastos().filter(g => g.data && g.data.startsWith(mes));
}

function totalGasto(lista) {
    return lista.reduce((s, g) => s + (parseFloat(g.valor) || 0) * (g.qtd || 1), 0);
}

function totalGastosMes() {
    return totalGasto(gastosMes());
}

window.renderGastos = function () {
    const lista = el('lista-gastos');
    if (!lista) return;
    const gMes = gastosMes();
    if (gMes.length === 0) {
        lista.innerHTML = '<p style="color:var(--cinza);font-size:13px;text-align:center;padding:30px 0">Nenhum gasto registrado este mês.</p>';
        el('gastos-total-mes').textContent = 'Total do mês: R$ 0,00';
        return;
    }
    lista.innerHTML = gMes.map(g => `
        <div class="gasto-item">
            <div class="gasto-info">
                <div class="gasto-nome">${iconeMarkup('wallet')} ${g.nome}</div>
                <div class="gasto-sub">${g.qtd || 1} × R$ ${parseFloat(g.valor || 0).toFixed(2)} · ${formatarData(g.data)}</div>
            </div>
            <div class="gasto-valor">R$ ${(parseFloat(g.valor || 0) * (g.qtd || 1)).toFixed(2)}</div>
            <button class="cart-rem" onclick="excluirGasto('${g._id}')" title="Remover">${iconeMarkup('circle-x')}</button>
        </div>
    `).join('');
    const total = gMes.reduce((s, g) => s + parseFloat(g.valor || 0) * (g.qtd || 1), 0);
    el('gastos-total-mes').textContent = `Total do mês: R$ ${total.toFixed(2)}`;
};

async function lancarGasto() {
    const nome = el('gasto-nome').value.trim();
    const qtd = parseFloat(el('gasto-qtd').value) || 1;
    const valor = parseFloat(el('gasto-valor').value) || 0;
    if (!nome) return toast('Informe o nome do gasto.', 'err');
    if (valor <= 0) return toast('Informe um valor válido.', 'err');
    const data = new Date().toISOString().slice(0, 10);
    try {
        await window._addDoc(window._colGastos, {
            nome, qtd, valor, data,
            criadoEm: window._serverTimestamp()
        });
        el('gasto-nome').value = '';
        el('gasto-qtd').value = '1';
        el('gasto-valor').value = '';
        toast('Gasto registrado.');
    } catch (e) {
        toast('Erro: ' + e.message, 'err');
    }
}

async function excluirGasto(id) {
    if (!confirm('Remover este gasto?')) return;
    try {
        const { deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        await deleteDoc(window._doc(window._db, 'gastos', id));
        toast('Gasto removido.', 'warn');
    } catch (e) { toast('Erro: ' + e.message, 'err'); }
}

// ── utils ─────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function vendas() { return window._vendas || []; }

function toast(msg, tipo = 'ok') {
    const t = el('toast');
    t.className = 'toast' + (tipo === 'err' ? ' err' : tipo === 'warn' ? ' warn' : '');
    t.innerHTML = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3800);
}

function formatarData(d) {
    if (!d) return '';
    const [y, m, dd] = d.split('-');
    return `${dd}/${m}/${y}`;
}

function produtoLabel(v) {
    if (!v || !v.tamanho) return '?kg';
    if (v.tamanho === 'outro') return (v.peso || '?') + 'kg';
    const prodSuffix = v.produto === 'turbinado' ? ' Turbinado' : v.produto === 'frutifero' ? ' Frutífero' : '';
    return v.tamanho + 'kg' + prodSuffix;
}

// ── relógio ───────────────────────────────────────────────────────
function tick() {
    el('relogio').textContent = new Date().toLocaleString('pt-BR',
        { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
tick(); setInterval(tick, 1000);

// ── tabs ─────────────────────────────────────────────────────────
// Abre/fecha menu de abas no mobile
function toggleLogoMenu() {
    const menu = el('logo-menu');
    const trigger = document.querySelector('.logo-menu-trigger');
    if (!menu || !trigger) return;
    const isOpen = menu.classList.toggle('open');
    trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function mudarTab(id, btn) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const menu = el('logo-menu');
    if (menu) menu.classList.remove('open');
    const trigger = document.querySelector('.logo-menu-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    el('tab-' + id).classList.add('active');
    const fns = { painel: renderPainel, historico: renderHistorico, semana: renderSemana, meta: renderMeta, estoque: renderEstoque, nova: renderGradeProdutos, gastos: renderGastos };
    if (fns[id]) fns[id]();
}

// ── carrinho ──────────────────────────────────────────────────────
// Cada item: { prodId, nome, icon, qtd, unit }
let carrinho = [];

function adicionarAoCarrinho(id) {
    const p = listaProdutos().find(x => x.id === id);
    if (!p) return;
    const existente = carrinho.find(x => x.prodId === id);
    if (existente) {
        existente.qtd += 1;
    } else {
        carrinho.push({ prodId: id, nome: p.nome, icon: p.icon, qtd: 1, unit: p.preco });
    }
    renderCarrinho();
    toast(`${p.nome} adicionado.`);
}

function alterarQtdCarrinho(id, delta) {
    const item = carrinho.find(x => x.prodId === id);
    if (!item) return;
    item.qtd = Math.max(1, item.qtd + delta);
    renderCarrinho();
}

function alterarUnitCarrinho(id, novoValor) {
    const item = carrinho.find(x => x.prodId === id);
    if (!item) return;
    item.unit = parseFloat(novoValor) || 0;
    renderCarrinho();
}

function removerDoCarrinho(id) {
    carrinho = carrinho.filter(x => x.prodId !== id);
    renderCarrinho();
}

function limparCarrinho() {
    carrinho = [];
    renderCarrinho();
}

function renderCarrinho() {
    const lista = el('lista-carrinho');
    const totalEl = el('carrinho-total');
    if (!lista) return;
    if (carrinho.length === 0) {
        lista.innerHTML = '<p style="color:var(--cinza);font-size:13px;text-align:center;padding:20px 0">Nenhum produto adicionado.</p>';
        if (totalEl) { totalEl.style.display = 'none'; totalEl.textContent = ''; }
        return;
    }
    const total = carrinho.reduce((s, i) => s + i.qtd * i.unit, 0);
    lista.innerHTML = carrinho.map(item => `
        <div class="cart-item">
            ${iconeMarkup(item.icon, 'cart-icon ui-icon')}
            <div class="cart-info">
                <div class="cart-nome">${item.nome}</div>
                <div class="cart-preco">R$ ${item.unit.toFixed(2)} cada ·
                    <input class="cart-unit-input" type="number" step="0.01" min="0"
                        value="${item.unit.toFixed(2)}"
                        onchange="alterarUnitCarrinho('${item.prodId}', this.value)"
                        title="Alterar preço">
                </div>
            </div>
            <div class="cart-qty">
                <button class="qty-btn" onclick="alterarQtdCarrinho('${item.prodId}', -1)" title="Diminuir">${iconeMarkup('minus')}</button>
                <span>${item.qtd}</span>
                <button class="qty-btn" onclick="alterarQtdCarrinho('${item.prodId}', 1)" title="Aumentar">${iconeMarkup('plus')}</button>
            </div>
            <div class="cart-sub">R$ ${(item.qtd * item.unit).toFixed(2)}</div>
            <button class="cart-rem" onclick="removerDoCarrinho('${item.prodId}')" title="Remover">${iconeMarkup('circle-x')}</button>
        </div>
    `).join('');
    if (totalEl) {
        totalEl.style.display = 'block';
        totalEl.innerHTML = `Total: <strong>R$ ${total.toFixed(2)}</strong>`;
    }
}

// ── grade de produtos (aba Venda) ─────────────────────────────────
function renderGradeProdutos() {
    const grade = el('grade-produtos');
    if (!grade) return;
    if (listaProdutos().length === 0) {
        grade.innerHTML = '<p style="color:var(--cinza);font-size:13px;text-align:center;padding:20px 0">Nenhum produto cadastrado. Acesse <strong>Estoque</strong> para adicionar.</p>';
        return;
    }
    grade.innerHTML = listaProdutos().map(p => `
        <div class="prod-card" data-id="${p.id}" onclick="adicionarAoCarrinho('${p.id}')">
            ${iconeMarkup(p.icon, 'pc-icon ui-icon')}
            <span class="pc-nome">${p.nome}</span>
            <span class="pc-preco">R$ ${parseFloat(p.preco).toFixed(2)}</span>
            <span class="pc-estoque ${nEstoque(p) <= 0 ? 'zerado' : ''}">Estoque: ${nEstoque(p)}</span>
        </div>
    `).join('');
}

// ── form nova venda ───────────────────────────────────────────────
function limparForm() {
    ['cliente', 'telefone', 'obs'].forEach(id => { if (el(id)) el(id).value = ''; });
    limparCarrinho();
}

function lancarVenda() {
    if (carrinho.length === 0) return toast('Adicione pelo menos um produto ao carrinho.', 'err');
    const data = el('data-venda').value;
    const cli = el('cliente').value.trim() || 'Não informado';
    const telefone = (el('telefone')?.value || '').replace(/\D/g, '');
    const pgto = el('pagamento').value;
    const obs = el('obs').value.trim();
    if (!data) return toast('Informe a data da venda.', 'err');

    const total = +(carrinho.reduce((s, i) => s + i.qtd * i.unit, 0).toFixed(2));
    const itens = carrinho.map(i => ({
        prodId: i.prodId, nome: i.nome, icon: i.icon, qtd: i.qtd, unit: i.unit,
        subtotal: +(i.qtd * i.unit).toFixed(2)
    }));

    const usuario = window._auth?.currentUser;
    if (!usuario?.email) return toast('Faça login para identificar o vendedor e lançar a venda.', 'err');
    const vendedor = window._resolverVendedor({ vendedorEmail: usuario.email });

    vendaPendente = {
        data, itens, total, cliente: cli, telefone, responsavel: vendedor, vendedor,
        vendedorEmail: usuario.email, vendedorUid: usuario.uid,
        pagamento: pgto, obs, status: 'Confirmada'
    };

    el('modal-detail').innerHTML = `
        <p>${iconeMarkup('user-round')} Cliente: <span>${cli}</span></p>
        <p>${iconeMarkup('user-round')} Vendedor: <span>${vendedor}</span></p>
        <p>${iconeMarkup('credit-card')} Pagamento: <span>${pgto}</span></p>
        <p>${iconeMarkup('calendar-days')} Data: <span>${formatarData(data)}</span></p>
        <div style="margin:10px 0;padding:10px;background:rgba(255,255,255,.05);border-radius:8px;font-size:13px">
            ${itens.map(i => `<div style="display:flex;justify-content:space-between;padding:3px 0">
                <span>${iconeMarkup(i.icon)} ${i.nome} × ${i.qtd}</span>
                <strong>R$ ${i.subtotal.toFixed(2)}</strong>
            </div>`).join('')}
        </div>
        <p>${iconeMarkup('badge-dollar-sign')} Total: <span style="color:var(--neon);font-weight:800;font-size:17px">R$ ${total.toFixed(2)}</span></p>
        ${obs ? `<p>${iconeMarkup('clipboard-list')} Obs: <span>${obs}</span></p>` : ''}
    `;
    el('modal-bg').classList.add('open');
}

function fecharModal() { el('modal-bg').classList.remove('open'); vendaPendente = null; }

async function confirmarVenda() {
    if (!vendaPendente) return;
    const fs = window._fs, db = window._db;
    const itensComProduto = vendaPendente.itens
        .map(i => ({ item: i, prod: listaProdutos().find(p => p.id === i.prodId) }))
        .filter(x => x.prod);

    // avisa se o saldo não cobre a venda (permite vender mesmo assim)
    const faltando = itensComProduto.filter(x => nEstoque(x.prod) < x.item.qtd);
    if (faltando.length) {
        const txt = faltando.map(x => `• ${x.prod.nome}: saldo ${nEstoque(x.prod)}, venda ${x.item.qtd}`).join('\n');
        if (!confirm(`Estoque insuficiente:\n${txt}\n\nLançar a venda mesmo assim? O saldo ficará negativo.`)) return;
    }

    try {
        // Tudo em um único batch: a venda e a baixa de estoque gravam juntas ou não gravam.
        const batch = fs.writeBatch(db);
        const vendaRef = fs.doc(window._col);
        batch.set(vendaRef, { ...vendaPendente, estoqueBaixado: true, criadoEm: fs.serverTimestamp() });
        itensComProduto.forEach(({ item, prod }) => {
            baixarEstoque(batch, prod, -item.qtd);
            registrarMov(batch, prod, 'venda', -item.qtd, `Venda para ${vendaPendente.cliente}`, {
                vendaId: vendaRef.id, saldoApos: nEstoque(prod) - item.qtd
            });
        });
        await batch.commit();
        fecharModal();
        limparForm();
        toast('Venda lançada e estoque atualizado.');
    } catch (e) {
        toast('Erro ao salvar: ' + e.message, 'err');
    }
}

// ── cancelar / editar ─────────────────────────────────────────────
async function cancelarVenda(id) {
    const v = vendas().find(x => x._id === id);
    if (!v || v.status === 'Cancelada') return;
    if (!confirm('Cancelar esta venda?' + (v.estoqueBaixado ? ' Os produtos voltam para o estoque.' : ''))) return;
    const fs = window._fs, db = window._db;
    try {
        const batch = fs.writeBatch(db);
        batch.update(fs.doc(db, 'vendas', id), { status: 'Cancelada' });
        // Só devolve ao estoque vendas que tiveram baixa (as anteriores ao controle de estoque não tiveram)
        if (v.estoqueBaixado) {
            (v.itens || []).forEach(i => {
                const prod = listaProdutos().find(p => p.id === i.prodId);
                if (!prod) return;
                baixarEstoque(batch, prod, i.qtd);
                registrarMov(batch, prod, 'cancelamento', i.qtd, `Venda cancelada (${v.cliente || 'cliente'})`, {
                    vendaId: id, saldoApos: nEstoque(prod) + i.qtd
                });
            });
        }
        await batch.commit();
        toast('Venda cancelada.', 'warn');
    } catch (e) { toast('Erro: ' + e.message, 'err'); }
}

function abrirEdit(id) {
    const v = vendas().find(x => x._id === id);
    if (!v) return;
    editId = id;
    el('edit-qtd').value = v.qtd;
    el('edit-valor').value = v.unit;
    el('edit-cliente').value = v.cliente;
    el('edit-telefone').value = v.telefone || '';
    el('edit-pgto').value = v.pagamento;
    el('edit-obs').value = v.obs || '';
    el('modal-edit-bg').classList.add('open');
}

function fecharEdit() { el('modal-edit-bg').classList.remove('open'); editId = null; }

async function salvarEdicao() {
    if (!editId) return;
    const qtd = parseInt(el('edit-qtd').value);
    const unit = parseFloat(el('edit-valor').value);
    try {
        await window._updateDoc(window._doc(window._db, 'vendas', editId), {
            qtd, unit, total: +(qtd * unit).toFixed(2),
            cliente: el('edit-cliente').value,
            telefone: el('edit-telefone').value.replace(/\D/g, ''),
            pagamento: el('edit-pgto').value,
            obs: el('edit-obs').value
        });
        fecharEdit(); toast('Venda editada.');
    } catch (e) { toast('Erro: ' + e.message, 'err'); }
}

// ── helper: compatibilidade com vendas antigas e novas ────────────
function vendaItens(v) {
    if (v.itens && v.itens.length > 0) return v.itens;
    // venda legada (campo único)
    return [{ nome: produtoLabel(v), icon: 'package', qtd: v.qtd || 1, unit: v.unit || 0, subtotal: v.total || 0 }];
}

function qtdVenda(v) {
    return vendaItens(v).reduce((s, i) => s + i.qtd, 0);
}

// ── painel ────────────────────────────────────────────────────────
window.renderPainel = function () {
    const mes = new Date().toISOString().slice(0, 7);
    const vMes = vendas().filter(v => v.data && v.data.startsWith(mes) && v.status !== 'Cancelada');
    const fat = vMes.reduce((s, v) => s + v.total, 0);
    const unid = vMes.reduce((s, v) => s + qtdVenda(v), 0);
    // Lucro líquido = lucro das vendas (faturamento) − gastos da empresa. O custo do produto não entra.
    const totalGastos = totalGastosMes();
    const lucro = fat - totalGastos;

    el('cards-painel').innerHTML = `
    <div class="card"><div class="card-label">Faturamento do Mês</div><div class="card-val">R$ ${fat.toFixed(2)}</div><div class="card-sub">${vMes.length} venda(s)</div></div>
    <div class="card"><div class="card-label">Unidades Vendidas</div><div class="card-val">${unid}</div><div class="card-sub">este mês</div></div>
    <div class="card"><div class="card-label">Gastos Variáveis</div><div class="card-val" style="color:var(--vermelho)">- R$ ${totalGastos.toFixed(2)}</div><div class="card-sub">este mês</div></div>
    <div class="card"><div class="card-label">Lucro Líquido</div><div class="card-val" style="color:${lucro >= 0 ? 'var(--neon)' : 'var(--vermelho)'}">R$ ${lucro.toFixed(2)}</div><div class="card-sub">vendas − gastos do mês</div></div>
  `;

    const pct = metas.valor > 0 ? Math.min((fat / metas.valor) * 100, 100) : 0;
    el('meta-painel').innerHTML = metas.valor > 0
        ? `<p style="font-size:13px;color:var(--cinza);margin-bottom:6px">Meta: <strong style="color:#fff">R$ ${metas.valor.toFixed(2)}</strong> — Atingido: <strong style="color:var(--neon)">R$ ${fat.toFixed(2)}</strong> (${pct.toFixed(1)}%)</p>
       <div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div>
    <p style="font-size:12px;color:var(--cinza);margin-top:6px">${pct >= 100 ? `${iconeMarkup('circle-check')} Meta atingida!` : `Faltam R$ ${(metas.valor - fat).toFixed(2)}`}</p>`
        : `<p style="color:var(--cinza);font-size:13px">Nenhuma meta definida. Acesse <strong>Metas</strong> para configurar.</p>`;

    el('tbl-recentes').innerHTML = vendas().slice(0, 8).map(v => {
        const itens = vendaItens(v);
        const label = itens.length > 1 ? `${itens.length} produtos` : (itens[0]?.nome || produtoLabel(v));
        return `<tr>
        <td>${formatarData(v.data)}</td><td>${label}</td><td>${qtdVenda(v)}</td>
        <td><strong>R$ ${v.total.toFixed(2)}</strong></td>
        <td><span class="badge ${(v.status || 'Confirmada') === 'Confirmada' ? 'badge-ok' : 'badge-cancel'}">${v.status || 'Confirmada'}</span></td>
    </tr>`;
    }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--cinza);padding:20px">Nenhuma venda registrada.</td></tr>';
};

// ── histórico ─────────────────────────────────────────────────────
window.renderHistorico = function () {
    const mes = el('filtro-mes')?.value;
    const lista = mes ? vendas().filter(v => v.data && v.data.startsWith(mes)) : vendas();
    el('tbl-historico').innerHTML = lista.length
        ? lista.map((v, i) => {
            const itens = vendaItens(v);
            const label = itens.length > 1
                ? itens.map(it => `${it.nome} ×${it.qtd}`).join(', ')
                : (itens[0]?.nome || produtoLabel(v));
            return `<tr>
            <td>${i + 1}</td><td>${formatarData(v.data)}</td><td>${v.cliente || '–'}</td>
            <td>${v.telefone || '–'}</td>
            <td>${window._resolverVendedor(v)}</td>
            <td style="max-width:200px;white-space:normal;font-size:12px">${label}</td>
            <td>${qtdVenda(v)}</td>
            <td><strong>R$ ${v.total.toFixed(2)}</strong></td>
            <td>${v.pagamento || '–'}</td>
            <td><span class="badge ${(v.status || 'Confirmada') === 'Confirmada' ? 'badge-ok' : 'badge-cancel'}">${v.status || 'Confirmada'}</span></td>
            <td><div class="btn-row">
                <button class="btn btn-info btn-sm" onclick="abrirNF('${v._id}')" title="Nota Fiscal">${iconeMarkup('receipt-text')}</button>
                ${(v.status || 'Confirmada') !== 'Cancelada'
                    ? `<button class="btn btn-warn btn-sm" onclick="abrirEdit('${v._id}')" title="Editar">${iconeMarkup('pencil')}</button>
                <button class="btn btn-danger btn-sm" onclick="cancelarVenda('${v._id}')" title="Cancelar">${iconeMarkup('circle-x')}</button>`
                    : ''}
            </div></td>
        </tr>`;
        }).join('')
        : '<tr><td colspan="10" style="text-align:center;color:var(--cinza);padding:20px">Nenhuma venda encontrada.</td></tr>';
};

// ── semana ────────────────────────────────────────────────────────
window.renderSemana = function () {
    const hoje = new Date().toISOString().slice(0, 10);
    const dom = new Date(hoje + 'T12:00:00');
    dom.setDate(dom.getDate() - dom.getDay());
    const dias = Array.from({ length: 7 }, (_, i) => { const d = new Date(dom); d.setDate(dom.getDate() + i); return d.toISOString().slice(0, 10); });
    const nomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const vSem = vendas().filter(v => v.data && dias.includes(v.data) && v.status !== 'Cancelada');

    const fat = vSem.reduce((s, v) => s + v.total, 0);
    const unid = vSem.reduce((s, v) => s + qtdVenda(v), 0);
    const gastosSem = totalGasto(gastos().filter(g => dias.includes(g.data)));
    const lucro = fat - gastosSem;

    el('cards-semana').innerHTML = `
    <div class="card"><div class="card-label">Faturamento Semanal</div><div class="card-val">R$ ${fat.toFixed(2)}</div></div>
    <div class="card"><div class="card-label">Unidades na Semana</div><div class="card-val">${unid}</div></div>
    <div class="card"><div class="card-label">Lucro Líquido Semanal</div><div class="card-val" style="color:${lucro >= 0 ? 'var(--neon)' : 'var(--vermelho)'}">R$ ${lucro.toFixed(2)}</div><div class="card-sub">vendas − gastos da semana (R$ ${gastosSem.toFixed(2)})</div></div>
  `;

    el('week-grid').innerHTML = dias.map((d, i) => {
        const vDia = vSem.filter(v => v.data === d).reduce((s, v) => s + v.total, 0);
        return `<div class="day-card ${d === hoje ? 'today' : ''}">
      <div class="day-name">${nomes[i]}</div>
      <div class="day-val">R$${vDia.toFixed(0)}</div>
      <div class="card-sub">${new Date(d + 'T12:00:00').getDate()}/${new Date(d + 'T12:00:00').getMonth() + 1}</div>
    </div>`;
    }).join('');

    el('tbl-semana').innerHTML = vSem.length
        ? vSem.map(v => {
            const itens = vendaItens(v);
            const label = itens.length > 1 ? `${itens.length} produtos` : (itens[0]?.nome || produtoLabel(v));
            return `<tr>
            <td>${formatarData(v.data)}</td><td>${v.cliente || '–'}</td>
            <td>${label}</td><td>${qtdVenda(v)}</td>
            <td><strong>R$ ${v.total.toFixed(2)}</strong></td>
            <td><span class="badge ${(v.status || 'Confirmada') === 'Confirmada' ? 'badge-ok' : 'badge-cancel'}">${v.status || 'Confirmada'}</span></td>
        </tr>`;
        }).join('')
        : '<tr><td colspan="6" style="text-align:center;color:var(--cinza);padding:20px">Nenhuma venda esta semana.</td></tr>';

    const dp = dias.indexOf(hoje) + 1;
    const dr = 7 - dp;
    const fatMes = vendas().filter(v => v.data && v.data.startsWith(new Date().toISOString().slice(0, 7)) && v.status !== 'Cancelada').reduce((s, v) => s + v.total, 0);
    if (metas.valor > 0 && fat > 0 && dr > 0) {
        const med = fat / dp; const proj = fat + med * dr; const falta = metas.valor - fatMes;
        el('previsao-meta').innerHTML = `
      <p style="font-size:14px;color:var(--cinza)">Média diária: <strong style="color:#fff">R$ ${med.toFixed(2)}/dia</strong></p>
      <p style="font-size:14px;color:var(--cinza);margin-top:8px">Projeção fim da semana: <strong style="color:var(--neon)">R$ ${proj.toFixed(2)}</strong></p>
    ${falta > 0 ? `<p style="font-size:14px;color:var(--cinza);margin-top:8px">Faltam <strong style="color:var(--amarelo)">R$ ${falta.toFixed(2)}</strong> para bater a meta mensal.</p>` : `<p style="color:var(--neon);margin-top:8px">${iconeMarkup('circle-check')} Meta mensal atingida!</p>`}
    `;
    } else {
        el('previsao-meta').innerHTML = `<p style="color:var(--cinza);font-size:13px">Defina uma meta mensal para ver a previsão.</p>`;
    }
};

// ── metas ─────────────────────────────────────────────────────────
async function salvarMeta() {
    const valor = parseFloat(el('meta-valor').value) || 0;
    const unidades = parseInt(el('meta-unidades').value) || 0;
    const fs = window._fs;
    try {
        await fs.setDoc(fs.doc(window._db, 'config', 'metas'), {
            valor, unidades, atualizadoEm: fs.serverTimestamp(), atualizadoPor: window._usuarioEmail || ''
        });
        toast('Meta salva no banco de dados.');
    } catch (e) { toast('Erro ao salvar meta: ' + e.message, 'err'); }
}

// Migração única: se existir meta salva só neste aparelho e o banco ainda não tem, envia para o Firestore
window.migrarMetasLocais = async function () {
    if (!window._metasCarregadas || window._metasExistem || window._migrandoMetas) return;
    let local = null;
    try { local = JSON.parse(localStorage.getItem('gg_metas') || 'null'); } catch (e) { /* ignora */ }
    if (!local || !(Number(local.valor) > 0 || Number(local.unidades) > 0)) return;
    window._migrandoMetas = true;
    try {
        const fs = window._fs;
        await fs.setDoc(fs.doc(window._db, 'config', 'metas'), {
            valor: Number(local.valor) || 0, unidades: Number(local.unidades) || 0,
            atualizadoEm: fs.serverTimestamp(), atualizadoPor: window._usuarioEmail || ''
        });
        localStorage.removeItem('gg_metas');
    } catch (e) { console.warn('Não foi possível migrar as metas locais:', e.message); }
    finally { window._migrandoMetas = false; }
};

window.renderMeta = function () {
    if (el('meta-valor')) el('meta-valor').value = metas.valor || '';
    if (el('meta-unidades')) el('meta-unidades').value = metas.unidades || '';
    const mes = new Date().toISOString().slice(0, 7);
    const vMes = vendas().filter(v => v.data && v.data.startsWith(mes) && v.status !== 'Cancelada');
    const fat = vMes.reduce((s, v) => s + v.total, 0);
    const unid = vMes.reduce((s, v) => s + qtdVenda(v), 0);
    const pctF = metas.valor > 0 ? Math.min((fat / metas.valor) * 100, 100) : 0;
    const pctU = metas.unidades > 0 ? Math.min((unid / metas.unidades) * 100, 100) : 0;

    el('progresso-mes').innerHTML = `
    <p style="font-size:13px;color:var(--cinza);margin-bottom:6px">Faturamento: <strong style="color:#fff">R$ ${fat.toFixed(2)}</strong> / R$ ${(metas.valor || 0).toFixed(2)} (${pctF.toFixed(1)}%)</p>
    <div class="prog-bar"><div class="prog-fill" style="width:${pctF}%"></div></div>
    <p style="font-size:13px;color:var(--cinza);margin:14px 0 6px">Unidades: <strong style="color:#fff">${unid}</strong> / ${metas.unidades || 0} (${pctU.toFixed(1)}%)</p>
    <div class="prog-bar"><div class="prog-fill" style="width:${pctU}%"></div></div>
  `;

    const faltaVal = Math.max((metas.valor || 0) - fat, 0);
    const faltaUni = Math.max((metas.unidades || 0) - unid, 0);
    const medP = listaProdutos().length > 0 ? listaProdutos().reduce((s, p) => s + p.preco, 0) / listaProdutos().length : 15;
    el('previsao-geral').innerHTML = metas.valor > 0
        ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="meta-box"><strong>${iconeMarkup('badge-dollar-sign')} Para bater a meta de faturamento</strong>
          <p>Faltam <strong style="color:var(--neon)">R$ ${faltaVal.toFixed(2)}</strong></p>
          <p>≈ <strong style="color:var(--neon)">${Math.ceil(faltaVal / medP)} unidade(s)</strong> ao preço médio</p>
        </div>
        <div class="meta-box"><strong>${iconeMarkup('package')} Para bater a meta de unidades</strong>
          <p>Faltam <strong style="color:var(--neon)">${faltaUni} unidade(s)</strong></p>
        </div>
      </div>`
        : '<p style="color:var(--cinza);font-size:13px">Defina sua meta acima.</p>';
};

// ── produtos e estoque (tudo no Firestore) ───────────────────────
// Coleções: "produtos" (cadastro + saldo `estoque`) e "movimentacoes" (histórico).
function listaProdutos() { return window._produtos || []; }
function ehAdmin() { return !!window._usuarioAdmin; }
function nEstoque(p) { return Number(p.estoque) || 0; }

function esc(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function statusEstoque(p) {
    const q = nEstoque(p), min = Number(p.estoqueMinimo) || 0;
    if (q < 0) return { cls: 'badge-cancel', txt: 'Negativo' };
    if (q === 0) return { cls: 'badge-cancel', txt: 'Zerado' };
    if (min > 0 && q <= min) return { cls: 'badge-warn', txt: 'Baixo' };
    return { cls: 'badge-ok', txt: 'Em estoque' };
}

// Monta (sem gravar) o documento de movimentação dentro de um batch
function registrarMov(batch, p, tipo, delta, motivo, extra = {}) {
    const fs = window._fs;
    batch.set(fs.doc(fs.collection(window._db, 'movimentacoes')), {
        prodId: p.id, prodNome: p.nome, tipo, qtd: delta, motivo: motivo || '',
        usuario: window._usuarioNome || '', usuarioEmail: window._usuarioEmail || '',
        criadoEm: fs.serverTimestamp(), ...extra
    });
}

function baixarEstoque(batch, p, delta) {
    const fs = window._fs;
    batch.update(fs.doc(window._db, 'produtos', p.id), {
        estoque: fs.increment(delta), atualizadoEm: fs.serverTimestamp()
    });
}

const ROTULO_MOV = { entrada: 'Entrada', saida: 'Saída', ajuste: 'Ajuste', venda: 'Venda', cancelamento: 'Cancelamento' };

function formatarDataHora(ts) {
    const d = ts && ts.toDate ? ts.toDate() : null;
    return d ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'agora';
}

window.renderEstoque = function () {
    const lista = el('lista-estoque');
    if (!lista) return;
    const prods = listaProdutos();
    const admin = ehAdmin();

    // cards-resumo
    const unidades = prods.reduce((s, p) => s + Math.max(nEstoque(p), 0), 0);
    const valorEstoque = prods.reduce((s, p) => s + Math.max(nEstoque(p), 0) * (Number(p.preco) || 0), 0);
    const alertas = prods.filter(p => ['Baixo', 'Zerado', 'Negativo'].includes(statusEstoque(p).txt)).length;
    el('cards-estoque').innerHTML = `
    <div class="card"><div class="card-label">Produtos</div><div class="card-val">${prods.length}</div><div class="card-sub">cadastrados</div></div>
    <div class="card"><div class="card-label">Unidades em Estoque</div><div class="card-val">${unidades}</div><div class="card-sub">saldo atual</div></div>
    <div class="card"><div class="card-label">Valor em Estoque</div><div class="card-val">R$ ${valorEstoque.toFixed(2)}</div><div class="card-sub">a preço de venda</div></div>
    <div class="card"><div class="card-label">Atenção</div><div class="card-val" style="color:${alertas ? 'var(--amarelo)' : 'var(--neon)'}">${alertas}</div><div class="card-sub">baixo / zerado</div></div>`;

    // botão novo produto e importação (só admin)
    el('btn-novo-produto').style.display = admin ? '' : 'none';
    el('estoque-importar').style.display = (admin && window._produtosCarregados && prods.length === 0) ? 'block' : 'none';

    if (prods.length === 0) {
        lista.innerHTML = `<p style="color:var(--cinza);font-size:13px;text-align:center;padding:30px 0">${window._produtosCarregados ? 'Nenhum produto cadastrado ainda.' : 'Carregando produtos...'}</p>`;
    } else {
        lista.innerHTML = prods.map(p => {
            const st = statusEstoque(p);
            return `
        <div class="predef-item">
            ${iconeMarkup(p.icon, 'predef-icon ui-icon')}
            <div class="predef-info">
                <div class="predef-nome">${esc(p.nome)}</div>
                <div class="predef-sub">Preço: <strong>R$ ${(Number(p.preco) || 0).toFixed(2)}</strong> ${p.whatsapp ? ' · WhatsApp' : ''}${Number(p.estoqueMinimo) > 0 ? ' · Mín: ' + Number(p.estoqueMinimo) : ''}</div>
            </div>
            <div class="estoque-saldo"><strong>${nEstoque(p)}</strong><span class="badge ${st.cls}">${st.txt}</span></div>
            <div class="predef-acoes">
                <button class="btn btn-info btn-sm" onclick="abrirMov('${p.id}')" title="Movimentar estoque">${iconeMarkup('plus')}${iconeMarkup('minus')}</button>
                ${admin ? `<button class="btn btn-warn btn-sm" onclick="abrirFormProduto('${p.id}')" title="Editar">${iconeMarkup('pencil')}</button>
                <button class="btn btn-danger btn-sm" onclick="excluirProduto('${p.id}')" title="Excluir">${iconeMarkup('trash-2')}</button>` : ''}
            </div>
        </div>`;
        }).join('');
    }

    // histórico de movimentações
    const movs = window._movs || [];
    el('lista-movs').innerHTML = movs.length ? movs.map(m => {
        const delta = Number(m.qtd) || 0;
        return `
        <div class="predef-item mov-item">
            <div class="predef-info">
                <div class="predef-nome">${esc(m.prodNome)}</div>
                <div class="predef-sub">${ROTULO_MOV[m.tipo] || esc(m.tipo)} · ${formatarDataHora(m.criadoEm)} · ${esc(m.usuario || 'sistema')}${m.motivo ? ' · ' + esc(m.motivo) : ''}</div>
            </div>
            <div class="mov-delta ${delta >= 0 ? 'mov-pos' : 'mov-neg'}">${delta >= 0 ? '+' : ''}${delta}</div>
        </div>`;
    }).join('') : '<p style="color:var(--cinza);font-size:13px;text-align:center;padding:20px 0">Nenhuma movimentação registrada.</p>';
};

// ── cadastro de produto (admin) ──────────────────────────────────
function alternarCamposWhatsApp() {
    const sim = el('prod-whatsapp').value === 'sim';
    el('fg-prod-linha').style.display = sim ? '' : 'none';
    el('fg-prod-tamanho').style.display = sim ? '' : 'none';
}

function abrirFormProduto(id) {
    if (!ehAdmin()) return toast('Só administradores editam o cadastro de produtos.', 'err');
    const isEdicao = !!id;
    el('modal-produto-titulo').innerHTML = isEdicao
        ? `${iconeMarkup('pencil')} Editar Produto`
        : `${iconeMarkup('package')} Novo Produto`;
    el('prod-edit-id').value = id || '';
    el('fg-prod-estoque').style.display = isEdicao ? 'none' : '';
    const p = isEdicao ? listaProdutos().find(x => x.id === id) : null;
    if (isEdicao && !p) return;
    el('prod-nome').value = p ? p.nome : '';
    el('prod-icon').value = normalizarIcone(p ? p.icon : 'package');
    el('prod-preco').value = p ? p.preco : '';
    el('prod-estoque').value = '';
    el('prod-minimo').value = p && p.estoqueMinimo ? p.estoqueMinimo : '';
    el('prod-whatsapp').value = p && p.whatsapp ? 'sim' : 'nao';
    el('prod-linha').value = p && p.linha ? p.linha : 'turbinado';
    el('prod-tamanho').value = p && p.tamanho ? p.tamanho : '';
    alternarCamposWhatsApp();
    el('modal-produto-bg').classList.add('open');
}

function fecharFormProduto() {
    el('modal-produto-bg').classList.remove('open');
}

async function salvarProduto() {
    if (!ehAdmin()) return toast('Sem permissão.', 'err');
    const fs = window._fs, db = window._db;
    const nome = el('prod-nome').value.trim();
    const icon = normalizarIcone(el('prod-icon').value);
    const preco = parseFloat(el('prod-preco').value) || 0;
    const estoqueMinimo = Math.max(parseInt(el('prod-minimo').value) || 0, 0);
    const whatsapp = el('prod-whatsapp').value === 'sim';
    const linha = whatsapp ? el('prod-linha').value : null;
    const tamanho = whatsapp ? (parseInt(el('prod-tamanho').value) || 0) : null;
    if (!nome) return toast('Informe o nome do produto.', 'err');
    if (preco <= 0) return toast('Informe um preço válido.', 'err');
    if (whatsapp && tamanho < 1) return toast('Informe o tamanho (kg) para vender pelo WhatsApp.', 'err');

    const dados = { nome, icon, preco, estoqueMinimo, whatsapp, linha, tamanho, atualizadoEm: fs.serverTimestamp() };
    const idEdicao = el('prod-edit-id').value;
    const btn = el('btn-salvar-produto');
    btn.disabled = true;
    try {
        if (idEdicao) {
            await fs.updateDoc(fs.doc(db, 'produtos', idEdicao), dados);
        } else {
            const inicial = Math.max(parseInt(el('prod-estoque').value) || 0, 0);
            const batch = fs.writeBatch(db);
            const ref = fs.doc(fs.collection(db, 'produtos'));
            batch.set(ref, { ...dados, estoque: inicial, criadoEm: fs.serverTimestamp() });
            if (inicial > 0) registrarMov(batch, { id: ref.id, nome }, 'entrada', inicial, 'Estoque inicial', { saldoApos: inicial });
            await batch.commit();
        }
        fecharFormProduto();
        toast('Produto salvo no banco de dados.');
    } catch (e) {
        toast('Erro ao salvar: ' + e.message, 'err');
    } finally {
        btn.disabled = false;
    }
}

async function excluirProduto(id) {
    if (!ehAdmin()) return toast('Sem permissão.', 'err');
    const p = listaProdutos().find(x => x.id === id);
    if (!p) return;
    if (!confirm(`Excluir "${p.nome}"? As vendas antigas continuam no histórico.`)) return;
    try {
        await window._fs.deleteDoc(window._fs.doc(window._db, 'produtos', id));
        toast('Produto removido.', 'warn');
    } catch (e) { toast('Erro: ' + e.message, 'err'); }
}

// Migração única: leva a lista antiga (localStorage ou padrão) para o Firestore
async function importarProdutosIniciais() {
    if (!ehAdmin()) return toast('Sem permissão.', 'err');
    let origem = PRODUTOS_PADRAO, rotulo = 'lista padrão';
    try {
        const local = JSON.parse(localStorage.getItem('gg_produtos') || 'null');
        if (Array.isArray(local) && local.length) { origem = local; rotulo = 'lista deste aparelho'; }
    } catch (e) { /* usa a padrão */ }
    if (!confirm(`Importar ${origem.length} produtos (${rotulo}) para o banco de dados? O estoque de cada um começa em 0.`)) return;
    const fs = window._fs, db = window._db;
    try {
        const batch = fs.writeBatch(db);
        origem.forEach(p => {
            batch.set(fs.doc(db, 'produtos', String(p.id)), {
                nome: p.nome, icon: normalizarIcone(p.icon),
                preco: Number(p.preco) || 0,
                estoque: 0, estoqueMinimo: 0, whatsapp: false,
                criadoEm: fs.serverTimestamp(), atualizadoEm: fs.serverTimestamp()
            });
        });
        await batch.commit();
        try { localStorage.removeItem('gg_produtos'); } catch (e) { /* ok */ }
        toast('Produtos importados. Agora registre as entradas de estoque.');
    } catch (e) { toast('Erro ao importar: ' + e.message, 'err'); }
}

// ── movimentação manual de estoque ───────────────────────────────
function atualizarRotuloMov() {
    el('mov-qtd-label').textContent = el('mov-tipo').value === 'ajuste' ? 'Novo saldo (contagem)' : 'Quantidade';
}

function abrirMov(id) {
    const p = listaProdutos().find(x => x.id === id);
    if (!p) return;
    el('mov-prod-id').value = id;
    el('mov-produto-info').innerHTML = `<strong style="color:#fff">${esc(p.nome)}</strong> · saldo atual: <strong style="color:var(--neon)">${nEstoque(p)}</strong>`;
    el('mov-tipo').value = 'entrada';
    el('mov-qtd').value = '';
    el('mov-motivo').value = '';
    atualizarRotuloMov();
    el('modal-mov-bg').classList.add('open');
}

function fecharMov() { el('modal-mov-bg').classList.remove('open'); }

async function salvarMovimentacao() {
    const p = listaProdutos().find(x => x.id === el('mov-prod-id').value);
    if (!p) return;
    const tipo = el('mov-tipo').value;
    const qtd = parseInt(el('mov-qtd').value);
    const motivo = el('mov-motivo').value.trim();
    if (isNaN(qtd) || qtd < 0 || (tipo !== 'ajuste' && qtd === 0)) return toast('Informe uma quantidade válida.', 'err');

    let delta = tipo === 'entrada' ? qtd : tipo === 'saida' ? -qtd : qtd - nEstoque(p);
    if (delta === 0) return toast('O saldo já é esse valor.', 'warn');
    if (tipo === 'saida' && nEstoque(p) + delta < 0 && !confirm(`O saldo ficará negativo (${nEstoque(p) + delta}). Continuar?`)) return;

    const btn = el('btn-salvar-mov');
    btn.disabled = true;
    try {
        const batch = window._fs.writeBatch(window._db);
        baixarEstoque(batch, p, delta);
        registrarMov(batch, p, tipo, delta, motivo, { saldoApos: nEstoque(p) + delta });
        await batch.commit();
        fecharMov();
        toast('Movimentação registrada.');
    } catch (e) {
        toast('Erro: ' + e.message, 'err');
    } finally {
        btn.disabled = false;
    }
}

// ── exportar PDF ──────────────────────────────────────────────────
function exportarPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const mes = el('filtro-mes')?.value;
    const lista = mes ? vendas().filter(v => v.data && v.data.startsWith(mes)) : vendas();
    const fat = lista.filter(v => v.status !== 'Cancelada').reduce((s, v) => s + v.total, 0);

    doc.setFontSize(16); doc.setFont('helvetica', 'bold');
    doc.text('RELATORIO DE VENDAS - Gabriel Gatti', 14, 18);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text(`CNPJ: 66.116.356/0001-01  |  Gerado: ${new Date().toLocaleString('pt-BR')}`, 14, 26);
    doc.text(`Periodo: ${mes || 'Todos'}  |  Registros: ${lista.length}  |  Fat.: R$ ${fat.toFixed(2)}`, 14, 32);

    let y = 44;
    doc.setFillColor(26, 107, 60); doc.rect(14, y - 5, 182, 7, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    ['Data', 'Cliente', 'Produto', 'Qtd', 'Total', 'Status'].forEach((h, i) => {
        doc.text(h, [14, 42, 80, 108, 136, 168][i], y);
    });
    doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal'); y += 8;

    lista.forEach((v, i) => {
        if (y > 270) { doc.addPage(); y = 20; }
        const itens = vendaItens(v);
        const labelProd = itens.length > 1 ? `${itens.length} produtos` : (itens[0]?.nome || produtoLabel(v));
        if (i % 2 === 0) { doc.setFillColor(245, 248, 245); doc.rect(14, y - 4, 182, 7, 'F'); }
        doc.setFontSize(8);
        doc.text(formatarData(v.data), 14, y);
        doc.text((v.cliente || '').substring(0, 18), 42, y);
        doc.text(labelProd.substring(0, 22), 80, y);
        doc.text(String(qtdVenda(v)), 108, y);
        doc.text('R$' + v.total.toFixed(2), 136, y);
        doc.text(v.status || 'Confirmada', 168, y);
        y += 7;
    });
    doc.save(`Relatorio_GabrielGatti_${mes || 'completo'}.pdf`);
    toast('PDF gerado.');
}

function exportarCSV() {
    const mes = el('filtro-mes')?.value;
    const lista = mes ? vendas().filter(v => v.data && v.data.startsWith(mes)) : vendas();
    const header = 'Data,Cliente,Telefone,Vendedor,Produtos,Qtd Total,Total,Pagamento,Status\n';
    const rows = lista.map(v => {
        const itens = vendaItens(v);
        const labelProd = itens.map(i => `${i.nome} x${i.qtd}`).join(' | ');
        return `${v.data},"${v.cliente || ''}","${v.telefone || ''}","${window._resolverVendedor(v)}","${labelProd}",${qtdVenda(v)},${v.total},${v.pagamento || ''},${v.status || 'Confirmada'}`;
    }).join('\n');
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Vendas_GabrielGatti_${mes || 'completo'}.csv`;
    a.click();
    toast('CSV exportado.');
}

// ── nota fiscal ───────────────────────────────────────────────────
let nfAtual = null;

function abrirNF(id) {
    const v = vendas().find(x => x._id === id);
    if (!v) return toast('Venda não encontrada.', 'err');
    nfAtual = v;
    renderNF(v);
    el('modal-nf-bg').classList.add('open');
}

function fecharNF() {
    el('modal-nf-bg').classList.remove('open');
    nfAtual = null;
}

function renderNF(v) {
    const nfNum = 'NF-' + (v._id || '').slice(-6).toUpperCase();
    const emissao = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const itens = vendaItens(v);

    el('nf-corpo').innerHTML = `
    <div id="nf-print" style="font-family:'DM Sans',sans-serif;color:#111;background:#fff;padding:0">

        <!-- Topo da nota -->
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;gap:12px;flex-wrap:wrap">
            <div>
                <div style="font-size:20px;font-weight:900;color:#1a6b3c;letter-spacing:-0.5px">Esterco Turbinado</div>
                <div style="font-size:11px;color:#555;margin-top:3px">Gabriel V. Gatti</div>
                <div style="font-size:11px;color:#555">CNPJ: 66.116.356/0001-01</div>
            </div>
            <div style="text-align:right">
                <div style="font-size:22px;font-weight:900;color:#111">${nfNum}</div>
                <div style="font-size:11px;color:#555;margin-top:3px">Emitida em: ${emissao}</div>
                <div style="display:inline-block;margin-top:6px;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;
                    background:${(v.status||'Confirmada') === 'Confirmada' ? '#dcfce7' : '#fee2e2'};
                    color:${(v.status||'Confirmada') === 'Confirmada' ? '#166534' : '#991b1b'}">
                    ${v.status || 'Confirmada'}
                </div>
            </div>
        </div>

        <hr style="border:none;border-top:2px solid #e5e7eb;margin-bottom:18px">

        <!-- Dados do cliente -->
        <div style="margin-bottom:18px">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#888;font-weight:700;margin-bottom:6px">Cliente</div>
            <div style="font-size:17px;font-weight:700;color:#111">${v.cliente || 'Não informado'}</div>
            <div style="font-size:12px;color:#555;margin-top:2px">Data da venda: ${formatarData(v.data)}</div>
        </div>

        <!-- Tabela de itens -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:18px;font-size:13px">
            <thead>
                <tr style="background:#f3f4f6">
                    <th style="padding:8px 10px;text-align:left;font-weight:700;color:#374151;border-bottom:2px solid #d1d5db">Produto</th>
                    <th style="padding:8px 10px;text-align:center;font-weight:700;color:#374151;border-bottom:2px solid #d1d5db">Qtd</th>
                    <th style="padding:8px 10px;text-align:right;font-weight:700;color:#374151;border-bottom:2px solid #d1d5db">V. Unit.</th>
                    <th style="padding:8px 10px;text-align:right;font-weight:700;color:#374151;border-bottom:2px solid #d1d5db">Subtotal</th>
                </tr>
            </thead>
            <tbody>
                ${itens.map(it => `<tr>
                    <td style="padding:10px 10px;border-bottom:1px solid #e5e7eb">
                        <div style="font-weight:600;color:#111">${it.nome}</div>
                    </td>
                    <td style="padding:10px;text-align:center;border-bottom:1px solid #e5e7eb">${it.qtd}</td>
                    <td style="padding:10px;text-align:right;border-bottom:1px solid #e5e7eb">R$ ${parseFloat(it.unit).toFixed(2)}</td>
                    <td style="padding:10px;text-align:right;font-weight:700;border-bottom:1px solid #e5e7eb">R$ ${parseFloat(it.subtotal || it.qtd * it.unit).toFixed(2)}</td>
                </tr>`).join('')}
            </tbody>
        </table>

        <!-- Total -->
        <div style="display:flex;justify-content:flex-end;margin-bottom:18px">
            <div style="background:#f3f4f6;border-radius:10px;padding:12px 18px;text-align:right;min-width:180px">
                <div style="font-size:12px;color:#555">Total da venda</div>
                <div style="font-size:24px;font-weight:900;color:#1a6b3c">R$ ${parseFloat(v.total).toFixed(2)}</div>
            </div>
        </div>

        <!-- Rodapé da nota -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">
            <div style="background:#f9fafb;border-radius:8px;padding:10px 14px">
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#888;font-weight:700;margin-bottom:4px">Pagamento</div>
                <div style="font-size:14px;font-weight:600;color:#111">${v.pagamento || 'Não informado'}</div>
            </div>
            <div style="background:#f9fafb;border-radius:8px;padding:10px 14px">
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#888;font-weight:700;margin-bottom:4px">Vendedor</div>
                <div style="font-size:14px;font-weight:600;color:#111">${window._resolverVendedor(v)}</div>
            </div>
        </div>

        ${v.obs ? `<div style="background:#fefce8;border-radius:8px;padding:10px 14px;margin-bottom:18px">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#888;font-weight:700;margin-bottom:4px">Observações</div>
            <div style="font-size:13px;color:#374151">${v.obs}</div>
        </div>` : ''}

        <hr style="border:none;border-top:1px solid #e5e7eb;margin-bottom:12px">
        <div style="font-size:10px;color:#aaa;text-align:center">
            Documento gerado pelo Sistema Primário 3.0 · Esterco Turbinado Gabriel Gatti
        </div>
    </div>
    `;
}

function imprimirNF() {
    const conteudo = el('nf-print');
    if (!conteudo) return;
    const win = window.open('', '_blank', 'width=700,height=900');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
        <title>Nota Fiscal</title>
        <style>
            body { margin: 24px; font-family: 'DM Sans', Arial, sans-serif; }
            @media print { body { margin: 0; } }
        </style>
    </head><body>${conteudo.innerHTML}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
}

function gerarPDFNF() {
    if (!nfAtual) return;
    const v = nfAtual;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const nfNum = 'NF-' + (v._id || '').slice(-6).toUpperCase();
    const emissao = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const itens = vendaItens(v);

    // Cabeçalho verde
    doc.setFillColor(26, 107, 60);
    doc.rect(0, 0, 210, 28, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text('ESTERCO TURBINADO', 14, 11);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text('Gabriel V. Gatti  |  CNPJ: 66.116.356/0001-01', 14, 18);
    doc.text('Sistema Primário 3.0', 14, 24);

    // Número e status
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text(nfNum, 196, 14, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text('Emitida em: ' + emissao, 196, 22, { align: 'right' });

    // Dados do cliente
    doc.setTextColor(0, 0, 0);
    doc.setFillColor(243, 244, 246);
    doc.rect(14, 34, 182, 20, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text('CLIENTE', 18, 40);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.setTextColor(17, 17, 17);
    doc.text(v.cliente || 'Não informado', 18, 48);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text('Data da venda: ' + formatarData(v.data), 140, 48);

    // Tabela de itens
    let y = 66;
    doc.setFillColor(243, 244, 246);
    doc.rect(14, y - 5, 182, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.setTextColor(55, 65, 81);
    doc.text('PRODUTO', 18, y); doc.text('QTD', 110, y); doc.text('V. UNIT.', 140, y); doc.text('SUBTOTAL', 178, y, { align: 'right' });
    y += 4;
    doc.setDrawColor(209, 213, 219);
    doc.line(14, y, 196, y);
    y += 8;

    itens.forEach(it => {
        if (y > 240) { doc.addPage(); y = 20; }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(17, 17, 17);
        doc.text((it.nome || '').substring(0, 38), 18, y);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(17, 17, 17);
        doc.text(String(it.qtd), 110, y);
        doc.text('R$ ' + parseFloat(it.unit).toFixed(2), 140, y);
        doc.setFont('helvetica', 'bold');
        doc.text('R$ ' + parseFloat(it.subtotal || it.qtd * it.unit).toFixed(2), 178, y, { align: 'right' });
        y += 10;
    });

    doc.setDrawColor(229, 231, 235);
    doc.line(14, y, 196, y);

    // Total
    y += 10;
    doc.setFillColor(26, 107, 60);
    doc.roundedRect(130, y - 4, 66, 16, 3, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text('TOTAL', 163, y + 2, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('R$ ' + parseFloat(v.total).toFixed(2), 163, y + 10, { align: 'center' });

    // Rodapé de campos
    y += 26;
    doc.setFillColor(249, 250, 251);
    doc.roundedRect(14, y, 84, 18, 2, 2, 'F');
    doc.roundedRect(112, y, 84, 18, 2, 2, 'F');
    doc.setTextColor(136, 136, 136); doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
    doc.text('PAGAMENTO', 18, y + 6); doc.text('VENDEDOR', 116, y + 6);
    doc.setTextColor(17, 17, 17); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(v.pagamento || 'Não informado', 18, y + 14);
    doc.text(window._resolverVendedor(v), 116, y + 14);

    // Obs
    if (v.obs) {
        y += 26;
        doc.setFillColor(254, 252, 232);
        doc.roundedRect(14, y, 182, 16, 2, 2, 'F');
        doc.setTextColor(136, 136, 136); doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
        doc.text('OBSERVAÇÕES', 18, y + 6);
        doc.setTextColor(55, 65, 81); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        doc.text(v.obs.substring(0, 90), 18, y + 13);
        y += 16;
    }

    // Status
    y += 14;
    const statusOk = (v.status || 'Confirmada') === 'Confirmada';
    doc.setFillColor(statusOk ? 220 : 254, statusOk ? 252 : 226, statusOk ? 231 : 226);
    doc.roundedRect(14, y, 40, 10, 2, 2, 'F');
    doc.setTextColor(statusOk ? 22 : 153, statusOk ? 101 : 27, statusOk ? 52 : 27);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text(v.status || 'Confirmada', 34, y + 7, { align: 'center' });

    // Rodapé
    doc.setTextColor(170, 170, 170); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('Documento gerado pelo Sistema Primário 3.0 · Esterco Turbinado Gabriel Gatti', 105, 285, { align: 'center' });

    doc.save(`NotaFiscal_${nfNum}_${v.cliente || 'cliente'}.pdf`);
    toast('PDF da nota gerado.');
}

// ── init ──────────────────────────────────────────────────────────
(function init() {
    const hoje = new Date().toISOString().slice(0, 10);
    if (el('data-venda')) el('data-venda').value = hoje;
    if (el('filtro-mes')) el('filtro-mes').value = hoje.slice(0, 7);
    renderGradeProdutos();
    renderCarrinho();
})();