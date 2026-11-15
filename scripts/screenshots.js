// Gera as imagens da documentação em docs/images (uso: npm run screenshots)
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const { criarServidor } = require('../tests/server.js');
criarServidor().listen(8098);

const OUT = path.resolve(__dirname, '..', 'docs', 'images');
const URL = 'http://localhost:8098';

const CSV_EXEMPLO = '﻿data;hora;bairro;idade;sexo;especialidade;obito\r\n' +
  '02/11/2026;08:15;Centro;0;F;Neonatal;Não\r\n' +
  '02/11/2026;09:30;Vila Nova;34;M;Trauma;Não\r\n' +
  '02/11/2026;21:00;Lapa;67;F;Cardiológico;Sim\r\n' +
  '03/11/2026;22:00;Lapa;;M;Clínico;\r\n';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', acceptDownloads: true });
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  const foto = async (nome, opcoes = {}) => {
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, nome), ...opcoes });
    console.log('  ✓', nome);
  };

  // Capturas com dados fictícios (nunca dados reais de produção).
  // Esconde o aviso de "dados de exemplo" e mostra a barra como em produção (selo do banco + Sair).
  const comoProducao = p => p.evaluate(() => { EXEMPLO = false; document.body.classList.add('nuvem'); render(); });

  await page.goto(URL);
  await comoProducao(page);
  await page.evaluate(() => mostrarLogin());
  await foto('00-login.png');
  await page.evaluate(() => ovLogin.classList.remove('show'));

  await foto('01-painel.png');
  await foto('02-painel-completo.png', { fullPage: true });

  await page.getByRole('button', { name: 'Novo atendimento' }).click();
  await page.waitForTimeout(200);
  await page.fill('#iHora', '14:30');
  await page.fill('#iIdade', '0');
  await page.locator('label[for="iSexoF"]').click();
  await page.fill('#iMotivo', 'Neonatal');
  await page.check('#iObito');
  await page.locator('#iBairro').pressSequentially('Vila Esperança');
  await page.locator('#iMotivo').click();
  await foto('03-cadastro.png');
  await page.getByRole('button', { name: 'Cancelar' }).click();

  // Ocorrência em que o paciente já tinha sido levado: só data, hora, bairro e especialidade
  await page.getByRole('button', { name: 'Novo atendimento' }).click();
  await page.waitForTimeout(200);
  await page.fill('#iHora', '16:40');
  await page.locator('#iBairro').pressSequentially('Centro');
  await page.fill('#iMotivo', 'Cardiológico');
  await page.check('#iTerceiros');
  await page.locator('#iMotivo').click();
  await foto('11-terceiros-qta.png');
  await page.getByRole('button', { name: 'Cancelar' }).click();

  await page.selectOption('#fEsp', 'Trauma');
  await page.selectOption('#fTurno', 'dia');
  await foto('04-filtros.png');
  await page.getByRole('button', { name: /Limpar filtros/ }).click();

  await page.addStyleTag({ content: '.toolbar { position: static !important; }' });
  const tabela = page.locator('.card', { has: page.locator('#tbody') });
  await tabela.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await tabela.screenshot({ path: path.join(OUT, '05-registros.png') });
  console.log('  ✓ 05-registros.png');

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setInputFiles('#fileInput', { name: 'atendimentos-novembro.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV_EXEMPLO, 'utf-8') });
  await foto('06-importacao.png');
  await page.getByRole('button', { name: 'Cancelar' }).last().click();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar PDF' }).click()]);
  await download.saveAs(path.join(OUT, '..', 'relatorio-exemplo.pdf'));
  console.log('  ✓ relatorio-exemplo.pdf');

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'pt-BR', isMobile: true });
  const cel = await mobile.newPage();
  await cel.goto(URL);
  await comoProducao(cel);
  await cel.waitForTimeout(600);
  await cel.screenshot({ path: path.join(OUT, '07-celular.png') });
  console.log('  ✓ 07-celular.png');

  await browser.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
