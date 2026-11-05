// Cria uma base de demonstração com pessoas fictícias (para testar sem a planilha real).
// Uso: npm run seed   (substitui a base atual do DATA_DIR)
const { db } = require('../db');

const nomes = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Felipe', 'Gabriela', 'Hugo', 'Isabela', 'João', 'Karina', 'Lucas',
  'Mariana', 'Nelson', 'Olívia', 'Paulo', 'Renata', 'Sérgio', 'Tatiane', 'Vítor'];
const sobrenomes = ['Almeida', 'Barbosa', 'Cardoso', 'Duarte', 'Esteves', 'Ferraz', 'Gomes', 'Holanda', 'Lima', 'Moreira',
  'Nogueira', 'Pacheco', 'Queiroz', 'Rocha', 'Siqueira', 'Teixeira'];
const filiais = ['Holding Filial SP', 'UTE Cuiabá', 'UTE Candiota', 'Âmbar Norte'];

let seq = 0;
const linhas = [];
const cpf = () => String(10000000000 + (++seq) * 7919).slice(0, 11);
const nome = () => `${nomes[seq % nomes.length]} ${sobrenomes[(seq * 7) % sobrenomes.length]} ${sobrenomes[(seq * 3 + 5) % sobrenomes.length]}`;

function pessoa(funcao, cargo, nivel, diretoria, setor, secao, gestor, filial = filiais[seq % filiais.length]) {
  const p = { cpf: cpf(), nome: nome(), funcao, cargo, nivel: `N${nivel}`, nivel_gestao: `N${nivel - 1}`, diretoria, secao, setor, filial,
    situacao: 'Ativo', gestor_cpf: gestor?.cpf || '', gestor_nome: gestor?.nome || 'Presidente Demonstração' };
  linhas.push(p);
  return p;
}

const areas = [
  ['Industrial', 'Operação', 'Diretor de Operações', ['Gerente de Usina', 'Supervisor de Operações', 'Operador II']],
  ['Adm Financeiro', 'Financeiro', 'Diretor Administrativo e Financeiro', ['Gerente Financeiro', 'Coordenador Financeiro', 'Analista Financeiro Pl']],
  ['Recursos Humanos', 'Recursos Humanos', 'Diretor de Gente', ['Gerente Executivo de RH', 'Coordenador de Recursos Humanos', 'Analista de Recursos Humanos Pl']],
  ['Comercial', 'Comercial', 'Diretor Comercial', ['Gerente Comercial', 'Coordenador Comercial', 'Analista Comercial Sr']],
];
for (const [diretoria, setor, cargoDiretor, [ger, coord, analista]] of areas) {
  const dir = pessoa(cargoDiretor, '01-Diretores', 1, diretoria, 'Diretoria', `Diretoria ${setor}`, null);
  for (let g = 0; g < 2; g++) {
    const gerente = pessoa(ger, '05-Gerentes', 4, diretoria, setor, setor, dir);
    for (let c = 0; c < 2; c++) {
      const coordenador = pessoa(coord, '06-Coordenação', 5, diretoria, setor, setor, gerente);
      for (let a = 0; a < 4; a++) pessoa(analista, '09-Administrativo', 8, a === 3 ? '' : diretoria, setor, setor, coordenador);
    }
    pessoa(`Especialista de ${setor}`, '08-Especialistas', 7, diretoria, setor, setor, gerente);
  }
}

db.prepare(`INSERT INTO base (id, linhas, arquivo, importado_em) VALUES (1, ?, 'demonstracao.xlsx', datetime('now'))
  ON CONFLICT(id) DO UPDATE SET linhas = excluded.linhas, arquivo = excluded.arquivo, importado_em = excluded.importado_em`)
  .run(JSON.stringify(linhas));
console.log(`Base de demonstração criada com ${linhas.length} pessoas fictícias.`);
console.log(`Para entrar como colaborador, use o CPF ${linhas[0].cpf} (diretor) ou ${linhas[5].cpf}.`);
