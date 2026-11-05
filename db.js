// Banco de dados SQLite (módulo nativo node:sqlite, sem dependências nativas).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'organograma.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
-- Última planilha importada (linhas já lidas, em JSON). O organograma é recalculado a partir dela.
CREATE TABLE IF NOT EXISTS base (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  linhas       TEXT NOT NULL,
  arquivo      TEXT,
  importado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ajustes do RH, mantidos entre importações. chave = CPF ou "V:<nome>" (gestor fora da base).
CREATE TABLE IF NOT EXISTS ajustes (
  chave        TEXT PRIMARY KEY,
  nivel        INTEGER,
  diretoria    TEXT,
  funcao       TEXT,
  gestor       TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS importacoes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  arquivo      TEXT,
  linhas       INTEGER,
  pessoas      INTEGER,
  importado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acessos (
  cpf          TEXT PRIMARY KEY,
  acessos      INTEGER NOT NULL DEFAULT 0,
  ultimo_acesso TEXT
);
`);

module.exports = { db, DATA_DIR };
