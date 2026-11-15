// Utilitários HTTP compartilhados pelas funções serverless (Vercel) e pelo servidor local de testes.

const LIMITE_CORPO = 4 * 1024 * 1024; // 4 MB (limite de corpo da Vercel é 4,5 MB)

function responder(res, status, corpo) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corpo ?? {}));
}

// A Vercel já entrega req.body parseado; o servidor local entrega o stream cru.
async function lerCorpo(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
    if (Buffer.isBuffer(req.body)) return req.body.length ? JSON.parse(req.body.toString('utf8')) : {};
    return req.body ?? {};
  }
  let tamanho = 0;
  const partes = [];
  for await (const parte of req) {
    tamanho += parte.length;
    if (tamanho > LIMITE_CORPO) throw new ErroHttp(413, 'Arquivo grande demais para enviar de uma vez.');
    partes.push(parte);
  }
  const texto = Buffer.concat(partes).toString('utf8');
  return texto ? JSON.parse(texto) : {};
}

function exigirJson(req) {
  // Formulários HTML não conseguem enviar application/json sem preflight: defesa extra contra CSRF.
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    throw new ErroHttp(415, 'Envie os dados como JSON.');
  }
}

function parametros(req) {
  return new URL(req.url, 'http://localhost').searchParams;
}

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

// Envolve um handler: trata erros de forma uniforme sem vazar detalhes internos.
function manipulador(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof ErroHttp) return responder(res, e.status, { erro: e.message });
      if (e instanceof SyntaxError) return responder(res, 400, { erro: 'JSON inválido.' });
      console.error(e);
      responder(res, 500, { erro: 'Erro interno no servidor.' });
    }
  };
}

module.exports = { responder, lerCorpo, exigirJson, parametros, ErroHttp, manipulador };
