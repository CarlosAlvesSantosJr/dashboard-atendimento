// Acesso ao banco Neon (Postgres serverless via HTTP).
// Variáveis de ambiente: DATABASE_URL (criada pela integração Neon da Vercel)
// e, opcionalmente, ATENDIMENTOS_TABELA (usada pelos testes para isolar os dados).
const { neon } = require('@neondatabase/serverless');
const { ErroHttp } = require('./http');

const CAMPOS_FIXOS = ['id', 'data', 'hora', 'bairro', 'idade', 'sexo', 'motivo', 'obito', 'terceiros', 'qta'];
const MAX_REGISTROS = 20000;

function tabela() {
  const t = process.env.ATENDIMENTOS_TABELA || 'atendimentos';
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(t)) throw new Error('ATENDIMENTOS_TABELA inválida.');
  return t;
}

let sql = null;
let tabelaPronta = null;

function conexao() {
  if (!sql) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada.');
    sql = neon(process.env.DATABASE_URL);
  }
  return sql;
}

async function garantirTabela() {
  const t = tabela();
  if (tabelaPronta !== t) {
    await conexao().query(`
      CREATE TABLE IF NOT EXISTS ${t} (
        id            text PRIMARY KEY,
        data          date NOT NULL,
        hora          text NOT NULL,
        bairro        text NOT NULL,
        idade         integer,
        sexo          text NOT NULL DEFAULT '',
        motivo        text NOT NULL DEFAULT '',
        obito         boolean NOT NULL DEFAULT false,
        terceiros     boolean NOT NULL DEFAULT false,
        qta           boolean NOT NULL DEFAULT false,
        extras        jsonb NOT NULL DEFAULT '{}'::jsonb,
        criado_em     timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await conexao().query(`CREATE INDEX IF NOT EXISTS ${t}_data_hora_idx ON ${t} (data, hora)`);
    tabelaPronta = t;
  }
  return conexao();
}

// ───── Validação: o servidor não confia no navegador ─────
const texto = (v, max) => String(v ?? '').trim().slice(0, max);
const booleano = v => v === true || v === 'true' || v === 1;

function validar(bruto, idForcado) {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) throw new ErroHttp(400, 'Registro inválido.');
  const id = idForcado || texto(bruto.id, 40) || novoId();
  const r = {
    id,
    data: texto(bruto.data, 10),
    hora: texto(bruto.hora, 5),
    bairro: texto(bruto.bairro, 120),
    idade: bruto.idade === null || bruto.idade === undefined || bruto.idade === '' ? null : Number(bruto.idade),
    sexo: texto(bruto.sexo, 1).toUpperCase(),
    motivo: texto(bruto.motivo, 120),
    obito: booleano(bruto.obito),
    terceiros: booleano(bruto.terceiros),
    qta: booleano(bruto.qta)
  };
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(r.id)) throw new ErroHttp(400, 'Identificador inválido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.data) || isNaN(Date.parse(r.data))) throw new ErroHttp(400, 'Data inválida.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.hora)) throw new ErroHttp(400, 'Horário inválido.');
  if (!r.bairro) throw new ErroHttp(400, 'Informe o bairro.');
  if (r.qta) r.terceiros = false;
  if (r.terceiros || r.qta) {
    // Paciente não foi atendido pela equipe: só data, hora, bairro e especialidade.
    r.idade = null; r.sexo = ''; r.obito = false;
  } else {
    if (!Number.isInteger(r.idade) || r.idade < 0 || r.idade > 130) throw new ErroHttp(400, 'Idade inválida.');
    if (r.sexo !== 'M' && r.sexo !== 'F') throw new ErroHttp(400, 'Sexo inválido.');
  }
  // Colunas extras da planilha (ex.: "unidade") são preservadas em JSON.
  const extras = {};
  for (const [k, v] of Object.entries(bruto)) {
    if (CAMPOS_FIXOS.includes(k) || Object.keys(extras).length >= 20) continue;
    const chave = texto(k, 40);
    if (chave && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) extras[chave] = texto(v, 200);
  }
  r.extras = extras;
  return r;
}

function novoId() {
  return Date.now().toString(36) + require('crypto').randomBytes(4).toString('hex');
}

function deLinha(l) {
  const { extras, ...r } = l;
  return { ...(extras || {}), ...r, obito: !!r.obito, terceiros: !!r.terceiros, qta: !!r.qta };
}

const SELECT = `id, to_char(data, 'YYYY-MM-DD') AS data, hora, bairro, idade, sexo, motivo, obito, terceiros, qta, extras`;

async function listar() {
  const db = await garantirTabela();
  const linhas = await db.query(`SELECT ${SELECT} FROM ${tabela()} ORDER BY data, hora, criado_em`);
  return linhas.map(deLinha);
}

function consultaInserir(db, registros) {
  const col = c => registros.map(r => r[c]);
  return db.query(
    `INSERT INTO ${tabela()} (id, data, hora, bairro, idade, sexo, motivo, obito, terceiros, qta, extras)
     SELECT * FROM unnest($1::text[], $2::date[], $3::text[], $4::text[], $5::int[], $6::text[], $7::text[],
                          $8::bool[], $9::bool[], $10::bool[], $11::jsonb[])
     ON CONFLICT (id) DO UPDATE SET
       data = EXCLUDED.data, hora = EXCLUDED.hora, bairro = EXCLUDED.bairro, idade = EXCLUDED.idade,
       sexo = EXCLUDED.sexo, motivo = EXCLUDED.motivo, obito = EXCLUDED.obito, terceiros = EXCLUDED.terceiros,
       qta = EXCLUDED.qta, extras = EXCLUDED.extras, atualizado_em = now()
     RETURNING ${SELECT}`,
    [col('id'), col('data'), col('hora'), col('bairro'), col('idade'), col('sexo'), col('motivo'),
      col('obito'), col('terceiros'), col('qta'), registros.map(r => JSON.stringify(r.extras))]
  );
}

// modo "mesclar" adiciona/atualiza; "substituir" apaga tudo e grava a lista recebida (na mesma transação).
async function gravar(brutos, modo = 'mesclar') {
  if (!Array.isArray(brutos) || !brutos.length) throw new ErroHttp(400, 'Nenhum registro enviado.');
  if (brutos.length > MAX_REGISTROS) throw new ErroHttp(413, `Envie no máximo ${MAX_REGISTROS} registros por vez.`);
  const registros = brutos.map(b => validar(b));
  const db = await garantirTabela();
  if (modo === 'substituir') {
    const [, linhas] = await db.transaction([db.query(`DELETE FROM ${tabela()}`), consultaInserir(db, registros)]);
    return linhas.map(deLinha);
  }
  return (await consultaInserir(db, registros)).map(deLinha);
}

async function atualizar(id, bruto) {
  const r = validar(bruto, id);
  const db = await garantirTabela();
  const linhas = await db.query(
    `UPDATE ${tabela()} SET data = $2, hora = $3, bairro = $4, idade = $5, sexo = $6, motivo = $7,
       obito = $8, terceiros = $9, qta = $10, extras = $11::jsonb, atualizado_em = now()
     WHERE id = $1 RETURNING ${SELECT}`,
    [r.id, r.data, r.hora, r.bairro, r.idade, r.sexo, r.motivo, r.obito, r.terceiros, r.qta, JSON.stringify(r.extras)]
  );
  if (!linhas.length) throw new ErroHttp(404, 'Atendimento não encontrado.');
  return deLinha(linhas[0]);
}

async function excluir(id) {
  const db = await garantirTabela();
  const linhas = await db.query(`DELETE FROM ${tabela()} WHERE id = $1 RETURNING id`, [id]);
  if (!linhas.length) throw new ErroHttp(404, 'Atendimento não encontrado.');
}

async function excluirTodos() {
  const db = await garantirTabela();
  await db.query(`DELETE FROM ${tabela()}`);
}

module.exports = { listar, gravar, atualizar, excluir, excluirTodos, validar };
