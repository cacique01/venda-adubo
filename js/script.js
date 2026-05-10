// ── config local ──────────────────────────────────────────────────
let config = JSON.parse(localStorage.getItem('gg_config') || '{}');
let precos = JSON.parse(localStorage.getItem('gg_precos') || '{"dT1":9,"dT4":25,"cT1":12,"cT4":20,"kT1":3,"kT4":7,"dF1":12,"dF4":7,"cF1":35,"cF4":20,"kF1":4,"kF4":8,"p50":270,"k50":88,"p100":400,"k100":175}');
let metas = JSON.parse(localStorage.getItem('gg_metas') || '{"valor":0,"unidades":0}');
let vendaPendente = null;
let editId = null;

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
function mudarTab(id, btn) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    el('tab-' + id).classList.add('active');
    const fns = { painel: renderPainel, historico: renderHistorico, semana: renderSemana, meta: renderMeta, config: carregarConfig };
    if (fns[id]) fns[id]();
}

// ── form nova venda ───────────────────────────────────────────────
function atualizarPreco() {
    if (!el('tipo-venda') || !el('tamanho')) return;
    const tipo = el('tipo-venda').value;
    const tam = el('tamanho').value;
    const prod = el('produto-tipo') ? el('produto-tipo').value : 'turbinado';
    if (el('fg-outro')) el('fg-outro').style.display = tam === 'outro' ? 'flex' : 'none';
    let p = '';
    if (tam === '50') { p = precos.p50; }
    else if (tam === '100') { p = precos.p100; }
    else if (prod === 'turbinado') {
        p = tam === '1' ? (tipo === 'direta' ? precos.dT1 : precos.cT1) : (tipo === 'direta' ? precos.dT4 : precos.cT4);
    } else if (prod === 'frutifero') {
        p = tam === '1' ? (tipo === 'direta' ? precos.dF1 : precos.cF1) : (tipo === 'direta' ? precos.dF4 : precos.cF4);
    }
    if (p && el('valor-unit')) el('valor-unit').value = parseFloat(p).toFixed(2);
    calcularTotal();
}

function calcularTotal() {
    if (!el('qtd') || !el('valor-unit') || !el('tamanho') || !el('resumo-txt')) return;
    const qtd = parseFloat(el('qtd').value) || 0;
    const unit = parseFloat(el('valor-unit').value) || 0;
    const tam = el('tamanho').value;
    const tipo = el('tipo-venda').value;
    const total = (qtd * unit).toFixed(2);
    const pesoOut = el('peso-outro') ? el('peso-outro').value : '?';
    const tamLabel = tam === '1' ? '1kg' : tam === '4' ? '4kg' : tam === '50' ? '50kg' : tam === '100' ? '100kg' : (pesoOut || '?') + 'kg';
    const prod = el('produto-tipo') ? el('produto-tipo').value : 'turbinado';
    const prodSuffix = prod === 'turbinado' ? ' Turbinado' : prod === 'frutifero' ? ' Frutífero' : '';
    el('resumo-txt').innerHTML =
        `<strong>${qtd}</strong> saco(s) de <strong>${tamLabel}${prodSuffix}</strong> (${tipo === 'direta' ? 'Venda Direta' : 'consignado'}) × R$ <strong>${unit.toFixed(2)}</strong> = <span style="color:var(--neon);font-size:17px;font-weight:800">R$ ${total}</span>`;
}

function limparForm() {
    ['qtd', 'valor-unit', 'cliente', 'obs'].forEach(id => { if (el(id)) el(id).value = ''; });
    if (el('qtd')) el('qtd').value = 1;
    if (el('tamanho')) el('tamanho').value = '1';
    if (el('tipo-venda')) el('tipo-venda').value = 'direta';
    if (el('produto-tipo')) el('produto-tipo').value = 'turbinado';
    atualizarPreco();
}

function lancarVenda() {
    const qtd = parseInt(el('qtd').value);
    const unit = parseFloat(el('valor-unit').value);
    const tam = el('tamanho').value;
    const tipo = el('tipo-venda').value;
    const data = el('data-venda').value;
    const cli = el('cliente').value.trim() || 'Não informado';
    const pgto = el('pagamento').value;
    const obs = el('obs').value.trim();
    const peso = el('peso-outro') ? el('peso-outro').value : '';
    const produto = el('produto-tipo') ? el('produto-tipo').value : 'turbinado';

    if (!qtd || qtd < 1) return toast('Informe a quantidade.', 'err');
    if (!unit || unit <= 0) return toast('Informe o valor unitário.', 'err');
    if (!data) return toast('Informe a data da venda.', 'err');

    vendaPendente = { data, qtd, unit, tamanho: tam, peso, produto, tipo, cliente: cli, pagamento: pgto, obs, total: +(qtd * unit).toFixed(2), status: 'Confirmada' };

    const tamLabel = tam === '1' ? '1kg' : tam === '4' ? '4kg' : tam === '50' ? '50kg' : tam === '100' ? '100kg' : (peso || '?') + 'kg';
    const prodLabel = produto === 'turbinado' ? ' Turbinado' : produto === 'frutifero' ? ' Frutífero' : '';
    el('modal-detail').innerHTML = `
    <p>📦 Produto: <span>Adubo ${tamLabel}${prodLabel}</span></p>
    <p>🔢 Quantidade: <span>${qtd} unidade(s)</span></p>
    <p>💰 Valor unitário: <span>R$ ${unit.toFixed(2)}</span></p>
    <p>💵 Total: <span>R$ ${vendaPendente.total.toFixed(2)}</span></p>
    <p>🏷️ Tipo: <span>${tipo === 'direta' ? 'Venda Direta' : 'consignado'}</span></p>
    <p>👤 Cliente: <span>${cli}</span></p>
    <p>💳 Pagamento: <span>${pgto}</span></p>
    <p>📅 Data: <span>${formatarData(data)}</span></p>
    ${obs ? `<p>📝 Obs: <span>${obs}</span></p>` : ''}
  `;
    el('modal-bg').classList.add('open');
}

function fecharModal() { el('modal-bg').classList.remove('open'); vendaPendente = null; }

async function confirmarVenda() {
    if (!vendaPendente) return;
    try {
        await window._addDoc(window._col, { ...vendaPendente, criadoEm: window._serverTimestamp() });
        fecharModal();
        limparForm();
        toast('✅ Venda lançada e sincronizada!');
    } catch (e) {
        toast('❌ Erro ao salvar: ' + e.message, 'err');
    }
}

// ── cancelar / editar ─────────────────────────────────────────────
async function cancelarVenda(id) {
    if (!confirm('Cancelar esta venda?')) return;
    try {
        await window._updateDoc(window._doc(window._db, 'vendas', id), { status: 'Cancelada' });
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
            pagamento: el('edit-pgto').value,
            obs: el('edit-obs').value
        });
        fecharEdit(); toast('✅ Venda editada!');
    } catch (e) { toast('Erro: ' + e.message, 'err'); }
}

// ── painel ────────────────────────────────────────────────────────
window.renderPainel = function () {
    const mes = new Date().toISOString().slice(0, 7);
    const vMes = vendas().filter(v => v.data && v.data.startsWith(mes) && v.status !== 'Cancelada');
    const fat = vMes.reduce((s, v) => s + v.total, 0);
    const unid = vMes.reduce((s, v) => s + v.qtd, 0);
    const lucro = vMes.reduce((s, v) => {
        let c;
        if (v.tamanho === '50') c = precos.k50;
        else if (v.tamanho === '100') c = precos.k100;
        else if (v.produto === 'turbinado') c = v.tamanho === '1' ? precos.kT1 : precos.kT4;
        else if (v.produto === 'frutifero') c = v.tamanho === '1' ? precos.kF1 : precos.kF4;
        else c = v.tamanho === '1' ? precos.kT1 : precos.kT4;
        return s + (v.unit - c) * v.qtd;
    }, 0);

    el('cards-painel').innerHTML = `
    <div class="card"><div class="card-label">Faturamento do Mês</div><div class="card-val">R$ ${fat.toFixed(2)}</div><div class="card-sub">${vMes.length} venda(s)</div></div>
    <div class="card"><div class="card-label">Unidades Vendidas</div><div class="card-val">${unid}</div><div class="card-sub">este mês</div></div>
    <div class="card"><div class="card-label">Lucro Líquido</div><div class="card-val">R$ ${lucro.toFixed(2)}</div><div class="card-sub">após custos</div></div>
    <div class="card"><div class="card-label">Sua Parte (25%)</div><div class="card-val">R$ ${(lucro * .25).toFixed(2)}</div><div class="card-sub">dividendos acumulados</div></div>
  `;

    const pct = metas.valor > 0 ? Math.min((fat / metas.valor) * 100, 100) : 0;
    el('meta-painel').innerHTML = metas.valor > 0
        ? `<p style="font-size:13px;color:var(--cinza);margin-bottom:6px">Meta: <strong style="color:#fff">R$ ${metas.valor.toFixed(2)}</strong> — Atingido: <strong style="color:var(--neon)">R$ ${fat.toFixed(2)}</strong> (${pct.toFixed(1)}%)</p>
       <div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div>
       <p style="font-size:12px;color:var(--cinza);margin-top:6px">${pct >= 100 ? '🎉 Meta atingida!' : `Faltam R$ ${(metas.valor - fat).toFixed(2)}`}</p>`
        : `<p style="color:var(--cinza);font-size:13px">Nenhuma meta definida. Acesse <strong>Metas</strong> para configurar.</p>`;

    el('tbl-recentes').innerHTML = vendas().slice(0, 8).map(v => `<tr>
    <td>${formatarData(v.data)}</td><td>Adubo ${produtoLabel(v)}</td><td>${v.qtd}</td>
    <td>R$ ${v.unit.toFixed(2)}</td><td><strong>R$ ${v.total.toFixed(2)}</strong></td>
    <td>${v.tipo === 'direta' ? 'Direta' : 'consignado'}</td>
    <td><span class="badge ${(v.status || 'Confirmada') === 'Confirmada' ? 'badge-ok' : 'badge-cancel'}">${v.status || 'Confirmada'}</span></td>
  </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--cinza);padding:20px">Nenhuma venda registrada.</td></tr>';
};

// ── histórico ─────────────────────────────────────────────────────
window.renderHistorico = function () {
    const mes = el('filtro-mes')?.value;
    const lista = mes ? vendas().filter(v => v.data && v.data.startsWith(mes)) : vendas();
    el('tbl-historico').innerHTML = lista.length
        ? lista.map((v, i) => `<tr>
        <td>${i + 1}</td><td>${formatarData(v.data)}</td><td>${v.cliente || '–'}</td>
        <td>Adubo ${produtoLabel(v)}</td><td>${v.qtd}</td>
        <td>R$ ${v.unit.toFixed(2)}</td><td><strong>R$ ${v.total.toFixed(2)}</strong></td>
        <td>${v.tipo === 'direta' ? 'Direta' : 'consignado'}</td><td>${v.pagamento || '–'}</td>
        <td><span class="badge ${(v.status || 'Confirmada') === 'Confirmada' ? 'badge-ok' : 'badge-cancel'}">${v.status || 'Confirmada'}</span></td>
        <td><div class="btn-row">${(v.status || 'Confirmada') !== 'Cancelada'
                ? `<button class="btn btn-warn btn-sm" onclick="abrirEdit('${v._id}')">✏️</button>
            <button class="btn btn-danger btn-sm" onclick="cancelarVenda('${v._id}')">❌</button>`
                : '–'}</div></td>
      </tr>`).join('')
        : '<tr><td colspan="11" style="text-align:center;color:var(--cinza);padding:20px">Nenhuma venda encontrada.</td></tr>';
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
    const unid = vSem.reduce((s, v) => s + v.qtd, 0);
    const lucro = vSem.reduce((s, v) => {
        let c;
        if (v.tamanho === '50') c = precos.k50;
        else if (v.tamanho === '100') c = precos.k100;
        else if (v.produto === 'turbinado') c = v.tamanho === '1' ? precos.kT1 : precos.kT4;
        else if (v.produto === 'frutifero') c = v.tamanho === '1' ? precos.kF1 : precos.kF4;
        else c = v.tamanho === '1' ? precos.kT1 : precos.kT4;
        return s + (v.unit - c) * v.qtd;
    }, 0);

    el('cards-semana').innerHTML = `
    <div class="card"><div class="card-label">Faturamento Semanal</div><div class="card-val">R$ ${fat.toFixed(2)}</div></div>
    <div class="card"><div class="card-label">Unidades na Semana</div><div class="card-val">${unid}</div></div>
    <div class="card"><div class="card-label">Lucro Semanal</div><div class="card-val">R$ ${lucro.toFixed(2)}</div></div>
    <div class="card"><div class="card-label">Sua Parte (25%)</div><div class="card-val">R$ ${(lucro * .25).toFixed(2)}</div></div>
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
        ? vSem.map(v => `<tr>
        <td>${formatarData(v.data)}</td><td>${v.cliente || '–'}</td>
        <td>Adubo ${produtoLabel(v)}</td><td>${v.qtd}</td>
        <td><strong>R$ ${v.total.toFixed(2)}</strong></td>
        <td><span class="badge ${(v.status || 'Confirmada') === 'Confirmada' ? 'badge-ok' : 'badge-cancel'}">${v.status || 'Confirmada'}</span></td>
      </tr>`).join('')
        : '<tr><td colspan="6" style="text-align:center;color:var(--cinza);padding:20px">Nenhuma venda esta semana.</td></tr>';

    const dp = dias.indexOf(hoje) + 1;
    const dr = 7 - dp;
    const fatMes = vendas().filter(v => v.data && v.data.startsWith(new Date().toISOString().slice(0, 7)) && v.status !== 'Cancelada').reduce((s, v) => s + v.total, 0);
    if (metas.valor > 0 && fat > 0 && dr > 0) {
        const med = fat / dp; const proj = fat + med * dr; const falta = metas.valor - fatMes;
        el('previsao-meta').innerHTML = `
      <p style="font-size:14px;color:var(--cinza)">Média diária: <strong style="color:#fff">R$ ${med.toFixed(2)}/dia</strong></p>
      <p style="font-size:14px;color:var(--cinza);margin-top:8px">Projeção fim da semana: <strong style="color:var(--neon)">R$ ${proj.toFixed(2)}</strong></p>
      ${falta > 0 ? `<p style="font-size:14px;color:var(--cinza);margin-top:8px">Faltam <strong style="color:var(--amarelo)">R$ ${falta.toFixed(2)}</strong> para bater a meta mensal.</p>` : '<p style="color:var(--neon);margin-top:8px">🎉 Meta mensal atingida!</p>'}
    `;
    } else {
        el('previsao-meta').innerHTML = `<p style="color:var(--cinza);font-size:13px">Defina uma meta mensal para ver a previsão.</p>`;
    }
};

// ── metas ─────────────────────────────────────────────────────────
function salvarMeta() {
    metas.valor = parseFloat(el('meta-valor').value) || 0;
    metas.unidades = parseInt(el('meta-unidades').value) || 0;
    localStorage.setItem('gg_metas', JSON.stringify(metas));
    renderMeta();
}

window.renderMeta = function () {
    if (el('meta-valor')) el('meta-valor').value = metas.valor || '';
    if (el('meta-unidades')) el('meta-unidades').value = metas.unidades || '';
    const mes = new Date().toISOString().slice(0, 7);
    const vMes = vendas().filter(v => v.data && v.data.startsWith(mes) && v.status !== 'Cancelada');
    const fat = vMes.reduce((s, v) => s + v.total, 0);
    const unid = vMes.reduce((s, v) => s + v.qtd, 0);
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
    const medP = (precos.dT1 + precos.dT4) / 2;
    el('previsao-geral').innerHTML = metas.valor > 0
        ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="meta-box"><strong>💰 Para bater a meta de faturamento</strong>
          <p>Faltam <strong style="color:var(--neon)">R$ ${faltaVal.toFixed(2)}</strong></p>
          <p>≈ <strong style="color:var(--neon)">${Math.ceil(faltaVal / medP)} unidade(s)</strong> ao preço médio</p>
        </div>
        <div class="meta-box"><strong>📦 Para bater a meta de unidades</strong>
          <p>Faltam <strong style="color:var(--neon)">${faltaUni} unidade(s)</strong></p>
        </div>
      </div>`
        : '<p style="color:var(--cinza);font-size:13px">Defina sua meta acima.</p>';
};

// ── config ────────────────────────────────────────────────────────
function carregarConfig() {
    if (el('preco-1kg-d-t')) el('preco-1kg-d-t').value = precos.dT1;
    if (el('preco-4kg-d-t')) el('preco-4kg-d-t').value = precos.dT4;
    if (el('preco-1kg-c-t')) el('preco-1kg-c-t').value = precos.cT1;
    if (el('preco-4kg-c-t')) el('preco-4kg-c-t').value = precos.cT4;
    if (el('custo-1kg-t')) el('custo-1kg-t').value = precos.kT1;
    if (el('custo-4kg-t')) el('custo-4kg-t').value = precos.kT4;
    if (el('preco-1kg-d-f')) el('preco-1kg-d-f').value = precos.dF1;
    if (el('preco-4kg-d-f')) el('preco-4kg-d-f').value = precos.dF4;
    if (el('preco-1kg-c-f')) el('preco-1kg-c-f').value = precos.cF1;
    if (el('preco-4kg-c-f')) el('preco-4kg-c-f').value = precos.cF4;
    if (el('custo-1kg-f')) el('custo-1kg-f').value = precos.kF1;
    if (el('custo-4kg-f')) el('custo-4kg-f').value = precos.kF4;
    if (el('preco-50kg')) el('preco-50kg').value = precos.p50;
    if (el('custo-50kg')) el('custo-50kg').value = precos.k50;
    if (el('preco-100kg')) el('preco-100kg').value = precos.p100;
    if (el('custo-100kg')) el('custo-100kg').value = precos.k100;
}

function salvarPrecos() {
    precos.dT1 = parseFloat(el('preco-1kg-d-t').value) || 9;
    precos.dT4 = parseFloat(el('preco-4kg-d-t').value) || 25;
    precos.cT1 = parseFloat(el('preco-1kg-c-t').value) || 12;
    precos.cT4 = parseFloat(el('preco-4kg-c-t').value) || 20;
    precos.kT1 = parseFloat(el('custo-1kg-t').value) || 3;
    precos.kT4 = parseFloat(el('custo-4kg-t').value) || 7;
    precos.dF1 = parseFloat(el('preco-1kg-d-f').value) || 12;
    precos.dF4 = parseFloat(el('preco-4kg-d-f').value) || 7;
    precos.cF1 = parseFloat(el('preco-1kg-c-f').value) || 35;
    precos.cF4 = parseFloat(el('preco-4kg-c-f').value) || 20;
    precos.kF1 = parseFloat(el('custo-1kg-f').value) || 4;
    precos.kF4 = parseFloat(el('custo-4kg-f').value) || 8;
    precos.p50 = parseFloat(el('preco-50kg').value) || 270;
    precos.k50 = parseFloat(el('custo-50kg').value) || 88;
    precos.p100 = parseFloat(el('preco-100kg').value) || 400;
    precos.k100 = parseFloat(el('custo-100kg').value) || 175;
    localStorage.setItem('gg_precos', JSON.stringify(precos));
    toast('✅ Preços salvos!');

    alert('Preços atualizados!'); // Sugestão para o usuário revisar vendas recentes após alteração de preços
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
    ['Data', 'Cliente', 'Produto', 'Qtd', 'V.Unit', 'Total', 'Tipo', 'Status'].forEach((h, i) => {
        doc.text(h, [14, 42, 80, 108, 120, 136, 152, 168][i], y);
    });
    doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal'); y += 8;

    lista.forEach((v, i) => {
        if (y > 270) { doc.addPage(); y = 20; }
        if (i % 2 === 0) { doc.setFillColor(245, 248, 245); doc.rect(14, y - 4, 182, 7, 'F'); }
        doc.setFontSize(8);
        doc.text(formatarData(v.data), 14, y);
        doc.text((v.cliente || '').substring(0, 18), 42, y);
        doc.text('Adubo ' + produtoLabel(v), 80, y);
        doc.text(String(v.qtd), 108, y);
        doc.text('R$' + v.unit.toFixed(2), 120, y);
        doc.text('R$' + v.total.toFixed(2), 136, y);
        doc.text(v.tipo === 'direta' ? 'Direta' : 'Cons.', 152, y);
        doc.text(v.status || 'Confirmada', 168, y);
        y += 7;
    });
    doc.save(`Relatorio_GabrielGatti_${mes || 'completo'}.pdf`);
    toast('📄 PDF gerado!');
}

function exportarCSV() {
    const mes = el('filtro-mes')?.value;
    const lista = mes ? vendas().filter(v => v.data && v.data.startsWith(mes)) : vendas();
    const header = 'Data,Cliente,Produto,Quantidade,Valor Unit.,Total,Tipo,Pagamento,Status\n';
    const rows = lista.map(v => `${v.data},"${v.cliente || ''}","Adubo ${produtoLabel(v)}",${v.qtd},${v.unit},${v.total},${v.tipo},${v.pagamento || ''},${v.status || 'Confirmada'}`).join('\n');
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Vendas_GabrielGatti_${mes || 'completo'}.csv`;
    a.click();
    toast('📊 CSV exportado!');
}

// ── init ──────────────────────────────────────────────────────────
(function init() {
    const hoje = new Date().toISOString().slice(0, 10);
    if (el('data-venda')) el('data-venda').value = hoje;
    if (el('filtro-mes')) el('filtro-mes').value = hoje.slice(0, 7);
    atualizarPreco();
    carregarConfig();
})();