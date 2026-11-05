// Leitura da planilha do organograma (usada na área do RH e nos scripts de teste).
// Localiza as colunas pelo nome, sem acento, espaço ou pontuação. Quando mais de uma coluna serve, vale a
// primeira da lista que existir na planilha (ex.: "CPF_Gestor_atualizado" antes de "CPF_GESTOR"), mesmo vazia:
// gestor em branco na coluna atualizada não deve cair no gestor antigo do ERP.
(function (raiz) {
  const COLUNAS = {
    cpf: ['cpf'],
    nome: ['funcionario', 'nome', 'colaborador', 'nomecolaborador'],
    funcao: ['funcao'],
    cargo: ['cargo'],
    nivel: ['nivelcolaborador', 'nivel'],
    nivel_gestao: ['nivelgestao'],
    diretoria: ['diretoriadax', 'diretoria', 'diretoria2'],
    secao: ['secao'],
    setor: ['setordax', 'setor'],
    filial: ['filialfantasia', 'filial'],
    situacao: ['dsituacao', 'situacao'],
    gestor_cpf: ['cpfgestoratualizado', 'cpfgestor', 'cpfgestororiginal'],
    gestor_nome: ['nomegestor', 'gestoratualizado', 'gestor'],
  };
  const OBRIGATORIAS = ['cpf', 'nome', 'gestor_cpf'];

  const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

  /** matriz: linhas da planilha (a primeira é o cabeçalho). Devolve { linhas, faltando, reconhecidas }. */
  function lerMatriz(matriz) {
    const cab = (matriz[0] || []).map(normalizar);
    // Colunas com o mesmo nome (ex.: "NOME_GESTOR" e "Nome Gestor"): vale a última, que é a da base tratada.
    const indices = {};
    for (const [campo, apelidos] of Object.entries(COLUNAS)) {
      const achado = apelidos.find(a => cab.includes(a));
      indices[campo] = achado ? cab.lastIndexOf(achado) : -1;
    }
    const valor = (l, campo) => {
      const v = indices[campo] >= 0 ? String(l[indices[campo]] ?? '').trim() : '';
      return v === '0' ? '' : v;
    };
    const linhas = matriz.slice(1)
      .filter(l => l.some(v => String(v ?? '').trim()))
      .map(l => Object.fromEntries(Object.keys(COLUNAS).map(c => [c, valor(l, c)])));
    return {
      linhas,
      faltando: OBRIGATORIAS.filter(c => indices[c] < 0),
      reconhecidas: Object.keys(COLUNAS).filter(c => indices[c] >= 0),
    };
  }

  const api = { lerMatriz, COLUNAS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.Planilha = api;
})(this);
