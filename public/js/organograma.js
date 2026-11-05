// Organograma interativo: árvore com expandir/recolher, zoom e arraste, busca, filtro por diretoria e detalhes.
const W = 232, H = 104;           // tamanho do cartão (igual ao CSS)
const GX = 22, GY = 52;           // espaço entre equipes lado a lado / entre níveis
const GX_BLOCO = 40, GY_BLOCO = 18; // equipe sem subordinados: duas colunas em volta de uma linha central
const GAP_RAIZES = 80;

const org = {
  nos: [], porId: new Map(), filhos: new Map(), equipe: new Map(),
  abertos: new Set(), raizes: [], filtro: '', foco: null, selecionado: null, eu: null,
  pos: new Map(), largura: 0, altura: 0,
  vista: { x: 0, y: 0, s: 1 },
};

const $ = (id) => document.getElementById(id);
const palco = $('palco'), mundo = $('mundo');
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmt = (n) => n.toLocaleString('pt-BR');

/** Texto escuro sobre cores claras (N6 a N8) e branco sobre as escuras. */
function corTexto(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#1d2b36' : '#ffffff';
}

// ---------- dados ----------

async function carregar() {
  let dados;
  try {
    dados = await api('/api/organograma');
  } catch (err) {
    if (err.status === 401) { location.replace('index.html'); return; }
    $('topo-info').textContent = 'Não foi possível carregar';
    toast(err.message, 'erro');
    return;
  }
  org.nos = dados.nos;
  org.niveis = dados.niveis;
  org.eu = dados.eu?.id || null;
  org.porId = new Map(org.nos.map(n => [n.id, n]));
  org.filhos = new Map(org.nos.map(n => [n.id, []]));
  for (const n of org.nos) if (n.gestor) org.filhos.get(n.gestor).push(n.id);
  for (const lista of org.filhos.values()) lista.sort(ordenar);
  // Tamanho da estrutura abaixo de cada pessoa (de baixo para cima).
  const contar = (id) => {
    let total = 0;
    for (const f of org.filhos.get(id)) total += 1 + contar(f);
    org.equipe.set(id, total);
    return total;
  };
  org.nos.filter(n => !n.gestor).forEach(n => contar(n.id));

  const pessoas = org.nos.filter(n => !n.virtual).length;
  const data = dados.importado_em ? new Date(dados.importado_em.replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR') : '';
  $('topo-info').textContent = pessoas ? `${fmt(pessoas)} colaboradores · ${dados.diretorias.filter(d => d !== 'Presidência').length} diretorias${data ? ` · base de ${data}` : ''}` : 'Organograma';
  $('topo-nome').textContent = dados.eu?.nome || (dados.admin ? 'RH' : '');
  $('link-rh').hidden = !dados.admin;
  $('eu').hidden = !org.eu;

  const sel = $('filtro-diretoria');
  for (const d of dados.diretorias) sel.add(new Option(d, d));
  $('lista-niveis').innerHTML = org.niveis.map(n =>
    `<li><span class="bolinha" style="--cor:${n.cor}"></span><b>N${n.nivel}</b>${esc(n.nome)}</li>`).join('');
  $('bolinhas-niveis').innerHTML = org.niveis.map(n => `<span class="bolinha" style="--cor:${n.cor}"></span>`).join('');

  if (!org.nos.length) {
    mostrarVazio(dados.admin ? 'A base ainda não foi importada. Importe a planilha na Área do RH.' : 'O organograma ainda não foi publicado pelo RH.');
    return;
  }
  definirRaizes();
  org.raizes.slice(0, 1).forEach(id => org.abertos.add(id));
  if (org.eu) {
    abrirCaminho(org.eu);
    desenhar();
    centralizar(org.eu, 0.85);
    selecionar(org.eu, false);
  } else {
    desenhar();
    ajustar();
  }
}

function ordenar(a, b) {
  const na = org.porId.get(a), nb = org.porId.get(b);
  return na.nivel - nb.nivel || (org.filhos.get(b).length > 0) - (org.filhos.get(a).length > 0) || na.nome.localeCompare(nb.nome, 'pt-BR');
}

const noFiltro = (n) => !org.filtro || n.diretoria === org.filtro;
const filhosVisiveis = (id) => org.filhos.get(id).filter(f => noFiltro(org.porId.get(f)));

/** Topo da estrutura conforme o foco ("ver a partir desta pessoa") e o filtro de diretoria. */
function definirRaizes() {
  if (org.foco) org.raizes = [org.foco];
  else if (org.filtro) {
    org.raizes = org.nos.filter(n => noFiltro(n) && (!n.gestor || !noFiltro(org.porId.get(n.gestor)))).map(n => n.id)
      .sort((a, b) => org.porId.get(a).nivel - org.porId.get(b).nivel || org.equipe.get(b) - org.equipe.get(a));
  } else {
    org.raizes = org.nos.filter(n => !n.gestor).map(n => n.id).sort((a, b) => org.equipe.get(b) - org.equipe.get(a));
  }
}

function ancestrais(id) {
  const lista = [];
  let n = org.porId.get(id);
  while (n?.gestor) { lista.push(n.gestor); n = org.porId.get(n.gestor); }
  return lista;
}

/** Garante que a pessoa aparece: limpa foco/filtro que a escondem e abre os gestores acima dela. */
function abrirCaminho(id) {
  const n = org.porId.get(id);
  if (org.filtro && !noFiltro(n)) { org.filtro = ''; $('filtro-diretoria').value = ''; }
  if (org.foco && org.foco !== id && !ancestrais(id).includes(org.foco)) definirFoco(null, false);
  definirRaizes();
  for (const a of ancestrais(id)) {
    org.abertos.add(a);
    if (org.raizes.includes(a)) break;
  }
}

// ---------- layout ----------

/** Mede a subárvore: equipes com subordinados lado a lado; quem não tem equipe fica em duas colunas. */
function medir(id) {
  const filhos = org.abertos.has(id) ? filhosVisiveis(id) : [];
  if (!filhos.length) return { id, w: W, h: H, itens: [], larguraLinha: 0 };
  const subs = filhos.map(medir);
  const folhas = subs.filter(s => !s.itens.length);
  const ramos = subs.filter(s => s.itens.length);
  const usarBloco = folhas.length >= 3 || (folhas.length >= 2 && ramos.length > 0);

  let itens;
  if (usarBloco) {
    const colunas = 2, linhas = Math.ceil(folhas.length / colunas);
    const bloco = { bloco: true, folhas: folhas.map(f => f.id), colunas, w: colunas * W + GX_BLOCO, h: linhas * H + (linhas - 1) * GY_BLOCO };
    const metade = Math.ceil(ramos.length / 2);
    itens = [...ramos.slice(0, metade), bloco, ...ramos.slice(metade)];
  } else itens = subs;

  const larguraLinha = itens.reduce((t, i) => t + i.w, 0) + GX * (itens.length - 1);
  const alturaLinha = Math.max(...itens.map(i => i.h));
  return { id, w: Math.max(W, larguraLinha), h: H + GY + alturaLinha, itens, larguraLinha };
}

function posicionar(caixa, x, y, linhas) {
  const px = x + (caixa.w - W) / 2;
  org.pos.set(caixa.id, { x: px, y });
  if (!caixa.itens.length) return;
  const cy = y + H + GY, barra = y + H + GY / 2, centro = px + W / 2;
  let cx = x + (caixa.w - caixa.larguraLinha) / 2;
  const pontos = [centro];
  linhas.push(`M${centro} ${y + H}V${barra}`);
  for (const item of caixa.itens) {
    if (item.bloco) {
      const espinha = cx + W + GX_BLOCO / 2;
      pontos.push(espinha);
      let fim = cy;
      item.folhas.forEach((fid, i) => {
        const col = i % item.colunas, lin = Math.floor(i / item.colunas);
        const fx = cx + col * (W + GX_BLOCO), fy = cy + lin * (H + GY_BLOCO);
        org.pos.set(fid, { x: fx, y: fy });
        const meio = fy + H / 2;
        linhas.push(`M${espinha} ${meio}H${col === 0 ? fx + W : fx}`);
        fim = meio;
      });
      linhas.push(`M${espinha} ${barra}V${fim}`);
    } else {
      const topo = cx + item.w / 2;
      pontos.push(topo);
      linhas.push(`M${topo} ${barra}V${cy}`);
      posicionar(item, cx, cy, linhas);
    }
    cx += item.w + GX;
  }
  linhas.push(`M${Math.min(...pontos)} ${barra}H${Math.max(...pontos)}`);
}

function desenhar() {
  org.pos = new Map();
  const linhas = [];
  let x = 0, altura = 0;
  for (const r of org.raizes) {
    const caixa = medir(r);
    posicionar(caixa, x, 0, linhas);
    x += caixa.w + GAP_RAIZES;
    altura = Math.max(altura, caixa.h);
  }
  org.largura = Math.max(0, x - GAP_RAIZES);
  org.altura = altura;

  const svg = $('linhas');
  svg.setAttribute('width', org.largura);
  svg.setAttribute('height', org.altura + 20);
  $('caminho').setAttribute('d', linhas.join(''));

  let html = '';
  for (const [id, p] of org.pos) html += cartao(org.porId.get(id), p);
  $('cartoes').innerHTML = html;
  $('vazio').hidden = org.pos.size > 0;
  if (!org.pos.size) $('vazio').textContent = 'Nenhuma pessoa nesta diretoria.';
  aplicarVista();
}

function cartao(n, p) {
  const filhos = filhosVisiveis(n.id).length;
  const aberto = org.abertos.has(n.id);
  const classes = ['no', n.virtual && 'virtual', org.selecionado === n.id && 'selecionado', org.eu === n.id && 'eu'].filter(Boolean).join(' ');
  const faixa = n.virtual ? 'Fora da base' : (n.setor || n.diretoria || '');
  const botao = filhos
    ? `<button class="no-abrir${aberto ? ' aberto' : ''}" data-abrir="${n.id}" aria-expanded="${aberto}"
         aria-label="${aberto ? 'Recolher' : 'Expandir'} a equipe de ${esc(n.nome)} (${filhos})">${aberto ? '−' : `${filhos} ▾`}</button>`
    : '';
  return `<div class="${classes}" data-id="${n.id}" style="left:${p.x}px;top:${p.y}px;--cor:${n.cor};--cor-txt:${corTexto(n.cor)}"
      role="button" tabindex="-1" aria-label="${esc(n.nome)}, ${esc(n.funcao)}">
    <div class="no-faixa">${esc(faixa)}</div>
    <div class="no-corpo">
      <strong class="no-nome" title="${esc(n.nome)}">${esc(n.nome)}</strong>
      <span class="no-nivel">N${n.nivel}</span>
      <span class="no-funcao" title="${esc(n.funcao)}">${esc(n.funcao)}</span>
    </div>${botao}
  </div>`;
}

function mostrarVazio(msg) {
  $('vazio').hidden = false;
  $('vazio').textContent = msg;
  $('topo-info').textContent = 'Organograma';
}

// ---------- zoom e arraste ----------

const limitar = (s) => Math.min(2, Math.max(0.12, s));

function aplicarVista() {
  const { x, y, s } = org.vista;
  mundo.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  $('zoom-valor').textContent = `${Math.round(s * 100)}%`;
}

function zoomEm(px, py, novo) {
  const v = org.vista, s = limitar(novo);
  v.x = px - (px - v.x) * (s / v.s);
  v.y = py - (py - v.y) * (s / v.s);
  v.s = s;
  aplicarVista();
}

function ajustar() {
  const r = palco.getBoundingClientRect();
  if (!org.largura) return;
  const s = limitar(Math.min((r.width - 60) / org.largura, (r.height - 60) / (org.altura + 20), 1));
  org.vista = { s, x: (r.width - org.largura * s) / 2, y: 30 };
  aplicarVista();
}

function centralizar(id, escala) {
  const p = org.pos.get(id);
  if (!p) return;
  const r = palco.getBoundingClientRect();
  const s = escala ? limitar(escala) : org.vista.s;
  const painel = !$('detalhe').hidden && r.width > 900 ? 360 : 0;
  org.vista = { s, x: (r.width - painel) / 2 - (p.x + W / 2) * s, y: r.height / 3 - (p.y + H / 2) * s };
  aplicarVista();
}

/** Redesenha mantendo um cartão no mesmo lugar da tela (ao abrir/fechar uma equipe). */
function redesenharAncorado(id) {
  const antes = org.pos.get(id);
  desenhar();
  const depois = org.pos.get(id);
  if (antes && depois) {
    org.vista.x += (antes.x - depois.x) * org.vista.s;
    org.vista.y += (antes.y - depois.y) * org.vista.s;
    aplicarVista();
  }
}

const ponteiros = new Map();
let arraste = null, pinca = null, moveu = false;

palco.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.legenda, button')) return;
  ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
  moveu = false;
  if (ponteiros.size === 1) arraste = { x: e.clientX, y: e.clientY, vx: org.vista.x, vy: org.vista.y };
  if (ponteiros.size === 2) {
    const [a, b] = [...ponteiros.values()];
    pinca = { d: Math.hypot(a.x - b.x, a.y - b.y), s: org.vista.s };
    arraste = null;
  }
});
palco.addEventListener('pointermove', (e) => {
  if (!ponteiros.has(e.pointerId)) return;
  ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinca && ponteiros.size === 2) {
    const [a, b] = [...ponteiros.values()];
    const r = palco.getBoundingClientRect();
    zoomEm((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, pinca.s * Math.hypot(a.x - b.x, a.y - b.y) / pinca.d);
    moveu = true;
  } else if (arraste) {
    const dx = e.clientX - arraste.x, dy = e.clientY - arraste.y;
    if (!moveu && Math.abs(dx) + Math.abs(dy) > 4) {
      // Só captura o ponteiro quando vira arraste, para o clique continuar chegando ao cartão.
      moveu = true;
      palco.classList.add('arrastando');
      palco.setPointerCapture(e.pointerId);
    }
    if (!moveu) return;
    org.vista.x = arraste.vx + dx;
    org.vista.y = arraste.vy + dy;
    aplicarVista();
  }
});
const soltar = (e) => {
  ponteiros.delete(e.pointerId);
  if (ponteiros.size < 2) pinca = null;
  if (!ponteiros.size) { arraste = null; palco.classList.remove('arrastando'); }
};
palco.addEventListener('pointerup', soltar);
palco.addEventListener('pointercancel', soltar);

palco.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = palco.getBoundingClientRect();
  if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) zoomEm(e.clientX - r.left, e.clientY - r.top, org.vista.s * Math.exp(-e.deltaY * 0.0015));
  else { org.vista.x -= e.deltaX; aplicarVista(); }
}, { passive: false });

palco.addEventListener('click', (e) => {
  if (moveu) return;
  const abrir = e.target.closest('[data-abrir]');
  if (abrir) { alternar(Number(abrir.dataset.abrir)); return; }
  const no = e.target.closest('.no');
  if (no) selecionar(Number(no.dataset.id));
});

palco.addEventListener('keydown', (e) => {
  const passo = 60;
  const r = palco.getBoundingClientRect();
  const acoes = {
    ArrowLeft: () => { org.vista.x += passo; }, ArrowRight: () => { org.vista.x -= passo; },
    ArrowUp: () => { org.vista.y += passo; }, ArrowDown: () => { org.vista.y -= passo; },
    '+': () => zoomEm(r.width / 2, r.height / 2, org.vista.s * 1.2), '-': () => zoomEm(r.width / 2, r.height / 2, org.vista.s / 1.2),
  };
  if (acoes[e.key]) { e.preventDefault(); acoes[e.key](); aplicarVista(); }
});

function zoomCentro(fator) {
  const r = palco.getBoundingClientRect();
  zoomEm(r.width / 2, r.height / 2, org.vista.s * fator);
}
$('zoom-mais').addEventListener('click', () => zoomCentro(1.25));
$('zoom-menos').addEventListener('click', () => zoomCentro(1 / 1.25));
$('ajustar').addEventListener('click', ajustar);

// ---------- expandir / recolher ----------

function alternar(id) {
  if (org.abertos.has(id)) {
    // Fecha a equipe e tudo o que estava aberto abaixo dela.
    const fechar = (x) => { org.abertos.delete(x); org.filhos.get(x).forEach(fechar); };
    fechar(id);
  } else org.abertos.add(id);
  redesenharAncorado(id);
}

$('expandir').addEventListener('click', () => {
  const visiveis = [...org.pos.keys()].filter(id => filhosVisiveis(id).length && !org.abertos.has(id));
  if (!visiveis.length) { toast('Toda a estrutura visível já está aberta.'); return; }
  visiveis.forEach(id => org.abertos.add(id));
  desenhar();
  ajustar();
});

$('recolher').addEventListener('click', () => {
  org.abertos = new Set(org.raizes.slice(0, org.foco || org.filtro ? org.raizes.length : 1));
  desenhar();
  ajustar();
});

$('eu').addEventListener('click', () => irPara(org.eu));

// ---------- seleção e painel de detalhes ----------

function selecionar(id, abrirPainel = true) {
  org.selecionado = id;
  document.querySelectorAll('.no.selecionado').forEach(el => el.classList.remove('selecionado'));
  document.querySelector(`.no[data-id="${id}"]`)?.classList.add('selecionado');
  if (abrirPainel) mostrarDetalhe(id);
}

function linhaPessoa(n) {
  return `<li><button data-ir="${n.id}"><span class="bolinha" style="--cor:${n.cor}"></span>
    <span><strong>${esc(n.nome)}</strong><small>N${n.nivel} · ${esc(n.funcao)}</small></span></button></li>`;
}

function mostrarDetalhe(id) {
  const n = org.porId.get(id);
  const gestor = n.gestor && org.porId.get(n.gestor);
  const diretos = org.filhos.get(id).map(f => org.porId.get(f));
  const nivel = org.niveis.find(x => x.nivel === n.nivel);
  const campo = (rotulo, valor) => (valor ? `<dt>${rotulo}</dt><dd>${esc(valor)}</dd>` : '');
  const painel = $('detalhe');
  painel.style.setProperty('--cor', n.cor);
  painel.style.setProperty('--cor-txt', corTexto(n.cor));
  painel.innerHTML = `
    <div class="detalhe-cab">
      <small>N${n.nivel} · ${esc(nivel?.nome || '')}</small>
      <h2>${esc(n.nome)}</h2>
      <p>${esc(n.funcao)}</p>
      ${n.virtual ? '<span class="tag-fora">Gestor fora da base importada</span>' : ''}
      <button class="detalhe-fechar" id="fechar-detalhe" aria-label="Fechar">×</button>
    </div>
    <div class="detalhe-corpo">
      <dl>
        ${campo('Diretoria', n.diretoria)}${campo('Setor', n.setor)}${campo('Seção', n.secao)}
        ${campo('Filial', n.filial)}${n.situacao && n.situacao !== 'Ativo' ? campo('Situação', n.situacao) : ''}
      </dl>
      <div class="numeros">
        <div><strong>${fmt(diretos.length)}</strong><span>liderados diretos</span></div>
        <div><strong>${fmt(org.equipe.get(id))}</strong><span>pessoas na estrutura</span></div>
      </div>
      ${gestor ? `<div><h3>Gestor</h3><ul class="pessoas">${linhaPessoa(gestor)}</ul></div>` : ''}
      ${diretos.length ? `<div><h3>Equipe direta <span>${diretos.length}</span></h3><ul class="pessoas">${diretos.map(linhaPessoa).join('')}</ul></div>` : ''}
      <div class="detalhe-acoes">
        <button class="btn btn-marinho btn-sm" id="det-centralizar">Centralizar</button>
        ${diretos.length && org.foco !== id ? '<button class="btn btn-laranja btn-sm" id="det-foco">Ver estrutura a partir daqui</button>' : ''}
      </div>
    </div>`;
  painel.hidden = false;
  $('fechar-detalhe').addEventListener('click', fecharDetalhe);
  $('det-centralizar').addEventListener('click', () => irPara(id));
  $('det-foco')?.addEventListener('click', () => definirFoco(id));
  painel.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => irPara(Number(b.dataset.ir))));
}

function fecharDetalhe() {
  $('detalhe').hidden = true;
  org.selecionado = null;
  document.querySelectorAll('.no.selecionado').forEach(el => el.classList.remove('selecionado'));
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('detalhe').hidden) fecharDetalhe(); });

/** Abre o caminho até a pessoa, centraliza, destaca e mostra os detalhes. */
function irPara(id) {
  abrirCaminho(id);
  desenhar();
  selecionar(id);
  centralizar(id, Math.max(org.vista.s, 0.75));
  const el = document.querySelector(`.no[data-id="${id}"]`);
  if (el) { el.classList.remove('piscar'); void el.offsetWidth; el.classList.add('piscar'); }
}

function definirFoco(id, redesenhar = true) {
  org.foco = id;
  const chip = $('chip-foco');
  if (id) {
    org.filtro = '';
    $('filtro-diretoria').value = '';
    org.abertos.add(id);
    chip.innerHTML = `Estrutura de ${esc(org.porId.get(id).nome)} <button aria-label="Ver organograma completo" title="Ver organograma completo">×</button>`;
    chip.hidden = false;
    chip.querySelector('button').addEventListener('click', () => definirFoco(null));
  } else chip.hidden = true;
  if (!redesenhar) return;
  definirRaizes();
  desenhar();
  ajustar();
}

$('filtro-diretoria').addEventListener('change', (e) => {
  org.filtro = e.target.value;
  org.foco = null;
  $('chip-foco').hidden = true;
  definirRaizes();
  // Com filtro, já abre as raízes da diretoria e as equipes logo abaixo delas.
  org.abertos = new Set(org.filtro ? org.raizes.flatMap(r => [r, ...filhosVisiveis(r)]) : org.raizes.slice(0, 1));
  desenhar();
  ajustar();
});

// ---------- busca ----------

const busca = $('busca'), sugestoes = $('sugestoes');
let resultados = [], marcado = -1;

function pesquisar() {
  const termos = semAcento(busca.value).split(/\s+/).filter(Boolean);
  if (!termos.length) { fecharSugestoes(); return; }
  resultados = org.nos
    .filter(n => { const t = semAcento(`${n.nome} ${n.funcao}`); return termos.every(p => t.includes(p)); })
    .sort((a, b) => !semAcento(a.nome).startsWith(termos[0]) - !semAcento(b.nome).startsWith(termos[0]) || a.nivel - b.nivel || a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, 10);
  marcado = resultados.length ? 0 : -1;
  sugestoes.innerHTML = resultados.length
    ? resultados.map((n, i) => `<li role="option" data-i="${i}" aria-selected="${i === marcado}">
        <span class="bolinha" style="--cor:${n.cor}"></span>
        <span><strong>${esc(n.nome)}</strong><small>N${n.nivel} · ${esc(n.funcao)} · ${esc(n.diretoria)}</small></span></li>`).join('')
    : '<li class="nenhum">Ninguém encontrado.</li>';
  sugestoes.hidden = false;
  busca.setAttribute('aria-expanded', 'true');
}

function fecharSugestoes() {
  sugestoes.hidden = true;
  busca.setAttribute('aria-expanded', 'false');
}

function escolher(i) {
  const n = resultados[i];
  if (!n) return;
  fecharSugestoes();
  busca.value = n.nome;
  busca.blur();
  irPara(n.id);
}

busca.addEventListener('input', pesquisar);
busca.addEventListener('focus', () => { if (busca.value) pesquisar(); });
busca.addEventListener('keydown', (e) => {
  if (sugestoes.hidden || !resultados.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    marcado = (marcado + (e.key === 'ArrowDown' ? 1 : -1) + resultados.length) % resultados.length;
    sugestoes.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', i === marcado));
  } else if (e.key === 'Enter') { e.preventDefault(); escolher(marcado); }
  else if (e.key === 'Escape') fecharSugestoes();
});
sugestoes.addEventListener('mousedown', (e) => {
  const li = e.target.closest('[data-i]');
  if (li) { e.preventDefault(); escolher(Number(li.dataset.i)); }
});
busca.addEventListener('blur', () => setTimeout(fecharSugestoes, 120));

// ---------- sessão ----------

$('sair').addEventListener('click', async () => {
  await api('/api/sair', { method: 'POST' }).catch(() => {});
  await api('/api/admin/sair', { method: 'POST' }).catch(() => {});
  location.replace('index.html');
});

window.addEventListener('resize', () => aplicarVista());
carregar();
