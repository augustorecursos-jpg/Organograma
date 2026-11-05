// Tratamento da base do organograma: une duplicados, liga cada pessoa ao gestor, define o nível (N0 a N8)
// e completa a diretoria de quem está em branco. Função pura: recebe as linhas da planilha e os ajustes do RH.

/** Cor do cabeçalho de cada nível (mesmas cores da coluna "CÓD. COR HIERARQUIA" da base). */
const CORES_NIVEL = {
  0: '#0a2c45', 1: '#003e5b', 2: '#0775a8', 3: '#0898db', 4: '#f27019',
  5: '#f89c5f', 6: '#e4ce08', 7: '#f6eb89', 8: '#e0e0e0',
};

const NOMES_NIVEL = {
  0: 'Presidência', 1: 'Diretoria', 2: 'Diretoria / Assessoria', 3: 'Gerência Executiva', 4: 'Gerência',
  5: 'Coordenação', 6: 'Supervisão', 7: 'Especialistas', 8: 'Analistas, técnicos e operacionais',
};

/** Nível esperado pelo grupo de cargo (o número antes do hífen na coluna CARGO). */
const NIVEL_POR_CARGO = { 1: [1, 2], 4: [3], 5: [4], 6: [5], 7: [6], 8: [7] };
const nivelPeloCargo = (cargo) => {
  const g = Number(String(cargo || '').match(/^\s*(\d+)/)?.[1]);
  if (!g) return null;
  return NIVEL_POR_CARGO[g] || [8];
};

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const chaveNome = (s) => semAcento(s).replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
const vazio = (v) => v == null || String(v).trim() === '' || String(v).trim() === '0';
const texto = (v) => (vazio(v) ? '' : String(v).trim());

function normalizarCpf(valor) {
  const digitos = String(valor ?? '').replace(/\.0+$/, '').replace(/\D/g, '');
  if (!digitos || digitos.length > 11 || /^0+$/.test(digitos)) return null;
  return digitos.padStart(11, '0');
}

function lerNivel(v) {
  const m = String(v ?? '').toUpperCase().match(/N?\s*(\d)/);
  return m ? Number(m[1]) : null;
}

/** Nome em "Título" (a planilha traz alguns gestores em CAIXA ALTA). */
function nomeProprio(nome) {
  const minusculas = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
  return String(nome || '').toLowerCase().split(/\s+/).filter(Boolean)
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p[0].toUpperCase() + p.slice(1))).join(' ');
}

function maisFrequente(valores) {
  const cont = new Map();
  for (const v of valores) if (v) cont.set(v, (cont.get(v) || 0) + 1);
  let melhor = null, n = 0;
  for (const [v, c] of cont) if (c > n) { melhor = v; n = c; }
  return melhor ? { valor: melhor, votos: n, total: valores.filter(Boolean).length } : null;
}

/**
 * @param {Array<object>} linhas  linhas da planilha: cpf, nome, funcao, cargo, nivel, nivel_gestao, diretoria,
 *                                secao, setor, filial, situacao, gestor_cpf, gestor_nome
 * @param {Map<string, object>} ajustes  chave (CPF ou "V:<nome>") → { nivel, diretoria, funcao, gestor }
 */
function montarOrganograma(linhas, ajustes = new Map()) {
  const avisos = { duplicados: [], ignoradas: [] };

  // 1) Pessoas da base, unindo linhas repetidas do mesmo CPF (mesma pessoa em duas coligadas).
  const pessoas = new Map();
  linhas.forEach((l, i) => {
    const cpf = normalizarCpf(l.cpf);
    const nome = texto(l.nome);
    if (!cpf || !nome) { avisos.ignoradas.push({ linha: i + 2, motivo: !cpf ? 'CPF vazio ou inválido' : 'Nome vazio' }); return; }
    if (/demitid|desligad/i.test(l.situacao || '')) { avisos.ignoradas.push({ linha: i + 2, nome, motivo: `Situação: ${l.situacao}` }); return; }
    const reg = {
      chave: cpf, cpf, nome: nomeProprio(nome), funcao: texto(l.funcao), cargo: texto(l.cargo),
      nivel_planilha: lerNivel(l.nivel), nivel_gestao: lerNivel(l.nivel_gestao),
      diretoria_planilha: texto(l.diretoria), secao: texto(l.secao), setor: texto(l.setor), filial: texto(l.filial),
      situacao: texto(l.situacao), gestor_cpf: normalizarCpf(l.gestor_cpf), gestor_nome: texto(l.gestor_nome),
      virtual: false,
    };
    const existente = pessoas.get(cpf);
    if (!existente) { pessoas.set(cpf, reg); return; }
    for (const [k, v] of Object.entries(reg)) if ((existente[k] == null || existente[k] === '') && v != null && v !== '') existente[k] = v;
    if (!avisos.duplicados.some(d => d.cpf === cpf)) avisos.duplicados.push({ cpf, nome: existente.nome });
  });

  const porNome = new Map();
  for (const p of pessoas.values()) if (!porNome.has(chaveNome(p.nome))) porNome.set(chaveNome(p.nome), p);

  // 2) Gestor de cada pessoa. Gestor fora da base vira um cartão "fora da base" (pelo nome).
  const nos = new Map(pessoas);
  const gestoresFora = new Map();
  const semGestor = [];
  for (const p of pessoas.values()) {
    let gestor = null;
    if (p.gestor_cpf && p.gestor_cpf !== p.cpf && pessoas.has(p.gestor_cpf)) gestor = p.gestor_cpf;
    else if (p.gestor_nome && !/^sem gestor$/i.test(p.gestor_nome) && chaveNome(p.gestor_nome) !== chaveNome(p.nome)) {
      const mesmoNome = porNome.get(chaveNome(p.gestor_nome));
      if (mesmoNome) gestor = mesmoNome.cpf; // CPF do gestor não bate, mas o nome está na base
      else {
        const chave = `V:${chaveNome(p.gestor_nome)}`;
        if (!nos.has(chave)) {
          const v = { chave, cpf: null, nome: nomeProprio(p.gestor_nome), funcao: '', cargo: '', secao: '', setor: '', filial: '',
            situacao: '', diretoria_planilha: '', virtual: true };
          nos.set(chave, v);
          gestoresFora.set(chave, v);
        }
        gestor = chave;
      }
    }
    p.gestor = gestor;
    if (!gestor) semGestor.push(p);
  }
  for (const v of gestoresFora.values()) v.gestor = null;

  // Ajustes manuais de gestor (o RH pode, por exemplo, ligar um gestor fora da base ao presidente).
  for (const n of nos.values()) {
    const aj = ajustes.get(n.chave);
    if (aj?.gestor && nos.has(aj.gestor) && aj.gestor !== n.chave) n.gestor = aj.gestor;
  }

  // 3) Quebra ciclos (A gestor de B e B gestor de A) para a árvore não entrar em laço.
  const ciclos = [];
  for (const n of nos.values()) {
    const vistos = new Set([n.chave]);
    let atual = n;
    while (atual.gestor) {
      if (vistos.has(atual.gestor)) { ciclos.push(atual.nome); atual.gestor = null; break; }
      vistos.add(atual.gestor);
      atual = nos.get(atual.gestor);
    }
  }

  const filhos = new Map([...nos.keys()].map(k => [k, []]));
  for (const n of nos.values()) if (n.gestor) filhos.get(n.gestor).push(n.chave);

  // Ordem de cima para baixo (raízes primeiro), usada para herdar dados do gestor.
  const ordem = [];
  const fila = [...nos.values()].filter(n => !n.gestor).map(n => n.chave);
  while (fila.length) { const k = fila.shift(); ordem.push(k); fila.push(...filhos.get(k)); }

  // 4) Nível: "Nível Colaborador"; sem ele, "Nível Gestão" + 1; sem os dois, o grupo da coluna CARGO.
  for (const p of pessoas.values()) {
    const porCargo = nivelPeloCargo(p.cargo);
    if (p.nivel_planilha != null) { p.nivel = p.nivel_planilha; p.nivel_origem = 'Nível Colaborador'; }
    else if (p.nivel_gestao != null) { p.nivel = Math.min(8, p.nivel_gestao + 1); p.nivel_origem = 'Nível Gestão + 1'; }
    else if (porCargo) { p.nivel = porCargo[0]; p.nivel_origem = 'Cargo'; }
    else { p.nivel = 8; p.nivel_origem = 'Padrão (sem nível nem cargo)'; }
    p.nivel_cargo = porCargo;
  }
  // Gestores fora da base: um nível acima do subordinado mais alto. Quem fica em N0 é a Presidência.
  for (const v of gestoresFora.values()) {
    const niveis = filhos.get(v.chave).map(k => nos.get(k).nivel).filter(x => x != null);
    v.nivel = Math.max(0, Math.min(...niveis) - 1);
    v.nivel_origem = 'Inferido pelos subordinados';
    v.funcao = v.nivel === 0 ? 'Presidente' : 'Gestor (fora da base)';
  }
  for (const n of nos.values()) {
    const aj = ajustes.get(n.chave);
    if (aj?.nivel != null && aj.nivel !== '') { n.nivel = Number(aj.nivel); n.nivel_origem = 'Ajuste do RH'; }
    if (aj?.funcao) n.funcao = aj.funcao;
  }

  // 5) Diretoria de quem está em branco: seção + filial, depois seção, depois a diretoria do gestor.
  const porSecaoFilial = new Map(), porSecao = new Map();
  for (const p of pessoas.values()) {
    if (!p.diretoria_planilha || !p.secao) continue;
    const sf = `${semAcento(p.secao)}|${semAcento(p.filial)}`, s = semAcento(p.secao);
    if (!porSecaoFilial.has(sf)) porSecaoFilial.set(sf, []);
    if (!porSecao.has(s)) porSecao.set(s, []);
    porSecaoFilial.get(sf).push(p.diretoria_planilha);
    porSecao.get(s).push(p.diretoria_planilha);
  }
  const diretoriaDosFilhos = (k) => maisFrequente(filhos.get(k).map(c => nos.get(c).diretoria_planilha || nos.get(c).diretoria))?.valor;

  for (const k of ordem) {
    const n = nos.get(k);
    const aj = ajustes.get(k);
    const doGestor = n.gestor ? nos.get(n.gestor).diretoria : null;
    if (aj?.diretoria) { n.diretoria = aj.diretoria; n.diretoria_origem = 'Ajuste do RH'; continue; }
    if (n.diretoria_planilha) { n.diretoria = n.diretoria_planilha; n.diretoria_origem = 'Planilha'; continue; }
    if (n.virtual) {
      n.diretoria = n.nivel === 0 ? 'Presidência' : (diretoriaDosFilhos(k) || 'Não identificada');
      n.diretoria_origem = n.nivel === 0 ? 'Presidência' : 'Equipe';
      continue;
    }
    const sf = maisFrequente(porSecaoFilial.get(`${semAcento(n.secao)}|${semAcento(n.filial)}`) || []);
    const s = maisFrequente(porSecao.get(semAcento(n.secao)) || []);
    if (sf) { n.diretoria = sf.valor; n.diretoria_origem = `Seção + filial (${sf.votos} de ${sf.total})`; }
    else if (s) { n.diretoria = s.valor; n.diretoria_origem = `Seção (${s.votos} de ${s.total})`; }
    else if (doGestor && doGestor !== 'Presidência') { n.diretoria = doGestor; n.diretoria_origem = 'Diretoria do gestor'; }
    else { n.diretoria = diretoriaDosFilhos(k) || 'Não identificada'; n.diretoria_origem = n.diretoria === 'Não identificada' ? 'Sem referência' : 'Equipe'; }
    n.diretoria_gestor = doGestor;
    n.inferida = true;
  }

  // 6) Saída: ids numéricos (o CPF nunca vai para o navegador do organograma).
  const ids = new Map(ordem.map((k, i) => [k, i + 1]));
  const lista = ordem.map(k => {
    const n = nos.get(k);
    return {
      id: ids.get(k), chave: k, cpf: n.cpf, nome: n.nome, funcao: n.funcao || '', cargo: n.cargo || '',
      nivel: n.nivel, nivel_origem: n.nivel_origem, cor: CORES_NIVEL[n.nivel] || CORES_NIVEL[8],
      diretoria: n.diretoria, diretoria_origem: n.diretoria_origem, diretoria_inferida: Boolean(n.inferida),
      diretoria_gestor: n.diretoria_gestor || null,
      setor: n.setor || '', secao: n.secao || '', filial: n.filial || '', situacao: n.situacao || '',
      gestor: n.gestor ? ids.get(n.gestor) : null, virtual: n.virtual,
    };
  });
  const porId = new Map(lista.map(n => [n.id, n]));

  // Pontos para o RH conferir.
  const conferir = [];
  for (const n of lista) {
    const motivos = [];
    const p = nos.get(n.chave);
    if (n.diretoria_inferida) motivos.push('diretoria');
    if (!n.virtual && p.nivel_cargo && !p.nivel_cargo.includes(n.nivel) && n.nivel_origem !== 'Ajuste do RH') motivos.push('nivel_cargo');
    if (n.gestor && porId.get(n.gestor).nivel >= n.nivel && n.nivel_origem !== 'Ajuste do RH') motivos.push('nivel_gestor');
    if (n.virtual) motivos.push('fora_base');
    if (!n.virtual && !n.gestor) motivos.push('sem_gestor');
    n.conferir = motivos;
    if (motivos.length) conferir.push(n.id);
  }

  return {
    nos: lista,
    resumo: {
      linhas: linhas.length,
      pessoas: pessoas.size,
      gestores_fora: gestoresFora.size,
      duplicados: avisos.duplicados.length,
      ignoradas: avisos.ignoradas,
      ciclos,
      diretorias: [...new Set(lista.map(n => n.diretoria))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      diretorias_inferidas: lista.filter(n => n.diretoria_inferida).length,
      a_conferir: conferir.length,
    },
  };
}

module.exports = { montarOrganograma, normalizarCpf, CORES_NIVEL, NOMES_NIVEL };
