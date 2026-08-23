import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

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
 * Specifiche Standard ISO 216 / DIN 5008 A4 per Documenti Legali e Consulenza Direzionale:
 * - Larghezza Foglio A4: 210 mm (794 px a 96 DPI)
 * - Altezza Foglio A4: 297 mm (1123 px a 96 DPI)
 * - Margine Superiore (Top): 20 mm (76 px)
 * - Margine Inferiore (Bottom): 20 mm (76 px)
 * - Margine Sinistro (Left): 20 mm (76 px)
 * - Margine Destro (Right): 20 mm (76 px)
 * - Area Stampabile Effettiva: 170 mm x 257 mm (642 px x 971 px)
 */
export const A4_SPECS = {
  widthMm: 210,
  heightMm: 297,
  marginTopMm: 20,
  marginBottomMm: 20,
  marginLeftMm: 20,
  marginRightMm: 20,
  printableWidthMm: 170,
  printableHeightMm: 257,
  widthPx: 794,
  heightPx: 1123,
  marginPx: 76,
  printableWidthPx: 642,
  printableHeightPx: 971,
};

/**
 * Paginatore intelligente che suddivide il testo HTML in singole pagine A4 fisiche separate,
 * evitando tagli orizzontali di riga e garantendo margini perfetti su ciascun foglio.
 */
function createPaginatedPages(
  contentHtml: string,
  signatures: SignatureData[] = [],
  fileName: string = 'Documento'
): HTMLElement[] {
  // 1. Container temporaneo di misura
  const measureContainer = document.createElement('div');
  measureContainer.style.position = 'fixed';
  measureContainer.style.top = '0';
  measureContainer.style.left = '-9999px';
  measureContainer.style.width = `${A4_SPECS.printableWidthPx}px`;
  measureContainer.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  measureContainer.style.fontSize = '10.5pt';
  measureContainer.style.lineHeight = '1.6';
  measureContainer.style.color = '#1e293b';
  measureContainer.innerHTML = contentHtml;
  document.body.appendChild(measureContainer);

  const rawElements = Array.from(measureContainer.children) as HTMLElement[];
  const maxPageContentHeight = 900; // Altezza massima contenuti per foglio A4 (lascia spazio a margini e footer)

  const pagesData: HTMLElement[][] = [[]];
  let currentAccumulatedHeight = 0;
  let currentPageIndex = 0;

  for (const el of rawElements) {
    const elHeight = el.offsetHeight || 30;
    
    // Se l'elemento supera l'altezza disponibile e la pagina corrente non è vuota, passa al foglio successivo
    if (currentAccumulatedHeight + elHeight > maxPageContentHeight && pagesData[currentPageIndex].length > 0) {
      currentPageIndex++;
      pagesData[currentPageIndex] = [];
      currentAccumulatedHeight = 0;
    }

    pagesData[currentPageIndex].push(el.cloneNode(true) as HTMLElement);
    currentAccumulatedHeight += elHeight;
  }

  // Aggiunta blocco firme se presenti
  if (signatures && signatures.length > 0) {
    const sigDiv = document.createElement('div');
    sigDiv.style.marginTop = '28px';
    sigDiv.style.paddingTop = '14px';
    sigDiv.style.borderTop = '1.5px solid #cbd5e1';
    sigDiv.innerHTML = `
      <div style="font-size: 9.5pt; font-weight: 700; color: #4338ca; text-transform: uppercase; margin-bottom: 10px; letter-spacing: 0.5px;">
        🔒 Sigillo di Firma Digitale eIDAS & Registrazione Marca Temporale
      </div>
      <div style="display: flex; gap: 14px; flex-wrap: wrap;">
        ${signatures.map(sig => `
          <div style="flex: 1; min-width: 220px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; box-sizing: border-box;">
            <div style="font-size: 9.5pt; font-weight: 700; color: #0f172a;">${sig.signerRole}: ${sig.signerName}</div>
            <div style="font-size: 9pt; color: #166534; font-weight: 700; margin: 3px 0;">✓ FIRMATO DIGITALMENTE (eIDAS UE 910/2014)</div>
            ${sig.signatureImageBase64 ? `<img src="${sig.signatureImageBase64}" style="height: 36px; max-width: 160px; margin: 4px 0; object-fit: contain;" />` : ''}
            <div style="font-size: 8pt; color: #64748b; font-family: monospace; margin-top: 3px; line-height: 1.3;">
              Data/Ora: ${sig.timestamp}<br/>
              IP: ${sig.ipAddress || 'non registrato'}${sig.signatureId ? `<br/>Sigillo: ${sig.signatureId}` : ''}
              ${sig.sha256Digest ? `<br/>SHA-256: ${sig.sha256Digest}` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    measureContainer.innerHTML = '';
    measureContainer.appendChild(sigDiv);
    const sigHeight = sigDiv.offsetHeight || 140;

    if (currentAccumulatedHeight + sigHeight > maxPageContentHeight && pagesData[currentPageIndex].length > 0) {
      currentPageIndex++;
      pagesData[currentPageIndex] = [sigDiv];
    } else {
      pagesData[currentPageIndex].push(sigDiv);
    }
  }

  document.body.removeChild(measureContainer);

  const totalPages = pagesData.length;
  const pageDomElements: HTMLElement[] = [];

  // 2. Costruzione dei singoli fogli A4 reali (210mm x 297mm) con margini esatti di 20mm
  pagesData.forEach((pageItems, idx) => {
    const pageContainer = document.createElement('div');
    pageContainer.className = 'bluman-a4-physical-page';
    pageContainer.style.position = 'fixed';
    pageContainer.style.top = '0';
    pageContainer.style.left = `${idx * 850}px`; // Distanziati fuori dal viewport
    pageContainer.style.width = `${A4_SPECS.widthPx}px`; // 794px (210mm)
    pageContainer.style.height = `${A4_SPECS.heightPx}px`; // 1123px (297mm)
    pageContainer.style.padding = `${A4_SPECS.marginPx}px`; // 20mm (76px) esatti su tutti i 4 lati
    pageContainer.style.boxSizing = 'border-box';
    pageContainer.style.background = '#ffffff';
    pageContainer.style.color = '#1e293b';
    pageContainer.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    pageContainer.style.fontSize = '10.5pt';
    pageContainer.style.lineHeight = '1.6';
    pageContainer.style.zIndex = '-9999';
    pageContainer.style.opacity = '1';
    pageContainer.style.display = 'flex';
    pageContainer.style.flexDirection = 'column';
    pageContainer.style.justifyContent = 'space-between';

    // Stili globali del documento
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      .bluman-a4-physical-page p { margin: 0 0 10px 0; text-align: justify; text-justify: inter-word; line-height: 1.6; }
      .bluman-a4-physical-page h1 { font-size: 16pt; font-weight: 800; color: #1e1b4b; margin: 10px 0 16px 0; text-align: center; text-transform: uppercase; letter-spacing: 0.5px; line-height: 1.3; }
      .bluman-a4-physical-page h2 { font-size: 12.5pt; font-weight: 700; color: #1e1b4b; margin: 14px 0 8px 0; line-height: 1.35; }
      .bluman-a4-physical-page h3 { font-size: 11pt; font-weight: 700; color: #1e1b4b; margin: 12px 0 6px 0; line-height: 1.4; }
      .bluman-a4-physical-page h4 { font-size: 10pt; font-weight: 700; color: #4338ca; margin: 10px 0 4px 0; }
      .bluman-a4-physical-page ul, .bluman-a4-physical-page ol { margin: 0 0 10px 0; padding-left: 20px; }
      .bluman-a4-physical-page li { margin-bottom: 4px; line-height: 1.5; }
      .bluman-a4-physical-page table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9pt; }
      .bluman-a4-physical-page th, .bluman-a4-physical-page td { padding: 6px 8px; border: 1px solid #cbd5e1; vertical-align: top; }
      .bluman-a4-physical-page th { background: #f1f5f9; font-weight: 700; color: #1e1b4b; text-align: left; }
      .bluman-a4-physical-page strong { font-weight: 700; color: #0f172a; }
      .bluman-a4-physical-page code { font-family: monospace; background: #f1f5f9; padding: 1px 4px; border-radius: 4px; font-size: 9pt; }
    `;
    pageContainer.appendChild(styleEl);

    // Contenitore contenuti pagina
    const pageBody = document.createElement('div');
    pageBody.style.flex = '1';
    pageBody.style.width = '100%';
    pageItems.forEach(item => pageBody.appendChild(item));
    pageContainer.appendChild(pageBody);

    // Piè di pagina elegante A4 su ogni singolo foglio
    const pageFooter = document.createElement('div');
    pageFooter.style.borderTop = '1px solid #e2e8f0';
    pageFooter.style.paddingTop = '8px';
    pageFooter.style.marginTop = '16px';
    pageFooter.style.display = 'flex';
    pageFooter.style.justifyContent = 'space-between';
    pageFooter.style.alignItems = 'center';
    pageFooter.style.fontSize = '8.5pt';
    pageFooter.style.color = '#94a3b8';
    pageFooter.innerHTML = `
      <span>BluMan Advisory Platform • Validità Giuridica UE eIDAS</span>
      <span>Pagina ${idx + 1} di ${totalPages}</span>
    `;
    pageContainer.appendChild(pageFooter);

    document.body.appendChild(pageContainer);
    pageDomElements.push(pageContainer);
  });

  return pageDomElements;
}

/**
 * Genera e scarica direttamente un VERO file binary .pdf A4 conforme agli standard ISO 216
 */
export async function downloadRealPdf(
  fileName: string,
  elementOrHtml: HTMLElement | string,
  signatures: SignatureData[] = []
) {
  // Protezione automatica se gli argomenti sono invertiti (HTML nel primo parametro)
  if (typeof fileName === 'string' && fileName.includes('<') && (typeof elementOrHtml === 'string' && !elementOrHtml.includes('<'))) {
    const temp = fileName;
    fileName = elementOrHtml;
    elementOrHtml = temp;
  }

  const rawHtml = typeof elementOrHtml === 'string' ? elementOrHtml : elementOrHtml.innerHTML;
  const pageDomElements = createPaginatedPages(rawHtml, signatures, fileName);

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
        windowWidth: A4_SPECS.widthPx,
      });

      const imgData = canvas.toDataURL('image/png');

      if (i > 0) {
        pdf.addPage();
      }

      pdf.addImage(imgData, 'PNG', 0, 0, A4_SPECS.widthMm, A4_SPECS.heightMm);
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
        Verify Token: bluman_wa_secure_token_2026<br/>
        Eventi sottoscritti: messages
      </div>
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
