# Organograma · Âmbar Energia (DHO)

Organograma interativo montado a partir da base de colaboradores do RH, no mesmo padrão da Trilha de Desenvolvimento:
Node.js + SQLite nativo, área do RH com senha, acesso dos colaboradores por CPF e publicação no Render.

Visual da identidade Âmbar (azul-marinho `#0e3b5c`, laranja `#ec6b24`); cores dos níveis iguais às da coluna
`CÓD. COR HIERARQUIA` da base (N0 a N8).

> ⚠️ Este repositório é público. A planilha com dados reais **nunca** vai para o Git (`*.xlsx`/`*.csv` estão no
> `.gitignore`): ela é enviada pela Área do RH e fica só no disco do servidor.

## Como rodar

Requisito: **Node.js 22.5+**.

```bash
npm install
npm run seed      # opcional: base de demonstração com pessoas fictícias
npm start         # http://localhost:3000
```

| Variável | Para quê | Padrão |
|---|---|---|
| `ADMIN_PASSWORD` | Senha da Área do RH (`/admin.html`) | `ambar-dho` (**troque antes de publicar**) |
| `PORT` | Porta HTTP | `3000` |
| `DATA_DIR` | Pasta do banco (`organograma.db`) | `./data` |
| `SESSION_SECRET` | Chave dos cookies de sessão | gerada e salva em `data/` |
| `NODE_ENV=production` | Cookies só via HTTPS e senha obrigatória | – |

## Publicação no Render

O arquivo `render.yaml` já descreve o serviço (plano Starter + disco de 1 GB para a base e os ajustes):

1. Em [render.com](https://render.com) → **New → Blueprint** → conecte o GitHub e escolha o repositório **Organograma**.
2. Confirme a branch indicada no `render.yaml` e informe o valor de `ADMIN_PASSWORD` quando o Render pedir.
3. Clique em **Apply**. Ao terminar, o Render mostra o link `https://organograma-ambar.onrender.com` (ou parecido).
4. Entre em `/admin.html` com a senha e importe a planilha da base.

Custo aproximado: Starter (US$ 7/mês) + disco de 1 GB (US$ 0,25/mês). Também roda com o `Dockerfile` em qualquer servidor.

## Páginas

- **`/`** – home com a marca do Organograma, ilustração, números gerais da estrutura (sem nomes) e acesso por CPF.
  CPF fora da base → *“Acesso negado. Procure o time de DHO.”*
- **`/organograma.html`** – o organograma:
  - cartões no estilo do Power BI (faixa colorida pelo nível com o setor, nome, nível e função);
  - clique no número embaixo do cartão para abrir/fechar a equipe; quem não tem equipe aparece em duas colunas
    em volta de uma linha central, e quem tem equipe aberta fica lado a lado;
  - arrastar para mover, roda do mouse (ou pinça no celular) para zoom, botões de expandir nível, recolher e ajustar à tela;
  - busca por nome ou função, filtro por diretoria, **Minha posição** (o colaborador abre direto no próprio cartão);
  - painel de detalhes: diretoria, setor, seção, filial, gestor, equipe direta, total de pessoas na estrutura e
    “Ver estrutura a partir daqui”.
  - O CPF nunca é enviado para o navegador do organograma.
- **`/admin.html`** – Área do RH:
  - **Base & tratamento**: importa a planilha (.xlsx/.csv), mostra os números do tratamento, as diretorias preenchidas
    automaticamente (com o critério usado), histórico de importações, exportação da base tratada em CSV e backup.
  - **Conferência & ajustes**: lista os pontos a conferir (diretoria preenchida, nível diferente do cargo, nível igual ou
    acima do gestor, gestor fora da base, sem gestor) e permite ajustar nível, diretoria, função exibida e gestor.
    Os ajustes ficam guardados e valem de novo a cada importação.

## Regras de tratamento (`organograma.js`)

- **Colunas usadas**: `CPF`, `FUNCIONÁRIO`, `FUNÇÃO`, `CARGO`, `Nível Colaborador`, `Nível Gestão`, `Diretoria Dax`,
  `SEÇÃO`, `Setor Dax`, `FILIAL_FANTASIA`, `DSITUAÇÃO`, `CPF_Gestor_atualizado`, `Nome Gestor`. Com mais de uma coluna
  possível, vale a primeira que existir (ex.: `CPF_Gestor_atualizado` antes de `CPF_GESTOR`).
- **Gestor**: pelo CPF do gestor atualizado; se o CPF não estiver na base, pelo nome; se o gestor não estiver na base,
  ele vira um cartão tracejado “fora da base”. `SEM GESTOR` fica no topo.
- **Nível**: `Nível Colaborador`; sem ele, `Nível Gestão + 1`; sem os dois, o grupo do `CARGO`
  (01 Diretores → N1/N2, 04 Gerentes Executivos → N3, 05 Gerentes → N4, 06 Coordenação → N5, 07 Supervisores → N6,
  08 Especialistas → N7, demais → N8). Gestor fora da base fica um nível acima do subordinado mais alto, e quem fica
  em **N0** é a **Presidência** (ex.: o Presidente, que não está na base, mas é gestor dos diretores N1).
- **Diretoria em branco**: a mais comum entre quem tem a mesma seção e filial; depois, a mesma seção; depois, a do gestor.
- **Duplicados**: o mesmo CPF em mais de uma coligada vira um único cartão. Demitidos são ignorados.

## Estrutura

```
server.js          API (colaborador e RH) + arquivos estáticos
organograma.js     tratamento da base (gestor, nível, diretoria, duplicados)
db.js              esquema SQLite (base importada, ajustes, importações, acessos)
public/            entrada, organograma e Área do RH (HTML/CSS/JS puro)
public/js/planilha.js  leitura das colunas da planilha (navegador)
scripts/seed-demo.js   base fictícia para testes
```
