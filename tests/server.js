// Servidor mínimo para desenvolvimento e testes (sem dependências além das do projeto).
// Serve os arquivos estáticos e, quando API_LOCAL=1, também as funções de /api (como na Vercel).
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.css': 'text/css' };
const ROTAS_API = { '/api/sessao': '../api/sessao', '/api/atendimentos': '../api/atendimentos' };

function criarServidor({ api = false } = {}) {
  return http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url.startsWith('/api/')) {
      if (!api || !ROTAS_API[url]) { res.writeHead(404); return res.end(); }
      return require(ROTAS_API[url])(req, res);
    }
    const arquivo = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!arquivo.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(arquivo, (err, conteudo) => {
      if (err) { res.writeHead(404); return res.end('Não encontrado'); }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream' });
      res.end(conteudo);
    });
  });
}

module.exports = { criarServidor };

if (require.main === module) {
  const PORT = process.env.PORT || 8080;
  const api = process.env.API_LOCAL === '1';
  criarServidor({ api }).listen(PORT, () => console.log(`Painel SAMU em http://localhost:${PORT}${api ? ' (com API/banco)' : ''}`));
}
