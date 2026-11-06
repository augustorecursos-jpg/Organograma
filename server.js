// Organograma · Âmbar Energia (DHO)
// Servidor HTTP: organograma para colaboradores (acesso por CPF), área do RH (senha) e arquivos estáticos.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { db, DATA_DIR } = require('./db');
const { montarOrganograma, normalizarCpf, CORES_NIVEL, NOMES_NIVEL } = require('./organograma');

const PORT = Number(process.env.PORT) || 3000;
const PRODUCAO = process.env.NODE_ENV === 'production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (PRODUCAO ? null : 'ambar-dho');

// Segredo para assinar os cookies de sessão (persistido para sobreviver a reinícios).
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');
const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'));
  return fs.readFileSync(SECRET_FILE, 'utf8');
})();

if (!ADMIN_PASSWORD) {
  console.error('[erro] Em produção é obrigatório definir ADMIN_PASSWORD (senha da área do RH).');
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD) {
  console.warn('[aviso] ADMIN_PASSWORD não definido — usando a senha padrão "ambar-dho". Defina antes de publicar.');
}

// ---------- organograma (recalculado a partir da base + ajustes, mantido em memória) ----------

let cache = null;

function organograma() {
  if (cache) return cache;
  const base = db.prepare('SELECT linhas, arquivo, importado_em FROM base WHERE id = 1').get();
  const ajustes = new Map(db.prepare('SELECT * FROM ajustes').all().map(a => [a.chave, a]));
  const resultado = montarOrganograma(base ? JSON.parse(base.linhas) : [], ajustes);
  cache = {
    ...resultado,
    arquivo: base?.arquivo || null,
    importado_em: base?.importado_em || null,
    porCpf: new Map(resultado.nos.filter(n => n.cpf).map(n => [n.cpf, n])),
    ajustes,
  };
  return cache;
}
const limparCache = () => { cache = null; };

/** Campos que o navegador do organograma recebe (sem CPF). */
const publico = (n) => ({
  id: n.id, nome: n.nome, funcao: n.funcao, nivel: n.nivel, cor: n.cor, diretoria: n.diretoria, setor: n.setor,
  secao: n.secao, filial: n.filial, situacao: n.situacao, gestor: n.gestor, virtual: n.virtual,
});

// ---------- sessão ----------

function assinar(payload) {
  const corpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(corpo).digest('base64url');
  return `${corpo}.${sig}`;
}

function verificar(token) {
  if (!token) return null;
  const [corpo, sig] = token.split('.');
  if (!corpo || !sig) return null;
  const esperado = crypto.createHmac('sha256', SESSION_SECRET).update(corpo).digest('base64url');
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  const payload = JSON.parse(Buffer.from(corpo, 'base64url').toString());
  if (payload.exp < Date.now()) return null;
  return payload;
}

function lerCookies(req) {
  const out = {};
  for (const parte of (req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return out;
}

function definirSessao(res, nome, payload, horas) {
  const token = assinar({ ...payload, exp: Date.now() + horas * 3600e3 });
  res.cookie(nome, token, { httpOnly: true, sameSite: 'lax', maxAge: horas * 3600e3, secure: PRODUCAO });
}

const ehAdmin = (req) => Boolean(verificar(lerCookies(req).sess_admin)?.admin);

function exigirAdmin(req, res, next) {
  if (!ehAdmin(req)) return res.status(401).json({ erro: 'Acesso restrito ao RH.' });
  next();
}

/** Colaborador da base (pelo CPF da sessão) ou RH logado. */
function exigirAcesso(req, res, next) {
  const s = verificar(lerCookies(req).sess_colab);
  const pessoa = s && organograma().porCpf.get(s.cpf);
  if (pessoa) { req.pessoa = pessoa; return next(); }
  if (ehAdmin(req)) return next();
  res.status(401).json({ erro: 'Sessão expirada. Entre novamente com seu CPF.' });
}

/**
 * Limita tentativas de login com falha por IP (evita que alguém "chute" CPFs ou a senha do RH).
 * Só as falhas contam; o limite é folgado porque várias pessoas de uma mesma filial saem pelo mesmo IP.
 */
function limitadorDeFalhas({ maximo, janelaMin }) {
  const falhas = new Map();
  setInterval(() => {
    const agora = Date.now();
    for (const [ip, r] of falhas) if (r.expira < agora) falhas.delete(ip);
  }, 60e3).unref();
  return {
    bloqueado(req) {
      const r = falhas.get(req.ip);
      return Boolean(r && r.expira > Date.now() && r.n >= maximo);
    },
    registrar(req) {
      const agora = Date.now();
      const r = falhas.get(req.ip);
      if (!r || r.expira < agora) falhas.set(req.ip, { n: 1, expira: agora + janelaMin * 60e3 });
      else r.n += 1;
    },
  };
}
const limiteCpf = limitadorDeFalhas({ maximo: 30, janelaMin: 15 });
const limiteAdmin = limitadorDeFalhas({ maximo: 10, janelaMin: 15 });
const MSG_LIMITE = 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.';

// ---------- app ----------

const app = express();
app.disable('x-powered-by');
// Atrás do proxy HTTPS da hospedagem: usa o IP real do usuário e reconhece a conexão segura.
app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (PRODUCAO) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(express.json({ limit: '25mb' }));

app.get('/healthz', (_req, res) => {
  db.prepare('SELECT 1').get();
  res.json({ ok: true });
});

// ===== Colaborador =====

app.post('/api/entrar', (req, res) => {
  if (limiteCpf.bloqueado(req)) return res.status(429).json({ erro: MSG_LIMITE });
  const cpf = normalizarCpf(req.body?.cpf);
  const pessoa = cpf && organograma().porCpf.get(cpf);
  if (!pessoa) {
    limiteCpf.registrar(req);
    return res.status(403).json({ erro: 'Acesso negado. Procure o time de DHO.' });
  }
  db.prepare(`INSERT INTO acessos (cpf, acessos, ultimo_acesso) VALUES (?, 1, datetime('now'))
    ON CONFLICT(cpf) DO UPDATE SET acessos = acessos + 1, ultimo_acesso = datetime('now')`).run(cpf);
  definirSessao(res, 'sess_colab', { cpf }, 12);
  res.json({ ok: true, nome: pessoa.nome });
});

app.post('/api/sair', (_req, res) => {
  res.clearCookie('sess_colab');
  res.json({ ok: true });
});

/** Números gerais para a página de entrada (sem nomes nem CPFs). */
app.get('/api/publico/resumo', (_req, res) => {
  const o = organograma();
  const pessoas = o.nos.filter(n => !n.virtual);
  const gestores = new Set(o.nos.map(n => n.gestor).filter(Boolean));
  res.json({
    colaboradores: pessoas.length,
    diretorias: o.resumo.diretorias.filter(d => d !== 'Presidência' && d !== 'Não identificada').length,
    liderancas: pessoas.filter(n => gestores.has(n.id)).length,
    filiais: new Set(pessoas.map(n => n.filial).filter(Boolean)).size,
    importado_em: o.importado_em,
  });
});

/** Usada pela página de entrada: já tem sessão válida? (responde 200 sempre, para não gerar erro no console) */
app.get('/api/sessao', (req, res) => {
  const s = verificar(lerCookies(req).sess_colab);
  res.json({ ativa: Boolean((s && organograma().porCpf.has(s.cpf)) || ehAdmin(req)) });
});

app.get('/api/organograma', exigirAcesso, (req, res) => {
  const o = organograma();
  res.json({
    nos: o.nos.map(publico),
    eu: req.pessoa ? { id: req.pessoa.id, nome: req.pessoa.nome } : null,
    admin: !req.pessoa,
    importado_em: o.importado_em,
    diretorias: o.resumo.diretorias,
    niveis: Object.keys(CORES_NIVEL).map(n => ({ nivel: Number(n), cor: CORES_NIVEL[n], nome: NOMES_NIVEL[n] })),
  });
});

// ===== Admin (RH) =====

app.post('/api/admin/entrar', (req, res) => {
  if (limiteAdmin.bloqueado(req)) return res.status(429).json({ erro: MSG_LIMITE });
  const senha = String(req.body?.senha || '');
  const a = Buffer.from(senha), b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    limiteAdmin.registrar(req);
    return res.status(401).json({ erro: 'Senha incorreta.' });
  }
  definirSessao(res, 'sess_admin', { admin: true }, 8);
  res.json({ ok: true });
});

app.post('/api/admin/sair', (_req, res) => {
  res.clearCookie('sess_admin');
  res.json({ ok: true });
});

app.get('/api/admin/sessao', exigirAdmin, (_req, res) => res.json({ ok: true }));

// Recebe as linhas já lidas da planilha e substitui a base. Os ajustes do RH continuam valendo.
app.post('/api/admin/importar', exigirAdmin, (req, res) => {
  const linhas = Array.isArray(req.body?.linhas) ? req.body.linhas : [];
  if (!linhas.length) return res.status(400).json({ erro: 'A planilha está vazia.' });
  const campos = ['cpf', 'nome', 'funcao', 'cargo', 'nivel', 'nivel_gestao', 'diretoria', 'secao', 'setor', 'filial',
    'situacao', 'gestor_cpf', 'gestor_nome'];
  const limpas = linhas.map(l => Object.fromEntries(campos.map(c => [c, String(l?.[c] ?? '').trim().slice(0, 300)])));
  const teste = montarOrganograma(limpas);
  if (!teste.resumo.pessoas) return res.status(400).json({ erro: 'Nenhuma linha com CPF e nome válidos.' });

  const arquivo = String(req.body?.arquivo || '').slice(0, 200);
  db.prepare(`INSERT INTO base (id, linhas, arquivo, importado_em) VALUES (1, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET linhas = excluded.linhas, arquivo = excluded.arquivo, importado_em = excluded.importado_em`)
    .run(JSON.stringify(limpas), arquivo);
  db.prepare('INSERT INTO importacoes (arquivo, linhas, pessoas) VALUES (?, ?, ?)').run(arquivo, limpas.length, teste.resumo.pessoas);
  limparCache();
  res.json(organograma().resumo);
});

/** Base tratada completa (com CPF e a origem de cada informação) para a conferência do RH. */
app.get('/api/admin/base', exigirAdmin, (_req, res) => {
  const o = organograma();
  const acessos = db.prepare('SELECT COUNT(*) AS pessoas, COALESCE(SUM(acessos), 0) AS total FROM acessos').get();
  res.json({
    nos: o.nos.map(n => ({ ...n, ajuste: o.ajustes.get(n.chave) || null })),
    resumo: o.resumo,
    arquivo: o.arquivo,
    importado_em: o.importado_em,
    importacoes: db.prepare('SELECT * FROM importacoes ORDER BY id DESC LIMIT 10').all(),
    acessos,
    niveis: Object.keys(CORES_NIVEL).map(n => ({ nivel: Number(n), cor: CORES_NIVEL[n], nome: NOMES_NIVEL[n] })),
  });
});

app.put('/api/admin/ajustes', exigirAdmin, (req, res) => {
  const chave = String(req.body?.chave || '');
  const o = organograma();
  if (!o.nos.some(n => n.chave === chave)) return res.status(404).json({ erro: 'Pessoa não encontrada na base.' });
  const nivel = req.body?.nivel === '' || req.body?.nivel == null ? null : Number(req.body.nivel);
  if (nivel != null && !(Number.isInteger(nivel) && nivel >= 0 && nivel <= 8)) return res.status(400).json({ erro: 'Nível inválido (N0 a N8).' });
  const diretoria = String(req.body?.diretoria || '').trim().slice(0, 120) || null;
  const funcao = String(req.body?.funcao || '').trim().slice(0, 160) || null;
  const gestor = String(req.body?.gestor || '').trim() || null;
  if (gestor && !o.nos.some(n => n.chave === gestor)) return res.status(400).json({ erro: 'Gestor não encontrado na base.' });
  if (gestor === chave) return res.status(400).json({ erro: 'A pessoa não pode ser gestora dela mesma.' });

  if (nivel == null && !diretoria && !funcao && !gestor) db.prepare('DELETE FROM ajustes WHERE chave = ?').run(chave);
  else {
    db.prepare(`INSERT INTO ajustes (chave, nivel, diretoria, funcao, gestor, atualizado_em) VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(chave) DO UPDATE SET nivel = excluded.nivel, diretoria = excluded.diretoria, funcao = excluded.funcao,
        gestor = excluded.gestor, atualizado_em = excluded.atualizado_em`).run(chave, nivel, diretoria, funcao, gestor);
  }
  limparCache();
  res.json({ ok: true });
});

/** Base tratada em CSV (abre no Excel e pode alimentar o Power BI). */
app.get('/api/admin/exportar.csv', exigirAdmin, (_req, res) => {
  const o = organograma();
  const porId = new Map(o.nos.map(n => [n.id, n]));
  const cab = ['CPF', 'Funcionário', 'Função', 'Nível', 'Origem do nível', 'Diretoria', 'Origem da diretoria', 'Setor', 'Seção',
    'Filial', 'Situação', 'Gestor', 'CPF do gestor', 'Fora da base'];
  const cel = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const linhas = o.nos.map(n => {
    const g = porId.get(n.gestor);
    return [n.cpf, n.nome, n.funcao, `N${n.nivel}`, n.nivel_origem, n.diretoria, n.diretoria_origem, n.setor, n.secao,
      n.filial, n.situacao, g?.nome, g?.cpf, n.virtual ? 'Sim' : ''].map(cel).join(';');
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="organograma-tratado-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`﻿${[cab.map(cel).join(';'), ...linhas].join('\r\n')}`);
});

app.get('/api/admin/backup', exigirAdmin, (_req, res) => {
  const arquivo = path.join(DATA_DIR, `backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${arquivo.replace(/'/g, "''")}'`);
  res.download(arquivo, `organograma-backup-${new Date().toISOString().slice(0, 10)}.db`, () => fs.rm(arquivo, { force: true }, () => {}));
});

// ---------- estáticos e erros ----------

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 400).json({ erro: err.message || 'Erro inesperado' });
});

app.listen(PORT, () => console.log(`Organograma rodando em http://localhost:${PORT}`));
