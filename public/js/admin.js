// Área do RH: importação da planilha, resumo do tratamento, conferência e ajustes.
const adm = { base: null, linhas: [], arquivo: '', porId: new Map(), gestores: new Map(), editando: null };

const MOTIVOS = {
  diretoria: 'Diretoria preenchida', nivel_cargo: 'Nível ≠ cargo', nivel_gestor: 'Nível ≥ gestor',
  fora_base: 'Fora da base', sem_gestor: 'Sem gestor',
};
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dataHora = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const cpfFmt = (c) => (c ? String(c).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : '');

// ---------- sessão ----------
async function iniciar() {
  try {
    await api('/api/admin/sessao');
    mostrarPainel();
  } catch { /* fica na tela de login */ }
}

function mostrarPainel() {
  document.getElementById('tela-login').hidden = true;
  document.getElementById('lateral').hidden = false;
  document.getElementById('principal').hidden = false;
  carregarBase().then(() => trocarAba(location.hash.slice(1) || 'base'));
}

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/entrar', { method: 'POST', body: { senha: document.getElementById('senha').value } });
    mostrarPainel();
  } catch (err) { toast(err.message, 'erro'); }
});

document.getElementById('sair').addEventListener('click', async () => {
  await api('/api/admin/sair', { method: 'POST' });
  location.reload();
});

function trocarAba(aba) {
  if (!['base', 'conferencia'].includes(aba)) aba = 'base';
  history.replaceState(null, '', `#${aba}`);
  document.querySelectorAll('[data-aba]').forEach(b => b.classList.toggle('ativo', b.dataset.aba === aba));
  document.querySelectorAll('[data-painel]').forEach(s => { s.hidden = s.dataset.painel !== aba; });
  document.getElementById('lateral').classList.remove('aberta');
  if (aba === 'conferencia') desenharPessoas();
}
document.querySelectorAll('[data-aba]').forEach(b => b.addEventListener('click', () => trocarAba(b.dataset.aba)));
document.getElementById('btn-menu').addEventListener('click', () => document.getElementById('lateral').classList.toggle('aberta'));
document.addEventListener('click', (e) => { if (e.target.closest('[data-fechar]')) e.target.closest('dialog').close(); });

// ---------- base ----------
async function carregarBase() {
  adm.base = await api('/api/admin/base');
  adm.porId = new Map(adm.base.nos.map(n => [n.id, n]));
  desenharResumo();
  const dirs = document.getElementById('filtro-dir');
  const atual = dirs.value;
  dirs.innerHTML = '<option value="">Todas as diretorias</option>' + adm.base.resumo.diretorias.map(d => `<option>${esc(d)}</option>`).join('');
  dirs.value = atual;
  document.getElementById('lista-diretorias').innerHTML = adm.base.resumo.diretorias.map(d => `<option value="${esc(d)}">`).join('');
  adm.gestores = new Map(adm.base.nos.map(n => [`${n.nome} — ${n.funcao || 'sem função'} (#${n.id})`, n]));
  document.getElementById('lista-gestores').innerHTML = [...adm.gestores.keys()].map(k => `<option value="${esc(k)}">`).join('');
  if (!document.querySelector('[data-painel="conferencia"]').hidden) desenharPessoas();
}

function desenharResumo() {
  const { resumo, nos, importado_em, arquivo, importacoes, acessos } = adm.base;
  const pessoas = nos.filter(n => !n.virtual).length;
  const qtd = document.getElementById('qtd-conferir');
  qtd.textContent = resumo.a_conferir || '';
  qtd.hidden = !resumo.a_conferir;

  const card = (ic, valor, rotulo, destaque) => `<div class="indicador${destaque ? ' destaque' : ''}"><span class="ic">${ic}</span><div><strong>${valor}</strong><span>${rotulo}</span></div></div>`;
  document.getElementById('indicadores').innerHTML = !nos.length
    ? '<p class="dica" style="grid-column:1/-1">Nenhuma base importada ainda. Envie a planilha acima para montar o organograma.</p>'
    : [
      card('👥', fmt(pessoas), 'colaboradores no organograma'),
      card('🏢', fmt(resumo.diretorias.filter(d => d !== 'Presidência').length), 'diretorias'),
      card('🏷️', fmt(resumo.diretorias_inferidas), 'diretorias preenchidas automaticamente', true),
      card('🧩', fmt(resumo.gestores_fora), 'gestores fora da base (cartão próprio)'),
      card('🔁', fmt(resumo.duplicados), 'CPFs duplicados unificados'),
      card('✅', fmt(resumo.a_conferir), 'pontos para conferir', true),
      card('🔐', fmt(acessos.pessoas), `colaboradores já acessaram (${fmt(acessos.total)} acessos)`),
      card('📄', fmt(resumo.linhas), 'linhas na última planilha'),
    ].join('');

  document.getElementById('info-base').textContent = importado_em ? `· base atual: ${arquivo || 'planilha'} em ${dataHora(importado_em)}` : '';
  document.getElementById('tabela-importacoes').innerHTML = importacoes.length
    ? `<tr><th>Data</th><th>Arquivo</th><th>Linhas</th><th>Pessoas</th></tr>` + importacoes.map(i =>
      `<tr><td>${dataHora(i.importado_em)}</td><td>${esc(i.arquivo || '—')}</td><td>${fmt(i.linhas)}</td><td>${fmt(i.pessoas)}</td></tr>`).join('')
    : '<tr><td class="dica">Nenhuma importação ainda.</td></tr>';

  const inferidas = nos.filter(n => n.diretoria_inferida);
  document.getElementById('qtd-inferidas').textContent = `· ${inferidas.length} pessoa(s) com a diretoria em branco na planilha`;
  document.getElementById('tabela-inferidas').innerHTML = inferidas.length
    ? `<tr><th>Colaborador</th><th>Seção</th><th>Filial</th><th>Gestor</th><th>Diretoria definida</th><th>Critério</th><th></th></tr>` + inferidas.map(n => {
      const g = adm.porId.get(n.gestor);
      const diverge = n.diretoria_gestor && n.diretoria_gestor !== 'Presidência' && n.diretoria_gestor !== n.diretoria;
      return `<tr><td><strong>${esc(n.nome)}</strong><br><small>${esc(n.funcao)}</small></td><td>${esc(n.secao)}</td><td>${esc(n.filial)}</td>
        <td>${esc(g?.nome || '—')}${g ? `<br><small>${esc(g.diretoria)}</small>` : ''}</td>
        <td><strong>${esc(n.diretoria)}</strong>${diverge ? '<br><span class="selo alerta">diferente da do gestor</span>' : ''}</td>
        <td><small>${esc(n.diretoria_origem)}</small></td>
        <td><button class="btn btn-claro btn-sm" data-ajustar="${n.id}">Ajustar</button></td></tr>`;
    }).join('')
    : '<tr><td class="dica">Nenhuma diretoria em branco na última planilha.</td></tr>';
}

// ---------- importação ----------
document.getElementById('arquivo').addEventListener('change', async (e) => {
  const arq = e.target.files[0];
  const previa = document.getElementById('previa');
  const btn = document.getElementById('btn-importar');
  adm.linhas = [];
  btn.disabled = true;
  previa.innerHTML = '';
  if (!arq) return;
  try {
    const wb = XLSX.read(await arq.arrayBuffer(), { type: 'array', codepage: 65001 });
    const matriz = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
    const lido = Planilha.lerMatriz(matriz);
    if (lido.faltando.length) {
      previa.innerHTML = `<p class="aviso">Colunas obrigatórias não encontradas: <b>${lido.faltando.map(c => ({ cpf: 'CPF', nome: 'FUNCIONÁRIO', gestor_cpf: 'CPF do gestor (CPF_Gestor_atualizado)' }[c])).join(', ')}</b>.</p>`;
      return;
    }
    adm.linhas = lido.linhas;
    adm.arquivo = arq.name;
    previa.innerHTML = `<p><b>${fmt(lido.linhas.length)}</b> linhas lidas de <b>${esc(arq.name)}</b>. Colunas reconhecidas:
      ${lido.reconhecidas.map(c => `<span class="selo">${c}</span>`).join(' ')}</p>`;
    btn.disabled = false;
  } catch (err) {
    previa.innerHTML = `<p class="aviso">Não foi possível ler o arquivo: ${esc(err.message)}</p>`;
  }
});

document.getElementById('btn-importar').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Montando organograma…';
  try {
    const r = await api('/api/admin/importar', { method: 'POST', body: { linhas: adm.linhas, arquivo: adm.arquivo } });
    toast(`Organograma atualizado: ${fmt(r.pessoas)} colaboradores.`);
    document.getElementById('previa').innerHTML = r.ignoradas.length
      ? `<p class="aviso">${r.ignoradas.length} linha(s) ignorada(s): ${r.ignoradas.slice(0, 8).map(i => `linha ${i.linha} (${esc(i.motivo)})`).join(', ')}${r.ignoradas.length > 8 ? '…' : ''}</p>`
      : '';
    document.getElementById('arquivo').value = '';
    adm.linhas = [];
    await carregarBase();
  } catch (err) {
    toast(err.message, 'erro');
    btn.disabled = false;
  } finally {
    btn.textContent = 'Importar e montar organograma';
  }
});

// ---------- conferência ----------
['filtro-motivo', 'filtro-dir', 'busca'].forEach(id => document.getElementById(id).addEventListener('input', desenharPessoas));

function desenharPessoas() {
  if (!adm.base) return;
  const motivo = document.getElementById('filtro-motivo').value;
  const dir = document.getElementById('filtro-dir').value;
  const termos = semAcento(document.getElementById('busca').value).split(/\s+/).filter(Boolean);
  const lista = adm.base.nos.filter(n => {
    if (motivo === 'conferir' && !n.conferir.length) return false;
    if (motivo === 'ajuste' && !n.ajuste) return false;
    if (motivo && !['conferir', 'ajuste'].includes(motivo) && !n.conferir.includes(motivo)) return false;
    if (dir && n.diretoria !== dir) return false;
    const t = semAcento(`${n.nome} ${n.cpf || ''} ${n.funcao} ${n.secao} ${n.filial}`);
    return termos.every(p => t.includes(p));
  });
  const LIMITE = 300;
  document.getElementById('qtd-lista').textContent = `· ${fmt(lista.length)} pessoa(s)${lista.length > LIMITE ? ` (mostrando ${LIMITE}; use a busca)` : ''}`;
  document.getElementById('tabela-pessoas').innerHTML = lista.length
    ? `<tr><th>Colaborador</th><th>Gestor</th><th>Nível</th><th>Diretoria</th><th>Pontos</th><th></th></tr>` + lista.slice(0, LIMITE).map(n => {
      const g = adm.porId.get(n.gestor);
      return `<tr>
        <td><strong>${esc(n.nome)}</strong>${n.virtual ? ' <span class="selo">fora da base</span>' : ''}<br><small>${esc(n.funcao)}${n.cpf ? ` · ${cpfFmt(n.cpf)}` : ''}</small></td>
        <td>${g ? `${esc(g.nome)}<br><small>N${g.nivel}</small>` : '—'}</td>
        <td><span class="nivel" style="--cor:${n.cor}">N${n.nivel}</span><br><small>${esc(n.nivel_origem)}</small></td>
        <td>${esc(n.diretoria)}<br><small>${esc(n.diretoria_origem)}</small></td>
        <td>${n.conferir.map(m => `<span class="selo alerta">${MOTIVOS[m]}</span>`).join(' ')}${n.ajuste ? ' <span class="selo ok">ajustado</span>' : ''}</td>
        <td><button class="btn btn-claro btn-sm" data-ajustar="${n.id}">Ajustar</button></td></tr>`;
    }).join('')
    : '<tr><td class="dica">Nada para mostrar com esses filtros. 🎉</td></tr>';
}

// ---------- ajuste ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ajustar]');
  if (b) abrirAjuste(Number(b.dataset.ajustar));
});

function abrirAjuste(id) {
  const n = adm.porId.get(id);
  adm.editando = n;
  const aj = n.ajuste || {};
  const f = document.getElementById('form-ajuste');
  document.getElementById('ajuste-titulo').textContent = n.nome;
  const g = adm.porId.get(n.gestor);
  document.getElementById('ajuste-sub').innerHTML = `Hoje: <b>N${n.nivel}</b> · <b>${esc(n.diretoria)}</b> · gestor: <b>${esc(g?.nome || '—')}</b>`;
  document.getElementById('ajuste-nivel').innerHTML = `<option value="">Automático</option>` +
    adm.base.niveis.map(x => `<option value="${x.nivel}">N${x.nivel} · ${esc(x.nome)}</option>`).join('');
  f.nivel.value = aj.nivel ?? '';
  f.diretoria.value = aj.diretoria || '';
  f.funcao.value = aj.funcao || '';
  const gestorAj = aj.gestor && adm.base.nos.find(x => x.chave === aj.gestor);
  f.gestor.value = gestorAj ? [...adm.gestores.entries()].find(([, v]) => v === gestorAj)?.[0] || '' : '';
  document.getElementById('modal-ajuste').showModal();
}

document.getElementById('form-ajuste').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const n = adm.editando;
  const textoGestor = f.gestor.value.trim();
  const gestor = textoGestor ? adm.gestores.get(textoGestor) : null;
  if (textoGestor && !gestor) { toast('Escolha o gestor na lista de sugestões.', 'erro'); return; }
  try {
    await api('/api/admin/ajustes', {
      method: 'PUT',
      body: { chave: n.chave, nivel: f.nivel.value, diretoria: f.diretoria.value, funcao: f.funcao.value, gestor: gestor?.chave || '' },
    });
    document.getElementById('modal-ajuste').close();
    toast('Ajuste salvo. O organograma já foi atualizado.');
    await carregarBase();
  } catch (err) { toast(err.message, 'erro'); }
});

iniciar();
