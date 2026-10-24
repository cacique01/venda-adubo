# 📚 Documentação Completa — Sistema de Vendas Gabriel Gatti

> Versão 3.0 | Gerado em 20/10/2026
> Desenvolvido por Davi para o cliente Gabriel Gatti (negócio de adubos orgânicos)

---

## Índice

1. [Visão Geral da Arquitetura](#1-visão-geral-da-arquitetura)
2. [index.html — Estrutura e Firebase](#2-indexhtml--estrutura-e-firebase)
3. [js/script.js — Lógica do Sistema](#3-jsscriptjs--lógica-do-sistema)
4. [css/style.css — Estilos Resumidos](#4-cssstylecss--estilos-resumidos)
5. [Acesso ao Sistema — Como Funciona](#5-acesso-ao-sistema--como-funciona)
6. [Fluxo Completo de uma Venda](#6-fluxo-completo-de-uma-venda)
7. [Tabela de Preços e chaves localStorage](#7-tabela-de-preços-e-chaves-localstorage)
8. [Webhook Sendfy — Cloudflare Pages](#8-webhook-sendfy--cloudflare-pages)
9. [Aplicativo Android e iOS](#9-aplicativo-android-e-ios)

---

## 1. Visão Geral da Arquitetura

```
index.html          ← Ponto de entrada. Contém o HTML, o bloco Firebase e
                      monta toda a estrutura visual da página.

js/script.js        ← Toda a lógica de negócio: cálculos, renderização de
                      tabelas, salvar vendas, exportar, etc.

functions/          ← Cloudflare Pages Function que recebe vendas da Sendfy
                      em /api/webhook-venda.

css/style.css       ← Estilos visuais: cores, layout, cards, tabelas,
                      animações, modo responsivo.

Firebase Firestore  ← Banco de dados em nuvem (coleções "vendas" e "gastos").
                      Cada documento = uma venda ou um gasto.

firestore.rules     ← Regras de acesso: qualquer usuário autenticado pode
                      consultar e gerenciar vendas e gastos.

localStorage        ← Armazenamento local do navegador.
                      Guarda preços (gg_precos) e metas (gg_metas).
                      Não vai para a nuvem, fica só no dispositivo.
```

**Tecnologias usadas:**
- HTML5 + CSS3 + JavaScript puro (sem framework)
- Firebase v10 (Firestore + Authentication)
- jsPDF (geração de PDF no navegador)
- Google Fonts (Syne e DM Sans)

---

## 2. index.html — Estrutura e Firebase

### 2.1 Cabeçalho `<head>`

```html
<meta charset="UTF-8">
```
Define que o arquivo usa a codificação UTF-8, necessária para caracteres
especiais como ã, ç, é.

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```
Faz o site se adaptar a celulares. Sem isso, o site ficaria com zoom errado
no mobile.

```html
<link rel="icon" href="img/icon.jpeg">
```
Define o ícone que aparece na aba do navegador.

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js">
```
Carrega a biblioteca jsPDF, que permite gerar arquivos PDF diretamente no
navegador sem precisar de servidor.

---

### 2.2 Bloco Firebase — Imports

```javascript
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
```
Importa a função principal do Firebase. É ela que "liga" o Firebase com
as configurações do seu projeto.

```javascript
import {
    getFirestore, collection, addDoc, onSnapshot, doc,
    updateDoc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
```
Importa as funções do Firestore (banco de dados). Cada uma faz uma coisa:

| Função            | O que faz                                                  |
|-------------------|------------------------------------------------------------|
| `getFirestore`    | Conecta ao banco de dados do projeto                       |
| `collection`      | Aponta para uma coleção (pasta) no banco, ex: "vendas"     |
| `addDoc`          | Adiciona um novo documento (linha) na coleção              |
| `onSnapshot`      | Fica "escutando" o banco em tempo real (atualiza automático)|
| `doc`             | Aponta para um documento específico pelo ID                |
| `updateDoc`       | Edita campos de um documento existente                     |
| `query`           | Monta uma consulta com filtros                             |
| `orderBy`         | Ordena os resultados por um campo                          |
| `serverTimestamp` | Usa o horário do servidor Firebase (não do dispositivo)    |

```javascript
import {
    getAuth, signInWithEmailAndPassword, signOut,
    onAuthStateChanged, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
```
Importa as funções de autenticação:

| Função                    | O que faz                                        |
|---------------------------|--------------------------------------------------|
| `getAuth`                 | Conecta ao sistema de autenticação do Firebase   |
| `signInWithEmailAndPassword` | Faz login com e-mail e senha                  |
| `signOut`                 | Faz logout do usuário atual                      |
| `onAuthStateChanged`      | Detecta quando o usuário faz login ou logout     |
| `sendPasswordResetEmail`  | Envia o e-mail de "Esqueci minha senha"          |

---

### 2.3 Configuração do Firebase

```javascript
const firebaseConfig = {
    apiKey: "AIzaSyDRdeg9Jmu49PqOOZej8YkUspyFn3YQb4c",
    authDomain: "gabriel-gatti-vendas.firebaseapp.com",
    projectId: "gabriel-gatti-vendas",
    storageBucket: "gabriel-gatti-vendas.firebasestorage.app",
    messagingSenderId: "838167549878",
    appId: "1:838167549878:web:ff203aef0df91a7c98d317"
};
```
São as credenciais do projeto Firebase. Cada campo identifica o projeto:

- `apiKey` — chave de acesso à API (pode ser restrita por domínio)
- `authDomain` — domínio de autenticação do Firebase. Mantenha o domínio
  padrão `gabriel-gatti-vendas.firebaseapp.com`, a menos que um domínio
  personalizado de autenticação tenha sido configurado no Firebase.
- `projectId` — ID único do projeto no Firebase
- `storageBucket` — endereço do armazenamento de arquivos (não usado aqui)
- `messagingSenderId` — ID para notificações push (não usado aqui)
- `appId` — identificador da aplicação web

Como o site agora é servido em `https://gattiadubo.davitech.com.br`, adicione
`gattiadubo.davitech.com.br` à lista de domínios autorizados em
**Firebase Console → Authentication → Settings → Authorized domains**.
Isso é separado do `authDomain` configurado acima.

```javascript
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const auth = getAuth(app);
```
Inicializa o Firebase com as configurações e cria as conexões com o banco
de dados (`db`) e com o sistema de autenticação (`auth`).

---

### 2.4 Variáveis Globais (window._)

```javascript
window._db           = db;
window._auth         = auth;
window._col          = collection(db, "vendas");
window._addDoc       = addDoc;
window._updateDoc    = updateDoc;
window._doc          = doc;
window._serverTimestamp = serverTimestamp;
window._signOut      = () => signOut(auth);
window._vendas       = [];
```

Esse bloco serve para que o arquivo `script.js` (que é carregado depois)
consiga usar as funções do Firebase. Como o Firebase é carregado dentro de
um `<script type="module">`, ele fica isolado — a solução foi colocar tudo
no objeto `window` (que é global e acessível de qualquer lugar).

- `window._col` → referência à coleção "vendas" no Firestore
- `window._vendas` → array local que armazena as vendas carregadas do banco
- `window._signOut` → função que faz logout quando o botão "Sair" é clicado

---

### 2.5 Controle de Autenticação e acesso aos dados

```javascript
onAuthStateChanged(auth, (user) => { ... });
```
Essa função fica "ouvindo" o estado de autenticação. Ela é chamada
automaticamente quando a página carrega e quando alguém faz login ou logout.
O parâmetro `user` contém os dados da conta autenticada, ou `null` quando
ninguém está logado.

Toda conta com e-mail que conseguir fazer login no Firebase Authentication pode
consultar, criar, editar e excluir documentos nas coleções `vendas` e
`gastos`. As regras em `firestore.rules` exigem uma sessão Firebase
autenticada com e-mail; elas não liberam acesso anônimo.

Para aplicar a política, publique o conteúdo de `firestore.rules` em
**Firebase Console → Firestore Database → Rules**. Alterar o arquivo neste
repositório, por si só, não altera as regras já publicadas no Firebase.

---

### 2.6 Perfis de Usuários (PERFIS_USUARIOS)

```javascript
const PERFIS_USUARIOS = {
    'davi.246gol@gmail.com':        { nome: 'Davi',    admin: true  },
    'gvgatti10@gmail.com':           { nome: 'Gabriel', admin: true  },
    'jamilefernandes2007@gmail.com': { nome: 'Jamile',  admin: false }
};
```
Mapeamento opcional de perfis conhecidos. O e-mail é a chave, e o valor contém:
- `nome` — nome que aparece no sistema e nas vendas
- `admin` — se `true`, exibe o ícone de coroa no cabeçalho. Este campo não
  controla as permissões de leitura ou gravação no Firestore.

```javascript
if (user && PERFIS_USUARIOS[user.email]) {
    window._usuarioNome  = PERFIS_USUARIOS[user.email].nome;
    window._usuarioAdmin = PERFIS_USUARIOS[user.email].admin;
    window._usuarioEmail = user.email;
} else if (user) {
    // Conta autenticada sem perfil personalizado
    window._usuarioNome  = user.email;
    window._usuarioAdmin = false;
    window._usuarioEmail = user.email;
}
```
Lógica:
1. Usuário logado e e-mail com perfil personalizado → usa o nome e o ícone cadastrados
2. Usuário logado sem perfil personalizado → mostra o e-mail como nome e o ícone padrão
3. Sem login → permanece na tela de login, sem exibir o sistema.

---

### 2.7 Timeout de Segurança e onSnapshot

```javascript
const loadingTimeout = setTimeout(() => {
    if (loadingEl) loadingEl.style.display = 'none';
    // renderiza as telas mesmo vazias
}, 6000);
```
Se o Firestore não responder em **6 segundos**, o loading some automaticamente
e o sistema fica acessível — mesmo sem dados do banco.

```javascript
const q = query(collection(db, "vendas"), orderBy("criadoEm", "desc"));
onSnapshot(q, (snap) => {
    clearTimeout(loadingTimeout);           // cancela o timeout pois chegou resposta
    window._vendas = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    // re-renderiza todas as telas com os novos dados
    if (loadingEl) loadingEl.style.display = 'none';
}, (err) => {
    // callback de ERRO — chamado quando o banco rejeita a consulta
    clearTimeout(loadingTimeout);
    console.error('Firestore erro:', err.code, err.message);
    if (loadingEl) loadingEl.style.display = 'none';
    window._vendas = [];
    // renderiza as telas vazias mesmo assim
});
```
O `onSnapshot` tem **dois callbacks**:
- O primeiro (função com `snap`) → chamado quando os dados chegam com sucesso. `snap.docs` é um array de documentos do Firestore. Para cada um, o `_id` vem do `d.id` e o resto dos campos vem do `d.data()`.
- O segundo (função com `err`) → chamado quando há um **erro** (ex: regras do Firestore bloqueando acesso sem autenticação). Sem esse callback, um erro deixaria o loading preso para sempre.

---

### 2.8 Funções de Login

```javascript
window.fazerLogin = async function () {
    const email = document.getElementById('login-email').value.trim();
    const senha = document.getElementById('login-senha').value;
    ...
    await signInWithEmailAndPassword(auth, email, senha);
}
```
Função assíncrona (`async`) que pega o e-mail e senha dos campos, tenta
fazer login no Firebase e trata os erros. Após o login bem-sucedido, o
`onAuthStateChanged` detecta a mudança automaticamente e abre o sistema.

```javascript
window.loginKeydown = function (e) {
    if (e.key === 'Enter') window.fazerLogin();
};
```
Permite pressionar **Enter** nos campos para logar, sem precisar clicar
no botão.

```javascript
window.esqueciSenha = async function () {
    await sendPasswordResetEmail(auth, email);
}
```
Envia um e-mail de redefinição de senha via Firebase. O link no e-mail
leva o usuário para uma página do Firebase onde ele define uma nova senha.

---

### 2.9 Estrutura HTML do Corpo

```html
<div id="login-screen"> ... </div>
```
Tela de login. Visível por padrão quando o sistema carrega.

```html
<div id="app-content" style="display:none"> ... </div>
```
O sistema completo. Começa **escondido** (`display:none`) e só aparece
após o login.

```html
<div id="loading">
    <div class="spin"></div>
    <p>Conectando ao banco de dados...</p>
</div>
```
Spinner de carregamento. Fica visível dentro do `app-content` enquanto o
Firestore não responde. Some quando os dados chegam ou após 6 segundos
(timeout de segurança).

```html
<nav>
    <button class="tab active" onclick="mudarTab('painel',this)">📊 Painel</button>
    <button class="tab" onclick="mudarTab('nova',this)">➕ Nova Venda</button>
    ...
</nav>
```
Navegação por abas. Cada botão chama `mudarTab()` passando o ID da aba
e o próprio botão (`this`).

```html
<span class="user-badge" id="user-badge"></span>
```
Exibe o nome e o ícone do usuário logado (👑 admin / 👤 funcionário).
O conteúdo é preenchido pelo JavaScript.

```html
<button class="btn-logout" onclick="window._signOut()">🚪 Sair</button>
```
Chama a função de logout que foi exportada para `window._signOut`.

---

## 3. js/script.js — Lógica do Sistema

### 3.1 Configuração Inicial

```javascript
let config = JSON.parse(localStorage.getItem('gg_config') || '{}');
```
Lê configurações gerais salvas localmente. Se não existir, usa `{}` vazio.

```javascript
let precos = JSON.parse(localStorage.getItem('gg_precos') || '{"dT1":9,"dT4":25,...}');
```
Lê os preços salvos localmente. Se não existir, usa os valores padrão
embutidos no código. As chaves dos preços seguem o padrão:
- `d` = direta, `c` = consignado, `k` = custo
- `T` = turbinado, `F` = frutífero
- `1` = 1kg, `4` = 4kg, `50` = 50kg, `100` = 100kg

```javascript
let metas = JSON.parse(localStorage.getItem('gg_metas') || '{"valor":0,"unidades":0}');
```
Lê as metas salvas. Campos: `valor` (meta de faturamento em R$) e
`unidades` (meta de unidades vendidas).

```javascript
let vendaPendente = null;
let editId = null;
```
Variáveis de estado temporário: `vendaPendente` guarda os dados de uma
venda antes de ser confirmada no modal. `editId` guarda o ID da venda
sendo editada.

---

### 3.2 Funções Utilitárias

```javascript
function el(id) { return document.getElementById(id); }
```
Atalho para `document.getElementById`. Encurta o código — em vez de
escrever `document.getElementById('qtd')` sempre, usa só `el('qtd')`.

```javascript
function vendas() { return window._vendas || []; }
```
Retorna o array de vendas carregado do Firestore. O `|| []` garante que
nunca retorna `undefined`, evitando erros se o banco ainda não carregou.

```javascript
function toast(msg, tipo = 'ok') {
    const t = el('toast');
    t.className = 'toast' + (tipo === 'err' ? ' err' : tipo === 'warn' ? ' warn' : '');
    t.innerHTML = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3800);
}
```
Exibe uma notificação temporária no canto da tela. O parâmetro `tipo`
define a cor: `'ok'` = verde, `'err'` = vermelho, `'warn'` = amarelo.
Após 3800ms (3,8 segundos), a notificação some automaticamente.

```javascript
function formatarData(d) {
    if (!d) return '';
    const [y, m, dd] = d.split('-');
    return `${dd}/${m}/${y}`;
}
```
Converte data do formato ISO `2026-10-20` para o formato brasileiro
`20/10/2026`. O `split('-')` separa por hífen gerando um array `[ano, mês, dia]`.

```javascript
function produtoLabel(v) {
    if (!v || !v.tamanho) return '?kg';
    if (v.tamanho === 'outro') return (v.peso || '?') + 'kg';
    const prodSuffix = v.produto === 'turbinado' ? ' Turbinado' : v.produto === 'frutifero' ? ' Frutífero' : '';
    return v.tamanho + 'kg' + prodSuffix;
}
```
Gera o texto de descrição do produto para exibição nas tabelas.
Exemplos: `"1kg Turbinado"`, `"4kg Frutífero"`, `"2.5kg"` (peso customizado).

---

### 3.3 Relógio

```javascript
function tick() {
    el('relogio').textContent = new Date().toLocaleString('pt-BR', {
        weekday: 'short', day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit'
    });
}
tick(); setInterval(tick, 1000);
```
Atualiza o relógio no cabeçalho a cada segundo. `tick()` é chamada
imediatamente (para não esperar 1s) e depois pelo `setInterval`.
O `toLocaleString('pt-BR', ...)` formata no padrão brasileiro:
ex. `"ter., 20 de out., 13:05"`.

---

### 3.4 Navegação por Abas

```javascript
function mudarTab(id, btn) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    el('tab-' + id).classList.add('active');
    const fns = { painel: renderPainel, historico: renderHistorico, ... };
    if (fns[id]) fns[id]();
}
```
1. Remove a classe `active` de todos os botões de aba
2. Remove a classe `active` de todos os painéis
3. Adiciona `active` ao botão clicado e ao painel correspondente
4. Chama a função de renderização da aba (se existir)

O prefixo `tab-` nos IDs dos painéis (`tab-painel`, `tab-nova`, etc.)
faz o link entre o nome da aba e o elemento HTML.

---

### 3.5 Formulário de Nova Venda

```javascript
function atualizarPreco() {
    const tipo = el('tipo-venda').value;   // 'direta' ou 'consorcio'
    const tam  = el('tamanho').value;      // '1', '4', '50', '100', 'outro'
    const prod = el('produto-tipo').value; // 'turbinado' ou 'frutifero'
    ...
    let p = '';
    if (tam === '50') { p = precos.p50; }
    else if (tam === '100') { p = precos.p100; }
    else if (prod === 'turbinado') {
        p = tam === '1' ? (tipo === 'direta' ? precos.dT1 : precos.cT1) : ...
    }
    el('valor-unit').value = parseFloat(p).toFixed(2);
}
```
Atualiza o campo "Valor Unitário" automaticamente quando o usuário muda
o tipo, tamanho ou produto. Lê os preços do objeto `precos` (que veio do
`localStorage`).

```javascript
function calcularTotal() {
    const qtd  = parseFloat(el('qtd').value) || 0;
    const unit = parseFloat(el('valor-unit').value) || 0;
    const total = (qtd * unit).toFixed(2);
    el('resumo-txt').innerHTML = `...R$ ${total}`;
}
```
Atualiza o resumo da venda em tempo real conforme o usuário digita.
O `.toFixed(2)` garante sempre 2 casas decimais.

```javascript
function lancarVenda() {
    // 1. Valida os campos obrigatórios
    if (!qtd || qtd < 1) return toast('Informe a quantidade.', 'err');
    if (!unit || unit <= 0) return toast('Informe o valor unitário.', 'err');
    if (!data) return toast('Informe a data da venda.', 'err');

    // 2. Monta o objeto da venda
    vendaPendente = { data, qtd, unit, tamanho, peso, produto, tipo,
                      cliente, pagamento, obs, total, status: 'Confirmada' };

    // 3. Preenche o modal de confirmação com os dados
    el('modal-detail').innerHTML = `...`;

    // 4. Abre o modal
    el('modal-bg').classList.add('open');
}
```
A venda **não vai para o banco ainda** — ela fica em `vendaPendente` e o
modal de confirmação é aberto para o usuário revisar os dados.

```javascript
async function confirmarVenda() {
    await window._addDoc(window._col, {
        ...vendaPendente,
        criadoEm: window._serverTimestamp()
    });
}
```
Aqui sim a venda é gravada no Firestore. O `...vendaPendente` expande
todos os campos do objeto. O `criadoEm` usa o timestamp do servidor
(não do dispositivo do usuário).

---

### 3.6 Cancelar e Editar Vendas

```javascript
async function cancelarVenda(id) {
    await window._updateDoc(window._doc(window._db, 'vendas', id), { status: 'Cancelada' });
}
```
Não deleta o registro — apenas muda o `status` para `'Cancelada'`. Isso
preserva o histórico.

```javascript
function abrirEdit(id) {
    const v = vendas().find(x => x._id === id);
    editId = id;
    el('edit-qtd').value = v.qtd;
    el('edit-valor').value = v.unit;
    ...
    el('modal-edit-bg').classList.add('open');
}
```
Busca a venda pelo ID no array local `window._vendas`, preenche os campos
do modal de edição e abre o modal.

```javascript
async function salvarEdicao() {
    await window._updateDoc(window._doc(window._db, 'vendas', editId), {
        qtd, unit, total: +(qtd * unit).toFixed(2),
        cliente, pagamento, obs
    });
}
```
Atualiza apenas os campos editáveis no Firestore. O `+` antes do
`(qtd * unit)` converte o resultado para número (o `toFixed` retorna string).

---

### 3.7 Renderização do Painel

```javascript
window.renderPainel = function () {
    const mes = new Date().toISOString().slice(0, 7); // "2026-10"
    const vMes = vendas().filter(v => v.data && v.data.startsWith(mes) && v.status !== 'Cancelada');
```
Filtra as vendas do mês atual e que não foram canceladas. O `startsWith(mes)`
funciona porque as datas estão no formato `YYYY-MM-DD` — todas do mês
`2026-10` começam com `"2026-10"`.

```javascript
    const lucro = vMes.reduce((s, v) => {
        let c; // custo unitário
        if (v.tamanho === '50') c = precos.k50;
        else if (v.tamanho === '100') c = precos.k100;
        else if (v.produto === 'turbinado') c = v.tamanho === '1' ? precos.kT1 : precos.kT4;
        ...
        return s + (v.unit - c) * v.qtd; // lucro = (preço - custo) × qtd
    }, 0);
```
Calcula o lucro líquido: para cada venda, subtrai o custo do preço e
multiplica pela quantidade.

```javascript
    el('cards-painel').innerHTML = `
        <div class="card">Faturamento do Mês: R$ ${fat.toFixed(2)}</div>
        ...
        <div class="card">Sua Parte (25%): R$ ${(lucro * .25).toFixed(2)}</div>
    `;
```
Os 25% representam a divisão de lucro entre os sócios.

---

### 3.8 Renderização do Histórico

```javascript
window.renderHistorico = function () {
    const mes = el('filtro-mes')?.value;
    const lista = mes ? vendas().filter(v => v.data && v.data.startsWith(mes)) : vendas();
```
O `?.value` é optional chaining — se o elemento não existir, retorna
`undefined` em vez de erro. O filtro de mês é opcional.

```javascript
        <td><div class="btn-row">
            ${(v.status || 'Confirmada') !== 'Cancelada'
                ? `<button onclick="abrirEdit('${v._id}')">✏️</button>
                   <button onclick="cancelarVenda('${v._id}')">❌</button>`
                : '–'}
        </div></td>
```
Vendas canceladas não mostram os botões de editar/cancelar — só um traço.

---

### 3.9 Renderização Semanal

```javascript
const dom = new Date(hoje + 'T12:00:00');
dom.setDate(dom.getDate() - dom.getDay());
const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(dom); d.setDate(dom.getDate() + i);
    return d.toISOString().slice(0, 10);
});
```
Calcula os 7 dias da semana atual, começando no domingo. O `dom.getDay()`
retorna o dia da semana (0=Dom, 1=Seg...6=Sáb). O `T12:00:00` evita
problemas de fuso horário que podem mudar a data.

---

### 3.10 Metas

```javascript
function salvarMeta() {
    metas.valor    = parseFloat(el('meta-valor').value) || 0;
    metas.unidades = parseInt(el('meta-unidades').value) || 0;
    localStorage.setItem('gg_metas', JSON.stringify(metas));
    renderMeta();
}
```
As metas são salvas **localmente** (localStorage), não no Firestore.
Isso significa que cada dispositivo tem suas próprias metas.

---

### 3.11 Configuração de Preços

```javascript
function carregarConfig() {
    if (el('preco-1kg-d-t')) el('preco-1kg-d-t').value = precos.dT1;
    ...
}
```
Preenche os campos do formulário de Config com os valores do objeto
`precos`. O `if (el(...))` evita erro caso o elemento não exista.

```javascript
function salvarPrecos() {
    precos.dT1 = parseFloat(el('preco-1kg-d-t').value) || 9;
    ...
    localStorage.setItem('gg_precos', JSON.stringify(precos));
    toast('✅ Preços salvos!');
}
```
Lê todos os campos do formulário, atualiza o objeto `precos` e salva
no `localStorage`. Os preços são salvos **localmente** — cada dispositivo
tem seus próprios preços. O `|| 9` define um valor padrão caso o campo
esteja vazio.

---

### 3.12 Exportação de PDF

```javascript
function exportarPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    ...
    doc.setFillColor(26, 107, 60); // cor verde para o cabeçalho
    doc.rect(14, y - 5, 182, 7, 'F'); // retângulo preenchido
    ...
    lista.forEach((v, i) => {
        if (y > 270) { doc.addPage(); y = 20; } // nova página se necessário
        if (i % 2 === 0) { doc.setFillColor(245, 248, 245); ... } // linhas alternadas
    });
    doc.save(`Relatorio_GabrielGatti_${mes || 'completo'}.pdf`);
}
```
Gera um PDF formatado com:
- Cabeçalho com nome da empresa e CNPJ
- Tabela com fundo alternado (linhas pares têm fundo cinza claro)
- Quebra de página automática quando o conteúdo passa de 270mm
- Download automático no nome `Relatorio_GabrielGatti_AAAA-MM.pdf`

---

### 3.13 Exportação de CSV

```javascript
function exportarCSV() {
    const header = 'Data,Cliente,Produto,...\n';
    const rows = lista.map(v => `${v.data},"${v.cliente}","Adubo ${produtoLabel(v)}",...`).join('\n');
    const blob = new Blob(['﻿' + header + rows], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Vendas_GabrielGatti_${mes}.csv`;
    a.click();
}
```
O `'﻿'` é o BOM (Byte Order Mark) — sem ele, o Excel abre o CSV
sem suporte a acentos. O arquivo é criado como um `Blob` na memória e
o download é disparado simulando um clique num link invisível.

---

### 3.14 Inicialização

```javascript
(function init() {
    const hoje = new Date().toISOString().slice(0, 10);
    if (el('data-venda')) el('data-venda').value = hoje;       // data atual no form
    if (el('filtro-mes')) el('filtro-mes').value = hoje.slice(0, 7); // mês atual no filtro
    atualizarPreco();   // preenche o preço inicial baseado nos selects padrão
    carregarConfig();   // carrega os preços nos campos de config
})();
```
Função auto-executável (IIFE). Roda uma vez quando o script carrega.
Define os valores iniciais do formulário: data de hoje e mês atual.

---

## 4. css/style.css — Estilos Resumidos

O CSS usa **variáveis CSS** (`:root`) para centralizar as cores do tema:

```css
:root {
    --verde:   #1a6b3c;   /* verde escuro — cor principal da marca */
    --neon:    #4ade80;   /* verde neon — destaques e valores */
    --fundo:   #0d1117;   /* fundo escuro da página */
    --card:    #161b22;   /* fundo dos cards e boxes */
    --borda:   #30363d;   /* bordas e separadores */
    --branco:  #e6edf3;   /* texto principal */
    --cinza:   #8b949e;   /* texto secundário */
    --amarelo: #f0c040;   /* avisos */
    --vermelho:#f85149;   /* erros e cancelamentos */
}
```

**Principais classes:**

| Classe            | Uso                                                   |
|-------------------|-------------------------------------------------------|
| `.hidden`         | `display: none` — oculta elemento                     |
| `.spin`           | Animação de spinner (loading)                         |
| `.tab`            | Botão de aba na navegação                             |
| `.tab.active`     | Aba atualmente selecionada                            |
| `.panel`          | Painel de conteúdo (oculto por padrão)                |
| `.panel.active`   | Painel visível                                        |
| `.card`           | Card de estatística (faturamento, unidades, etc.)     |
| `.box`            | Container com borda para seções de conteúdo           |
| `.badge-ok`       | Badge verde "Confirmada"                              |
| `.badge-cancel`   | Badge vermelho "Cancelada"                            |
| `.toast`          | Notificação temporária                                |
| `.modal-bg`       | Fundo escurecido do modal                             |
| `.modal-bg.open`  | Modal visível                                         |
| `.btn-primary`    | Botão verde principal                                 |
| `.btn-danger`     | Botão vermelho (cancelar/excluir)                     |
| `.btn-ghost`      | Botão transparente com borda                          |
| `.prog-bar`       | Barra de progresso das metas                          |
| `.prog-fill`      | Preenchimento da barra de progresso                   |
| `.week-grid`      | Grade dos dias da semana                              |
| `.day-card.today` | Destaque para o dia atual na visão semanal            |
| `.settings-grid`  | Grid de 2 colunas para os campos de configuração      |
| `.tbl-wrap`       | Wrapper com scroll horizontal para as tabelas         |
| `.user-badge`     | Badge do usuário logado no cabeçalho                  |
| `.sync-dot`       | Ponto verde animado de sincronização ao lado do relógio|

---

## 5. Acesso ao Sistema — Como Funciona

O sistema só exibe as telas e consulta os dados depois que o usuário entra com
uma conta Firebase Authentication. Sem uma sessão autenticada, permanece na
tela de login. Para encerrar a sessão, use o botão **Sair da conta**.

### Autorização de domínio para login

Para autenticar pelo domínio personalizado, configure o endereço nos dois
lugares abaixo:

1. No Firebase Console, em **Authentication → Settings → Authorized domains**,
   adicione `gattiadubo.davitech.com.br` (sem `https://` ou `/`).
2. No Google Cloud Console do projeto `gabriel-gatti-vendas`, abra
   **APIs e serviços → Credenciais** e selecione a chave de API usada pelo
   site. Se a chave tiver restrição de aplicativo por **Sites**, inclua
   `https://gattiadubo.davitech.com.br/*` nos sites autorizados. Inclua também
   `https://www.gattiadubo.davitech.com.br/*` somente se esse endereço for
   utilizado.

Se a chave não tiver restrição por site, não é necessário alterá-la. Se houver
restrições de APIs, mantenha liberadas as APIs necessárias ao Firebase
Authentication. Após salvar, teste o login no domínio personalizado.

### Segurança

As regras do Firestore também devem exigir autenticação; esconder a interface
no navegador não substitui as regras de acesso do banco.

---

## 6. Fluxo Completo de uma Venda

```
1. Usuário abre a aba "Nova Venda"

2. Seleciona: Tipo de Produto, Tipo de Venda, Tamanho
   → atualizarPreco() preenche automaticamente o Valor Unitário

3. Digita a quantidade
   → calcularTotal() atualiza o resumo em tempo real

4. Informa cliente, pagamento, data e observações

5. Clica "🚀 Lançar Venda"
   → lancarVenda() valida os campos
   → se OK: preenche vendaPendente e abre o modal de confirmação

6. Modal exibe o resumo completo para revisão

7a. Clica "✅ Confirmar"
    → confirmarVenda() grava no Firestore com serverTimestamp
    → onSnapshot detecta a mudança e re-renderiza todas as abas
    → Modal fecha, formulário limpa, toast de sucesso aparece

7b. Clica "❌ Cancelar"
    → fecharModal() fecha o modal e limpa vendaPendente
    → Nada é gravado
```

---

## 7. Tabela de Preços e chaves localStorage

### Chave gg_precos

| Chave  | Descrição                          | Padrão  |
|--------|------------------------------------|---------|
| `dT1`  | Venda Direta Turbinado 1kg         | R$ 9,00 |
| `dT4`  | Venda Direta Turbinado 4kg         | R$ 25,00|
| `cT1`  | Consignado Turbinado 1kg           | R$ 12,00|
| `cT4`  | Consignado Turbinado 4kg           | R$ 20,00|
| `kT1`  | Custo Turbinado 1kg                | R$ 3,00 |
| `kT4`  | Custo Turbinado 4kg                | R$ 7,00 |
| `dF1`  | Venda Direta Frutífero 1kg         | R$ 12,00|
| `dF4`  | Venda Direta Frutífero 4kg         | R$ 7,00 |
| `cF1`  | Consignado Frutífero 1kg           | R$ 35,00|
| `cF4`  | Consignado Frutífero 4kg           | R$ 20,00|
| `kF1`  | Custo Frutífero 1kg                | R$ 4,00 |
| `kF4`  | Custo Frutífero 4kg                | R$ 8,00 |
| `p50`  | Preço embalagem 50kg               | R$ 270,00|
| `k50`  | Custo embalagem 50kg               | R$ 88,00|
| `p100` | Preço embalagem 100kg              | R$ 400,00|
| `k100` | Custo embalagem 100kg              | R$ 175,00|

### Chave gg_metas

| Campo      | Descrição                  |
|------------|----------------------------|
| `valor`    | Meta de faturamento mensal |
| `unidades` | Meta de unidades vendidas  |

### Estrutura de um documento no Firestore (coleção "vendas")

| Campo       | Tipo      | Descrição                           |
|-------------|-----------|-------------------------------------|
| `data`      | string    | Data no formato YYYY-MM-DD          |
| `qtd`       | number    | Quantidade de unidades              |
| `unit`      | number    | Valor unitário em R$                |
| `total`     | number    | Total (qtd × unit)                  |
| `tamanho`   | string    | '1', '4', '50', '100' ou 'outro'    |
| `peso`      | string    | Peso em kg (só quando tamanho=outro)|
| `produto`   | string    | 'turbinado' ou 'frutifero'          |
| `tipo`      | string    | 'direta' ou 'consorcio'             |
| `cliente`   | string    | Nome do cliente                     |
| `responsavel` | string  | Nome do responsável pela venda (campo já usado nos registros do banco) |
| `vendedor`  | string    | Alias do responsável, mantido para compatibilidade com a aplicação |
| `vendedorEmail` | string | E-mail Firebase usado para identificar o vendedor |
| `vendedorUid` | string  | UID Firebase do usuário que lançou a venda |
| `pagamento` | string    | Dinheiro, PIX, Cartão ou A prazo    |
| `obs`       | string    | Observações opcionais               |
| `status`    | string    | 'Confirmada' ou 'Cancelada'         |
| `criadoEm`  | Timestamp | Timestamp do servidor Firebase      |

---

## 8. Webhook Sendfy — Cloudflare Pages

A função `functions/api/webhook-venda.js` recebe os pedidos da Sendfy no
endereço `https://gattiadubo.davitech.com.br/api/webhook-venda`. Ela valida
o token e os dados do pedido, consulta a coleção `produtos` no Firestore e
cria a venda em `vendas`. Reenvios do mesmo pedido na mesma janela de dois
minutos não duplicam o documento.

### Configuração no Cloudflare Pages

O projeto Pages deve publicar a pasta `functions/` junto com os arquivos
estáticos do site. Configure as seguintes variáveis em **Settings → Variables
and Secrets** para o ambiente de produção (e também para Preview, se for
testar por lá):

| Nome | Configuração |
|------|--------------|
| `FIREBASE_PROJECT_ID` | ID do projeto Firebase |
| `FIREBASE_CLIENT_EMAIL` | E-mail da conta de serviço Firebase |
| `FIREBASE_PRIVATE_KEY` | Secret: chave privada PEM da conta de serviço |
| `WEBHOOK_TOKEN` | Secret: token compartilhado com a Sendfy |

Crie uma conta de serviço no Google Cloud associada ao projeto Firebase e
conceda a ela somente o papel **Cloud Datastore User**. Cadastre a chave
privada como secret; não a inclua nos arquivos do site nem no Git. A função
usa essa chave para obter um token OAuth e acessar a API REST do Firestore.
Confirme também que a **Cloud Firestore API** está habilitada no projeto
Google Cloud.

### Configuração da Sendfy

Configure o webhook de saída para enviar um `POST` à URL acima. Envie o token
no cabeçalho `X-Webhook-Token` (preferencial) ou no campo `token` do corpo.
O corpo pode ser JSON ou `application/x-www-form-urlencoded` e deve conter:
telefone, nome do cliente, linha (`Turbinado` ou `Frutífera`), tamanho em kg,
quantidade e forma de pagamento. O nome aceita `name`, `nome` ou `cliente`;
o telefone aceita `phone`, `whatsapp_number` ou `telefone`.

Depois de salvar as variáveis, publique uma nova versão do projeto Pages e
atualize na Sendfy qualquer URL antiga `/.netlify/functions/webhook-venda`
para `/api/webhook-venda`. Os testes automatizados do endpoint são executados
com `npm test`.

---

## 9. Aplicativo Android e iOS

O aplicativo é criado com Capacitor e reutiliza a interface web e o mesmo
Firebase/Cloudflare. A configuração fica em `capacitor.config.json`; o
conteúdo web que vai para os apps é gerado em `dist/` pelo script
`scripts/build.js`. Os projetos nativos ficam nas pastas `android/` e `ios/`,
e os ícones e telas de abertura usam as imagens em `assets/`.

### Desenvolvimento

1. Instale Node.js 22 ou superior e execute `npm install`.
2. Para atualizar a interface dentro dos projetos nativos, execute
   `npm run cap:sync`.
3. Abra o Android Studio com `npm run android:open` ou abra o projeto
   `ios/App/App.xcworkspace` no Xcode com `npm run ios:open`.
4. Execute o app em um emulador ou dispositivo pela IDE. Para publicar,
   configure a assinatura Android e os certificados/perfis Apple.

O Android pode ser compilado em Linux com Android Studio e Android SDK
instalados. A compilação e publicação para iOS exigem macOS e Xcode. Este
repositório contém os projetos nativos, mas não inclui os arquivos de
assinatura das lojas.

O site continua sendo publicado no Cloudflare Pages. Quando o app chama o
mesmo Firebase, as coleções Firestore continuam sincronizadas entre os
usuários; dados de preço e metas mantidos em `localStorage` continuam
específicos de cada instalação/dispositivo.

---

*Documentação gerada automaticamente com base no código-fonte do Sistema de Vendas Gabriel Gatti v3.0*
