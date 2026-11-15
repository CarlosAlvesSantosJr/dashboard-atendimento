// GET    /api/atendimentos              → { registros }
// POST   /api/atendimentos              → { registros, modo: 'mesclar' | 'substituir' }  (cadastro e importação)
// PUT    /api/atendimentos?id=<id>      → atualiza um atendimento
// DELETE /api/atendimentos?id=<id>      → exclui um atendimento
// DELETE /api/atendimentos?todos=1      → apaga todos
// Todas as rotas exigem sessão válida.
const { responder, lerCorpo, exigirJson, parametros, manipulador, ErroHttp } = require('../lib/http');
const { exigirSessao } = require('../lib/auth');
const db = require('../lib/db');

module.exports = manipulador(async (req, res) => {
  exigirSessao(req);
  const q = parametros(req);
  const id = q.get('id') || '';

  switch (req.method) {
    case 'GET':
      return responder(res, 200, { registros: await db.listar() });

    case 'POST': {
      exigirJson(req);
      const { registros, modo } = await lerCorpo(req);
      if (modo !== undefined && modo !== 'mesclar' && modo !== 'substituir') throw new ErroHttp(400, 'Modo inválido.');
      return responder(res, 201, { registros: await db.gravar(registros, modo) });
    }

    case 'PUT': {
      if (!id) throw new ErroHttp(400, 'Informe o id.');
      exigirJson(req);
      return responder(res, 200, { registro: await db.atualizar(id, await lerCorpo(req)) });
    }

    case 'DELETE':
      if (id) await db.excluir(id);
      else if (q.get('todos') === '1') await db.excluirTodos();
      else throw new ErroHttp(400, 'Informe o id ou todos=1.');
      return responder(res, 200, { ok: true });

    default:
      res.setHeader('Allow', 'GET, POST, PUT, DELETE');
      throw new ErroHttp(405, 'Método não permitido.');
  }
});
