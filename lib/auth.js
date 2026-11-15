// Autenticação por senha única da coordenação com sessão em cookie assinado (HMAC-SHA256).
// Variáveis de ambiente: APP_SENHA (senha de acesso) e APP_SEGREDO (chave de assinatura, 32+ caracteres).
const crypto = require('crypto');
const { ErroHttp } = require('./http');

const COOKIE = 'samu_sessao';
const DURACAO_S = 7 * 24 * 60 * 60; // 7 dias

function segredo() {
  const s = process.env.APP_SEGREDO || '';
  if (s.length < 32) throw new Error('APP_SEGREDO ausente ou curto demais (mínimo 32 caracteres).');
  return s;
}

function assinar(valor) {
  return crypto.createHmac('sha256', segredo()).update(valor).digest('base64url');
}

function iguais(a, b) {
  // Compara hashes de tamanho fixo para não vazar o tamanho nem o conteúdo por tempo de resposta.
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function senhaConfere(senha) {
  const correta = process.env.APP_SENHA || '';
  if (!correta) throw new Error('APP_SENHA não configurada.');
  return typeof senha === 'string' && iguais(senha, correta);
}

function viaHttps(req) {
  return String(req.headers['x-forwarded-proto'] || '').includes('https') || !!req.socket?.encrypted;
}

function cookie(req, valor, maxAge) {
  return `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${viaHttps(req) ? '; Secure' : ''}`;
}

function criarSessao(req, res) {
  const exp = String(Math.floor(Date.now() / 1000) + DURACAO_S);
  res.setHeader('Set-Cookie', cookie(req, `${exp}.${assinar(exp)}`, DURACAO_S));
}

function encerrarSessao(req, res) {
  res.setHeader('Set-Cookie', cookie(req, '', 0));
}

function lerCookie(req) {
  const bruto = String(req.headers.cookie || '');
  for (const parte of bruto.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return '';
}

function sessaoValida(req) {
  const [exp, assinatura] = lerCookie(req).split('.');
  if (!exp || !assinatura || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  return iguais(assinatura, assinar(exp));
}

function exigirSessao(req) {
  if (!sessaoValida(req)) throw new ErroHttp(401, 'Acesso não autorizado. Entre com a senha.');
}

module.exports = { senhaConfere, criarSessao, encerrarSessao, sessaoValida, exigirSessao };
