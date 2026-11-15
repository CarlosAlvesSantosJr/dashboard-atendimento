# Gera as imagens das páginas do relatório PDF usadas no README.
# Uso: python scripts/pdf-imagens.py   (requer: pip install pymupdf; rode depois de `npm run screenshots`)
from pathlib import Path
import pymupdf

DOCS = Path(__file__).resolve().parent.parent / "docs"
PAGINAS = {0: "08-pdf-pagina1.png", 1: "09-pdf-pagina2.png", 2: "10-pdf-resumo.png"}

with pymupdf.open(DOCS / "relatorio-exemplo.pdf") as pdf:
    for indice, nome in PAGINAS.items():
        pdf[indice].get_pixmap(dpi=110).save(DOCS / "images" / nome)
        print("  ok", nome)
