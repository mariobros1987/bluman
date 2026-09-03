import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { A4_MM, A4_PX } from '../../../src/util/paginaA4';
import { creaPagineA4 } from './pdfA4';

export interface SignatureData {
  signerName: string;
  signerRole: string;
  signatureImageBase64?: string;
  timestamp: string;
  /** `null` quando il server non ha registrato l'IP del firmatario: si stampa così. */
  ipAddress: string | null;
  /** Identificativo e impronta del sigillo, quando la firma è registrata a database. */
  signatureId?: string;
  sha256Digest?: string;
}

/**
 * §38 — La geometria del foglio e la scelta di dove finisce una pagina non stanno più qui.
 *
 * I millimetri e la distribuzione dei blocchi sono in `src/util/paginaA4.ts` (aritmetica pura,
 * presidiata da `src/paginazioneA4.test.ts`); la misura nel DOM è in `./pdfA4.ts`. Questo file è
 * tornato a essere quello che dice di essere: il driver che porta i fogli in un PDF binario e in
 * un .doc. Prima teneva anche `A4_SPECS` e un impaginatore che spezzava solo tra i figli diretti
 * dell'HTML ricevuto — e i chiamanti passano tutti un unico `<div>` che avvolge il documento,
 * quindi non spezzava niente e il testo finiva disegnato fino al bordo del foglio.
 */

/** Il piè di pagina di ogni foglio: conosce il numero di pagina perché lo riceve. */
function piedeStandard(pagina: number, totale: number): string {
  return `
      <span>BluMan Advisory Platform • Firma elettronica semplice · art. 20 CAD</span>
      <span>Pagina ${pagina} di ${totale}</span>
  `;
}

/**
 * §36 — il blocco delle firme, in coda al contenuto.
 *
 * Non è un elemento a parte per l'impaginatore: entra nel flusso come tutto il resto e finisce sul
 * foglio dove c'è posto. Prima veniva accodato a mano alla pagina corrente con lo stesso calcolo
 * approssimato del contenuto, e su documenti pieni scavalcava il margine inferiore.
 */
function htmlFirme(signatures: SignatureData[]): string {
  if (!signatures || signatures.length === 0) return '';
  return `
    <div style="margin-top: 28px; padding-top: 14px; border-top: 1.5px solid #cbd5e1;">
      <div style="font-size: 9.5pt; font-weight: 700; color: #4338ca; text-transform: uppercase; margin-bottom: 10px; letter-spacing: 0.5px;">
        🔒 Firma Elettronica Semplice (OTP verificata) · art. 20 CAD
      </div>
      <div style="display: flex; gap: 14px; flex-wrap: wrap;">
        ${signatures.map(sig => `
          <div style="flex: 1; min-width: 220px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; box-sizing: border-box;">
            <div style="font-size: 9.5pt; font-weight: 700; color: #0f172a;">${sig.signerRole}: ${sig.signerName}</div>
            <div style="font-size: 9pt; color: #166534; font-weight: 700; margin: 3px 0;">✓ FIRMATO CON OTP VERIFICATA (art. 20 CAD)</div>
            ${sig.signatureImageBase64 ? `<img src="${sig.signatureImageBase64}" style="height: 36px; max-width: 160px; margin: 4px 0; object-fit: contain;" />` : ''}
            <div style="font-size: 8pt; color: #64748b; font-family: monospace; margin-top: 3px; line-height: 1.3;">
              Data/Ora: ${sig.timestamp}<br/>
              IP: ${sig.ipAddress || 'non registrato'}${sig.signatureId ? `<br/>Sigillo: ${sig.signatureId}` : ''}
              ${sig.sha256Digest ? `<br/>SHA-256: ${sig.sha256Digest}` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/**
 * §39 — Chi stampa può portare il proprio piè di pagina.
 *
 * Document Studio ha un piè di pagina che l'operatore può sbloccare e modificare: deve finire su
 * ogni foglio del PDF, come fa il piede standard. Senza questo parametro l'unico modo era accodarlo
 * al contenuto, e allora compariva una volta sola — in fondo all'ultima pagina — mentre in cima al
 * foglio ne restava stampato un altro, quello di serie: due piedi diversi nello stesso documento.
 */
export interface OpzioniStampa {
  /** Il piè di pagina di ogni foglio; riceve numero e totale delle pagine. */
  piede?: (pagina: number, totale: number) => string;
}

/** I fogli A4 fisici pronti da rendere: contenuto, firme in coda, piè di pagina numerato. */
function preparaFogli(contentHtml: string, signatures: SignatureData[], opzioni: OpzioniStampa = {}): HTMLElement[] {
  return creaPagineA4(`${contentHtml}${htmlFirme(signatures)}`, { piede: opzioni.piede ?? piedeStandard });
}


/**
 * Genera e scarica direttamente un VERO file binary .pdf A4 conforme agli standard ISO 216
 */
export async function downloadRealPdf(
  fileName: string,
  elementOrHtml: HTMLElement | string,
  signatures: SignatureData[] = [],
  opzioni: OpzioniStampa = {}
) {
  // Protezione automatica se gli argomenti sono invertiti (HTML nel primo parametro)
  if (typeof fileName === 'string' && fileName.includes('<') && (typeof elementOrHtml === 'string' && !elementOrHtml.includes('<'))) {
    const temp = fileName;
    fileName = elementOrHtml;
    elementOrHtml = temp;
  }

  const rawHtml = typeof elementOrHtml === 'string' ? elementOrHtml : elementOrHtml.innerHTML;
  const pageDomElements = preparaFogli(rawHtml, signatures, opzioni);

  try {
    // 1. Converti tutte le immagini in Base64 Data URL sincroni per html2canvas
    for (const pageEl of pageDomElements) {
      const images = Array.from(pageEl.querySelectorAll('img'));
      await Promise.all(
        images.map(async (img) => {
          try {
            const src = img.getAttribute('src');
            if (!src || src.startsWith('data:')) return;

            const res = await fetch(src, { mode: 'cors' });
            if (!res.ok) return;
            const blob = await res.blob();
            const dataUrl = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });
            img.setAttribute('src', dataUrl);
          } catch (err) {
            console.warn('Pre-caricamento immagine Base64 per PDF:', err);
          }
        })
      );
    }

    // Attendi render finale del DOM e font rendering
    await new Promise((resolve) => setTimeout(resolve, 250));

    // 2. Generazione PDF Formato A4 Standard (210mm x 297mm)
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    // 3. Renderizza ciascuna pagina fisica A4 in modo indipendente (zero righe tagliate!)
    for (let i = 0; i < pageDomElements.length; i++) {
      const pageEl = pageDomElements[i];
      const canvas = await html2canvas(pageEl, {
        scale: 2.5,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: A4_PX.larghezza,
      });

      const imgData = canvas.toDataURL('image/png');

      if (i > 0) {
        pdf.addPage();
      }

      pdf.addImage(imgData, 'PNG', 0, 0, A4_MM.larghezza, A4_MM.altezza);
    }

    const cleanFileName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;

    // 4. Download Diretto Binary PDF
    pdf.save(cleanFileName);
  } catch (error) {
    console.error('Errore generazione PDF:', error);
    alert('⚠️ Errore durante la creazione del file PDF. Riprovare.');
  } finally {
    // Pulizia dei container dal DOM
    pageDomElements.forEach((pageEl) => {
      if (pageEl.parentNode) {
        pageEl.parentNode.removeChild(pageEl);
      }
    });
  }
}

/**
 * Genera il contenuto Base64 di un file VERO PDF binario A4 a partire da HTML.
 */
export async function generateRealPdfBase64(
  elementOrHtml: HTMLElement | string,
  signatures: SignatureData[] = []
): Promise<string> {
  const rawHtml = typeof elementOrHtml === 'string' ? elementOrHtml : elementOrHtml.innerHTML;
  const pageDomElements = preparaFogli(rawHtml, signatures);

  try {
    for (const pageEl of pageDomElements) {
      const images = Array.from(pageEl.querySelectorAll('img'));
      await Promise.all(
        images.map(async (img) => {
          try {
            const src = img.getAttribute('src');
            if (!src || src.startsWith('data:')) return;
            const res = await fetch(src, { mode: 'cors' });
            if (!res.ok) return;
            const blob = await res.blob();
            const dataUrl = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });
            img.setAttribute('src', dataUrl);
          } catch (err) {
            console.warn('Pre-caricamento immagine Base64 per PDF:', err);
          }
        })
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    for (let i = 0; i < pageDomElements.length; i++) {
      const pageEl = pageDomElements[i];
      const canvas = await html2canvas(pageEl, {
        scale: 2.0,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: A4_PX.larghezza,
      });

      const imgData = canvas.toDataURL('image/png');
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, 0, A4_MM.larghezza, A4_MM.altezza);
    }

    const dataUri = pdf.output('datauristring');
    return dataUri.split(',')[1] || '';
  } catch (error) {
    console.error('Errore generazione PDF Base64:', error);
    // Fallback su conversione base64 dell'HTML se html2canvas fallisce
    return btoa(unescape(encodeURIComponent(rawHtml)));
  } finally {
    pageDomElements.forEach((pageEl) => {
      if (pageEl.parentNode) {
        pageEl.parentNode.removeChild(pageEl);
      }
    });
  }
}

/**
 * Genera e scarica direttamente la Guida Configurazione Canali Omnichannel in formato VERO PDF A4
 */
export async function downloadGuidePdf() {
  const guideHtml = `
    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2.5px solid #4338ca; padding-bottom: 14px; margin-bottom: 22px;">
      <div>
        <h1 style="font-size: 18px; font-weight: 800; color: #1e1b4b; margin: 0; text-align: left;">BluMan Advisory Platform</h1>
        <div style="font-size: 11px; color: #4338ca; font-weight: 700; margin-top: 3px;">GUIDA UFFICIALE CONFIGURAZIONE CANALI MULTICANALE</div>
      </div>
      <div style="text-align: right; font-size: 10px; color: #64748b; line-height: 1.4;">
        <div>Data: ${new Date().toLocaleDateString('it-IT')}</div>
        <div>Versione: v2.4 (Cloud Multi-Tenant)</div>
      </div>
    </div>

    <h2 style="font-size: 13.5px; color: #1e1b4b; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 16px;">🟢 1. WhatsApp Business API (Meta Cloud API)</h2>
    <div style="font-size: 10.5px; color: #334155;">
      <h4 style="margin: 6px 0 3px 0; color: #4338ca;">A. Credenziali Meta Developers:</h4>
      <ol style="margin: 0; padding-left: 18px;">
        <li>Accedi a <strong>developers.facebook.com</strong> con l'account aziendale.</li>
        <li>Crea un'applicazione di tipo <strong>Business</strong> ed aggiungi il prodotto <strong>WhatsApp</strong>.</li>
        <li>Copia il <strong>Phone Number ID</strong> ed il <strong>System User Permanent Access Token</strong>.</li>
      </ol>
      <h4 style="margin: 10px 0 3px 0; color: #4338ca;">B. Setup Webhook Ingestion:</h4>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 8px 12px; border-radius: 6px; font-family: monospace; font-size: 10px; margin: 6px 0;">
        Callback URL: https://api.tuostudio.com/webhooks/communications/whatsapp<br/>
        Verify Token: &lt;valore casuale, condiviso con il backend&gt;<br/>
        Eventi sottoscritti: messages
      </div>
      <p style="margin: 6px 0 0 0; font-size: 10px; color: #7c2d12;">
        Il Verify Token è un segreto: si genera a caso, si incolla su Meta e si comunica al
        tecnico che lo imposta sul backend. Questa guida non lo contiene di proposito — un PDF
        circola per email, e un token stampato qui sarebbe leggibile da chiunque lo riceva.
      </p>
    </div>

    <h2 style="font-size: 13.5px; color: #1e1b4b; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 18px;">✈️ 2. Telegram Bot API (100% Gratuito)</h2>
    <div style="font-size: 10.5px; color: #334155;">
      <ol style="margin: 0; padding-left: 18px;">
        <li>Cerca l'utente <strong>@BotFather</strong> su Telegram ed invia il comando <code>/newbot</code>.</li>
        <li>Imposta il nome (es: <em>BluMan Studio Bot</em>) e copia l'<strong>HTTP API Token</strong>.</li>
        <li>Inserisci il Token in BluMan (<em>Impostazioni → Canali Omnichannel</em>) per registrare automaticamente il Webhook.</li>
      </ol>
    </div>

    <h2 style="font-size: 13.5px; color: #1e1b4b; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 18px;">✉️ 3. Email Inbound Webhook Parse (SendGrid / PEC / SMTP)</h2>
    <div style="font-size: 10.5px; color: #334155;">
      <p style="margin: 0 0 6px 0;">Configura l'Inbound Parse sul tuo provider DNS o SendGrid verso:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 8px 12px; border-radius: 6px; font-family: monospace; font-size: 10px;">
        https://api.tuostudio.com/webhooks/communications/email
      </div>
    </div>

    <h2 style="font-size: 13.5px; color: #1e1b4b; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 18px;">🔒 4. Regola Tassativa di Associazione Automatica al Progetto</h2>
    <div style="font-size: 10.5px; color: #334155; background: #e0e7ff; border-left: 4px solid #4338ca; padding: 10px 14px; border-radius: 0 8px 8px 0; margin-top: 10px; line-height: 1.5;">
      Tutti i messaggi ricevuti ed i file PDF allegati inviati dai recapiti censiti nell'anagrafica <strong>Clienti ERP</strong> vengono automaticamente instradati ed archiviati nel Vault del Progetto attivo del Cliente. Nessun dato viene disperso.
    </div>
  `;

  await downloadRealPdf('Guida_Configurazione_Canali_BluMan.pdf', guideHtml);
}

/**
 * Genera e scarica un documento Word (.doc) nativo, formattato con gli standard Microsoft Office Word XML/HTML
 * per aprirsi istantaneamente in Microsoft Word, LibreOffice, Apple Pages o Google Docs senza errori o avvisi di corruzione.
 */
export function downloadRealWordDoc(fileName: string, htmlContent: string) {
  const safeName = fileName.endsWith('.doc') || fileName.endsWith('.docx')
    ? fileName.replace(/\.docx$/i, '.doc')
    : `${fileName.replace(/\.pdf$/i, '')}.doc`;

  const wordHeader = `
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>${safeName}</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
<w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml>
<![endif]-->
<style>
@page WordSection1 {
  size: 21.0cm 29.7cm;
  margin: 2.0cm 2.0cm 2.0cm 2.0cm;
  mso-header-margin: 35.4pt;
  mso-footer-margin: 35.4pt;
  mso-paper-source: 0;
}
div.WordSection1 {
  page: WordSection1;
}
body {
  font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
  font-size: 11pt;
  line-height: 1.5;
  color: #1e293b;
}
h1 { font-size: 18pt; color: #1e1b4b; text-align: center; margin-bottom: 12pt; font-weight: bold; }
h2 { font-size: 14pt; color: #1e1b4b; margin-top: 14pt; margin-bottom: 6pt; font-weight: bold; }
h3 { font-size: 12pt; color: #1e1b4b; margin-top: 10pt; margin-bottom: 4pt; font-weight: bold; }
p { margin-top: 0; margin-bottom: 8pt; text-align: justify; }
table { border-collapse: collapse; width: 100%; margin-top: 10pt; margin-bottom: 12pt; }
th, td { border: 1px solid #cbd5e1; padding: 6pt 8pt; vertical-align: top; }
th { background-color: #f1f5f9; font-weight: bold; color: #0f172a; }
.signature-box { border: 1px solid #cbd5e1; background-color: #f8fafc; padding: 10pt; margin-top: 15pt; border-radius: 4pt; }
</style>
</head>
<body>
<div class="WordSection1">
${htmlContent}
</div>
</body>
</html>`;

  const blob = new Blob(['\ufeff' + wordHeader], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

