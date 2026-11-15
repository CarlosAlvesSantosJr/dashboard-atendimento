// Testes da API e do modo nuvem (login + banco Neon).
// Usam o banco real numa tabela isolada (atendimentos_teste), apagada ao final.
// Precisam de DATABASE_URL (ou do arquivo .env.local gerado por `vercel env pull`); sem isso são pulados.
const { test, expect, request: pwRequest } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function carregarEnvLocal() {
  const arquivo = path.resolve(__dirname, '..', '.env.local');
  if (process.env.DATABASE_URL || !fs.existsSync(arquivo)) return;
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^DATABASE_URL="?([^"]*)"?$/);
    if (m) process.env.DATABASE_URL = m[1];
  }
}
carregarEnvLocal();

const PORTA = 8097;
const BASE = `http://localhost:${PORTA}`;
const SENHA = 'senha-de-teste-123';

test.describe.configure({ mode: 'serial' });
test.skip(!process.env.DATABASE_URL, 'DATABASE_URL não configurada: testes do banco pulados');

let servidor, api;

test.beforeAll(async () => {
  Object.assign(process.env, {
    APP_SENHA: SENHA,
    APP_SEGREDO: 'segredo-de-teste-com-mais-de-32-caracteres-ok',
    ATENDIMENTOS_TABELA: 'atendimentos_teste'
  });
  const { criarServidor } = require('./server');
  servidor = criarServidor({ api: true });
  await new Promise(r => servidor.listen(PORTA, r));
  api = await pwRequest.newContext({ baseURL: BASE });
  await api.post('/api/sessao', { data: { senha: SENHA } });
  await api.delete('/api/atendimentos?todos=1');
});

test.afterAll(async () => {
  const { neon } = require('@neondatabase/serverless');
  await neon(process.env.DATABASE_URL).query('DROP TABLE IF EXISTS atendimentos_teste');
  await api?.dispose();
  await new Promise(r => servidor ? servidor.close(r) : r());
});

const registro = (extra = {}) => ({ data: '2026-11-15', hora: '08:30', bairro: 'Centro', idade: 40, sexo: 'M', motivo: 'Trauma', obito: false, ...extra });

test.describe('API', () => {
  test('sem login não acessa os dados', async () => {
    const anonimo = await pwRequest.newContext({ baseURL: BASE });
    expect((await anonimo.get('/api/atendimentos')).status()).toBe(401);
    expect((await anonimo.post('/api/atendimentos', { data: { registros: [registro()] } })).status()).toBe(401);
    expect(await (await anonimo.get('/api/sessao')).json()).toEqual({ autenticado: false });
    const errada = await anonimo.post('/api/sessao', { data: { senha: 'errada' } });
    expect(errada.status()).toBe(401);
    expect((await errada.json()).erro).toBe('Senha incorreta.');
    await anonimo.dispose();
  });

  test('login cria cookie HttpOnly e sair encerra a sessão', async () => {
    const ctx = await pwRequest.newContext({ baseURL: BASE });
    const login = await ctx.post('/api/sessao', { data: { senha: SENHA } });
    expect(login.status()).toBe(200);
    expect(login.headers()['set-cookie']).toMatch(/samu_sessao=\d+\.[\w-]+; Path=\/; HttpOnly; SameSite=Strict/);
    expect(await (await ctx.get('/api/sessao')).json()).toEqual({ autenticado: true });
    await ctx.delete('/api/sessao');
    expect((await ctx.get('/api/atendimentos')).status()).toBe(401);
    await ctx.dispose();
  });

  test('cookie adulterado é recusado', async () => {
    const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { cookie: `samu_sessao=${Math.floor(Date.now() / 1000) + 9999}.assinatura-falsa` } });
    expect((await ctx.get('/api/atendimentos')).status()).toBe(401);
    await ctx.dispose();
  });

  test('cadastra, lista, atualiza e exclui', async () => {
    const criado = await api.post('/api/atendimentos', { data: { registros: [
      registro({ id: 'a1', unidade: 'USA 01' }),
      registro({ id: 'a2', hora: '09:00', terceiros: true }),
      registro({ id: 'a3', hora: '10:00', qta: true, terceiros: true, obito: true })
    ] } });
    expect(criado.status()).toBe(201);

    const { registros } = await (await api.get('/api/atendimentos')).json();
    expect(registros).toHaveLength(3);
    expect(registros[0]).toMatchObject({ id: 'a1', data: '2026-11-15', hora: '08:30', idade: 40, sexo: 'M', unidade: 'USA 01', terceiros: false, qta: false });
    // terceiros/QTA: servidor descarta idade, sexo e óbito; QTA prevalece sobre terceiros
    expect(registros[1]).toMatchObject({ id: 'a2', idade: null, sexo: '', obito: false, terceiros: true, qta: false });
    expect(registros[2]).toMatchObject({ id: 'a3', idade: null, sexo: '', obito: false, terceiros: false, qta: true });

    const put = await api.put('/api/atendimentos?id=a1', { data: registro({ bairro: 'Lapa', obito: true, unidade: 'USA 01' }) });
    expect(put.status()).toBe(200);
    expect((await put.json()).registro).toMatchObject({ id: 'a1', bairro: 'Lapa', obito: true, unidade: 'USA 01' });

    expect((await api.delete('/api/atendimentos?id=a2')).status()).toBe(200);
    expect((await api.delete('/api/atendimentos?id=a2')).status()).toBe(404);
    expect((await (await api.get('/api/atendimentos')).json()).registros.map(r => r.id)).toEqual(['a1', 'a3']);
  });

  test('valida os dados no servidor', async () => {
    const enviar = r => api.post('/api/atendimentos', { data: { registros: [r] } });
    expect((await enviar(registro({ idade: 200 }))).status()).toBe(400);
    expect((await enviar(registro({ sexo: 'X' }))).status()).toBe(400);
    expect((await enviar(registro({ hora: '25:00' }))).status()).toBe(400);
    expect((await enviar(registro({ data: '15/11/2026' }))).status()).toBe(400);
    expect((await enviar(registro({ bairro: '  ' }))).status()).toBe(400);
    expect((await enviar(registro({ id: "x'; DROP TABLE atendimentos_teste; --" }))).status()).toBe(400);
    expect((await api.post('/api/atendimentos', { data: { registros: [] } })).status()).toBe(400);
    const semJson = await api.post('/api/atendimentos', { headers: { 'content-type': 'text/plain' }, data: 'x' });
    expect(semJson.status()).toBe(415);
    // nada inválido foi gravado
    expect((await (await api.get('/api/atendimentos')).json()).registros).toHaveLength(2);
  });

  test('importação: mesclar atualiza pelo id e substituir troca tudo', async () => {
    await api.post('/api/atendimentos', { data: { modo: 'mesclar', registros: [registro({ id: 'a1', bairro: 'Mooca' }), registro({ id: 'b1' })] } });
    let ids = (await (await api.get('/api/atendimentos')).json()).registros.map(r => r.id).sort();
    expect(ids).toEqual(['a1', 'a3', 'b1']);

    const lote = Array.from({ length: 300 }, (_, i) => registro({ id: 'lote' + i, hora: String(i % 24).padStart(2, '0') + ':00' }));
    expect((await api.post('/api/atendimentos', { data: { modo: 'substituir', registros: lote } })).status()).toBe(201);
    const { registros } = await (await api.get('/api/atendimentos')).json();
    expect(registros).toHaveLength(300);
    expect(registros.some(r => r.id === 'a1')).toBe(false);

    expect((await api.delete('/api/atendimentos?todos=1')).status()).toBe(200);
    expect((await (await api.get('/api/atendimentos')).json()).registros).toHaveLength(0);
  });
});

test.describe('Painel no modo nuvem', () => {
  test('pede senha, grava no banco, mantém após recarregar e sai', async ({ page }) => {
    const erros = [];
    page.on('pageerror', e => erros.push(e.message));
    await page.goto(BASE);
    await expect(page.locator('#ovLogin')).toHaveClass(/show/);
    await expect(page.locator('#notice')).toBeHidden(); // sem dados de exemplo na nuvem

    await page.fill('#lSenha', 'errada');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.locator('#loginErro')).toHaveText('Senha incorreta.');

    await page.fill('#lSenha', SENHA);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.locator('#ovLogin')).not.toHaveClass(/show/);
    await expect(page.getByText('Banco de dados online')).toBeVisible();
    await expect(page.locator('#kTotal')).toHaveText('0');

    await page.getByRole('button', { name: 'Novo atendimento' }).click();
    await page.fill('#iData', '2026-11-15');
    await page.fill('#iHora', '07:45');
    await page.fill('#iBairro', 'Vila Mariana');
    await page.fill('#iMotivo', 'Clínico');
    await page.check('#iQta');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.locator('#ovForm')).not.toHaveClass(/show/);
    await expect(page.locator('#kQta')).toHaveText('1');

    await page.reload();
    await expect(page.locator('#ovLogin')).not.toHaveClass(/show/);
    await expect(page.locator('#kTotal')).toHaveText('1');
    await expect(page.locator('#tbody tr').first()).toContainText('Vila Mariana');

    page.on('dialog', d => d.accept());
    await page.locator('#tbody tr').first().getByTitle('Excluir').click();
    await expect(page.locator('#kTotal')).toHaveText('0');

    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page.locator('#ovLogin')).toHaveClass(/show/);
    await page.reload();
    await expect(page.locator('#ovLogin')).toHaveClass(/show/);
    expect(erros).toEqual([]);
  });
});
