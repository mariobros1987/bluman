const TAG_AMMESSI = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'small', 'span', 'strong', 'sub', 'sup',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
]);
const TAG_VUOTI = new Set(['br', 'hr', 'img']);
const TAG_BLOCCATI_CON_CONTENUTO = new Set([
  'base', 'button', 'embed', 'form', 'iframe', 'input', 'link', 'math', 'meta', 'object',
  'script', 'select', 'style', 'svg', 'template', 'textarea',
]);
const PROPRIETA_CSS = new Set([
  'align-items', 'background', 'background-color', 'border', 'border-bottom', 'border-color',
  'border-left', 'border-radius', 'border-right', 'border-style', 'border-top', 'border-width',
  'box-shadow', 'color', 'cursor', 'display', 'flex', 'flex-direction', 'flex-wrap', 'font-family',
  'font-size', 'font-style', 'font-weight', 'gap', 'height', 'justify-content', 'letter-spacing',
  'line-height', 'list-style', 'margin', 'margin-bottom', 'margin-left', 'margin-right', 'margin-top',
  'max-height', 'max-width', 'min-height', 'min-width', 'opacity', 'overflow', 'overflow-wrap',
  'padding', 'padding-bottom', 'padding-left', 'padding-right', 'padding-top', 'table-layout',
  'text-align', 'text-decoration', 'text-indent', 'text-transform', 'vertical-align', 'white-space',
  'width', 'word-break',
]);

export function escapeHtmlTesto(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtmlTesto(value);
}

function decodificaEntita(value: string): string {
  return value
    .replace(/&#(\d+);?/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(colon|tab|newline);/gi, (m) => ({ '&colon;': ':', '&tab;': '\t', '&newline;': '\n' })[m.toLowerCase()] ?? m)
    .replace(/&amp;/gi, '&');
}

function urlAmmesso(value: string, immagine: boolean): boolean {
  const normalizzato = decodificaEntita(value).replace(/[\x00-\x20\x7f]+/g, '').toLowerCase();
  if (!normalizzato) return false;
  if (immagine && /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(normalizzato)) return true;
  return /^(https?:|mailto:|tel:|#|\/)/i.test(normalizzato) && !normalizzato.startsWith('//');
}

function sanitizzaStyle(value: string): string {
  const risultato: string[] = [];
  for (const dichiarazione of value.split(';')) {
    const separatore = dichiarazione.indexOf(':');
    if (separatore < 1) continue;
    const proprieta = dichiarazione.slice(0, separatore).trim().toLowerCase();
    const valore = dichiarazione.slice(separatore + 1).trim();
    if (!PROPRIETA_CSS.has(proprieta) || !valore) continue;
    const controllo = decodificaEntita(valore).replace(/\s|\\/g, '').toLowerCase();
    if (/url\(|expression\(|@import|javascript:|vbscript:|data:|behavior:|-moz-binding/.test(controllo)) continue;
    risultato.push(`${proprieta}: ${valore.replace(/[<>]/g, '')}`);
  }
  return risultato.join('; ');
}

function attributiAmmessi(tag: string, sorgente: string): string {
  const output: string[] = [];
  const regex = /([^\s=/'">]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(sorgente))) {
    const nome = match[1]?.toLowerCase() ?? '';
    const valore = match[2] ?? match[3] ?? match[4] ?? '';
    if (!nome || nome.startsWith('on') || nome === 'srcdoc') continue;
    if (nome === 'style') {
      const style = sanitizzaStyle(valore);
      if (style) output.push(`style="${escapeAttr(style)}"`);
    } else if (nome === 'class') {
      const classi = valore.split(/\s+/).filter((c) => /^[a-zA-Z0-9_-]{1,64}$/.test(c)).join(' ');
      if (classi) output.push(`class="${classi}"`);
    } else if (nome === 'data-bluman-blocco' && ['intestazione', 'piede'].includes(valore)) {
      output.push(`${nome}="${valore}"`);
    } else if (['title', 'alt'].includes(nome)) {
      output.push(`${nome}="${escapeAttr(valore)}"`);
    } else if (['colspan', 'rowspan'].includes(nome) && /^\d{1,2}$/.test(valore)) {
      output.push(`${nome}="${valore}"`);
    } else if (tag === 'a' && nome === 'href' && urlAmmesso(valore, false)) {
      output.push(`href="${escapeAttr(valore)}"`);
    } else if (tag === 'a' && nome === 'download') {
      output.push(valore ? `download="${escapeAttr(valore)}"` : 'download');
    } else if (tag === 'img' && nome === 'src' && urlAmmesso(valore, true)) {
      output.push(`src="${escapeAttr(valore)}"`);
    }
  }
  if (tag === 'a') output.push('rel="noopener noreferrer"');
  return output.length ? ` ${Array.from(new Set(output)).join(' ')}` : '';
}

function fineTag(html: string, inizio: number): number {
  let apice = '';
  for (let i = inizio + 1; i < html.length; i += 1) {
    const c = html[i] ?? '';
    if (apice) { if (c === apice) apice = ''; }
    else if (c === '"' || c === "'") apice = c;
    else if (c === '>') return i;
  }
  return -1;
}

/** Sanitizzatore allowlist condiviso da API e browser; non interpreta mai markup non ammesso. */
export function sanitizzaHtmlDocumento(input: unknown): string {
  if (typeof input !== 'string' || !input) return '';
  let output = '';
  const bloccati: string[] = [];
  for (let pos = 0; pos < input.length;) {
    const apertura = input.indexOf('<', pos);
    if (apertura < 0) { if (!bloccati.length) output += input.slice(pos); break; }
    if (!bloccati.length) output += input.slice(pos, apertura);
    const fine = fineTag(input, apertura);
    if (fine < 0) { if (!bloccati.length) output += '&lt;' + input.slice(apertura + 1); break; }
    const token = input.slice(apertura + 1, fine);
    const parsed = token.match(/^\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)([\s\S]*)$/);
    if (parsed) {
      const chiusura = parsed[1] === '/';
      const tag = (parsed[2] ?? '').toLowerCase();
      if (TAG_BLOCCATI_CON_CONTENUTO.has(tag)) {
        if (!chiusura) bloccati.push(tag);
        else if (bloccati[bloccati.length - 1] === tag) bloccati.pop();
      } else if (!bloccati.length && TAG_AMMESSI.has(tag)) {
        output += chiusura ? (TAG_VUOTI.has(tag) ? '' : `</${tag}>`) : `<${tag}${attributiAmmessi(tag, parsed[3] ?? '')}>`;
      }
    }
    pos = fine + 1;
  }
  return output;
}
