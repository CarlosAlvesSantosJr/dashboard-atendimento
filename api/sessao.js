// GET    /api/sessao  → { autenticado }   (também indica ao painel que existe banco na nuvem)
// POST   /api/sessao  → login com { senha }
// DELETE /api/sessao  → sair
const { responder, lerCorpo, exigirJson, manipulador, ErroHttp } = require('../lib/http');
const { senhaConfere, criarSessao, encerrarSessao, sessaoValida } = require('../lib/auth');

const esperar = ms => new Promise(r => setTimeout(r, ms));

module.exports = manipulador(async (req, res) => {
  if (req.method === 'GET') return responder(res, 200, { autenticado: sessaoValida(req) });

  if (req.method === 'POST') {
    exigirJson(req);
    const { senha } = await lerCorpo(req);
    if (!senhaConfere(senha)) {
      await esperar(800); // atrasa tentativas de adivinhar a senha
      throw new ErroHttp(401, 'Senha incorreta.');
    }
    criarSessao(req, res);
    return responder(res, 200, { autenticado: true });
  }

  if (req.method === 'DELETE') {
    encerrarSessao(req, res);
    return responder(res, 200, { autenticado: false });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  throw new ErroHttp(405, 'Método não permitido.');
});
