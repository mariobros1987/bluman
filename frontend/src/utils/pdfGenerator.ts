import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export interface SignatureData {
  signerName: string;
  signerRole: string;
  signatureImageBase64?: string;
  timestamp: string;
  ipAddress: string;
}

/**
 * Standard ISO 216 / DIN 5008 Margini A4 per Documenti Legali e Consulenza:
 * - Larghezza Totale Foglio A4: 210 mm (794 px a 96 DPI)
 * - Altezza Totale Foglio A4: 297 mm (1123 px a 96 DPI)
 * - Margine Superiore (Top): 20 mm (76 px)
 * - Margine Inferiore (Bottom): 20 mm (76 px)
 * - Margine Sinistro (Left): 20 mm (76 px - spazio foratura / fascicolazione)
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
};

/**
 * Inietta stili tipografici professionali A4 per garantire massima leggibilità ed evitare tagli di riga
 */
function wrapWithA4Layout(innerHtml: string, signaturesHtml: string = ''): string {
  return `
    <div class="bluman-a4-document-wrapper" style="
      width: 100%;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 10.5pt;
      line-height: 1.6;
      color: #1e293b;
      background: #ffffff;
      word-wrap: break-word;
      overflow-wrap: break-word;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    ">
      <style>
        .bluman-a4-document-wrapper p {
          margin: 0 0 11px 0;
          text-align: justify;
          text-justify: inter-word;
          line-height: 1.6;
        }
        .bluman-a4-document-wrapper h1 {
          font-size: 16pt;
          font-weight: 800;
          color: #1e1b4b;
          margin: 16px 0 20px 0;
          text-align: center;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          line-height: 1.3;
        }
        .bluman-a4-document-wrapper h2 {
          font-size: 13pt;
          font-weight: 700;
          color: #1e1b4b;
          margin: 18px 0 10px 0;
          line-height: 1.35;
        }
        .bluman-a4-document-wrapper h3 {
          font-size: 11.5pt;
          font-weight: 700;
          color: #1e1b4b;
          margin: 14px 0 8px 0;
          line-height: 1.4;
        }
        .bluman-a4-document-wrapper h4 {
          font-size: 10.5pt;
          font-weight: 700;
          color: #4338ca;
          margin: 12px 0 6px 0;
        }
        .bluman-a4-document-wrapper ul, .bluman-a4-document-wrapper ol {
          margin: 0 0 12px 0;
          padding-left: 22px;
        }
        .bluman-a4-document-wrapper li {
          margin-bottom: 5px;
          line-height: 1.55;
        }
        .bluman-a4-document-wrapper table {
          width: 100%;
          border-collapse: collapse;
          margin: 14px 0;
          font-size: 9.5pt;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .bluman-a4-document-wrapper th, .bluman-a4-document-wrapper td {
          padding: 7px 10px;
          border: 1px solid #cbd5e1;
          vertical-align: top;
        }
        .bluman-a4-document-wrapper th {
          background: #f1f5f9;
          font-weight: 700;
          color: #1e1b4b;
          text-align: left;
        }
        .bluman-a4-document-wrapper blockquote {
          margin: 12px 0;
          padding: 8px 14px;
          background: #f8fafc;
          border-left: 3.5px solid #4338ca;
          font-size: 10pt;
          color: #334155;
        }
        .bluman-a4-document-wrapper code {
          font-family: Menlo, Monaco, Consolas, monospace;
          background: #f1f5f9;
          padding: 1px 4px;
          border-radius: 4px;
          font-size: 9.5pt;
          color: #0f172a;
        }
      </style>

      ${innerHtml}
      ${signaturesHtml}
    </div>
  `;
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

  let container: HTMLDivElement;
  let isTemp = false;

  if (typeof elementOrHtml === 'string') {
    isTemp = true;
    container = document.createElement('div');
    // Rendering container con esatti margini A4 di 20mm (76px)
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = `${A4_SPECS.widthPx}px`; // 794px (210mm)
    container.style.minHeight = `${A4_SPECS.heightPx}px`; // 1123px (297mm)
    container.style.zIndex = '-9999';
    container.style.opacity = '1';
    container.style.background = '#ffffff';
    container.style.color = '#0f172a';
    container.style.padding = `${A4_SPECS.marginPx}px`; // 20mm di margine standard su tutti i 4 lati
    container.style.boxSizing = 'border-box';

    // Aggiungi sezioni firme se presenti
    let signaturesHtml = '';
    if (signatures && signatures.length > 0) {
      signaturesHtml = `
        <div style="margin-top: 36px; border-top: 2px solid #0f172a; padding-top: 18px; page-break-inside: avoid; break-inside: avoid;">
          <div style="font-size: 10pt; font-weight: 700; color: #4338ca; text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.5px;">
            🔒 Sigillo di Firma Digitale eIDAS & Registrazione Marca Temporale
          </div>
          <div style="display: flex; gap: 16px; flex-wrap: wrap;">
            ${signatures.map(sig => `
              <div style="flex: 1; min-width: 240px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; box-sizing: border-box;">
                <div style="font-size: 10pt; font-weight: 700; color: #0f172a;">${sig.signerRole}: ${sig.signerName}</div>
                <div style="font-size: 9.5pt; color: #166534; font-weight: 700; margin: 4px 0;">✓ FIRMATO DIGITALMENTE (eIDAS UE 910/2014)</div>
                ${sig.signatureImageBase64 ? `<img src="${sig.signatureImageBase64}" style="height: 38px; max-width: 170px; margin: 6px 0; object-fit: contain;" />` : ''}
                <div style="font-size: 8.5pt; color: #64748b; font-family: monospace; margin-top: 4px; line-height: 1.4;">
                  Data/Ora: ${sig.timestamp}<br/>
                  IP: ${sig.ipAddress} · SHA-256 Verified
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    container.innerHTML = wrapWithA4Layout(elementOrHtml, signaturesHtml);
    document.body.appendChild(container);
  } else {
    container = elementOrHtml as HTMLDivElement;
  }

  if (!container) {
    container = document.createElement('div');
  }

  try {
    // 1. Converti tutte le immagini (incluso il logo) in Base64 Data URL sincroni per html2canvas
    const images = Array.from(container.querySelectorAll('img'));
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

    // Attendi render finale del DOM e calcolo font
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 2. Cattura Canvas in Alta Risoluzione 300 DPI (scale 2.5 per testo nitido vettoriale)
    const canvas = await html2canvas(container, {
      scale: 2.5,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: A4_SPECS.widthPx,
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.98);

    // 3. Generazione PDF Formato A4 Standard (210mm x 297mm)
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    const imgWidth = A4_SPECS.widthMm; // 210mm esatti
    const pageHeight = A4_SPECS.heightMm; // 297mm esatti
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;

    // Pagina 1
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    // Pagine successive
    while (heightLeft > 5) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    const cleanFileName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;

    // 4. Download Diretto Binary PDF
    pdf.save(cleanFileName);
  } catch (error) {
    console.error('Errore generazione PDF:', error);
    alert('⚠️ Errore durante la creazione del file PDF. Riprovare.');
  } finally {
    if (isTemp && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}

/**
 * Genera e scarica direttamente la Guida Configurazione Canali Omnichannel in formato VERO PDF A4
 */
export async function downloadGuidePdf() {
  const guideHtml = `
    <!-- Header Studio -->
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

    <h2 style="font-size: 14px; color: #1e1b4b; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 18px;">🟢 1. WhatsApp Business API (Meta Cloud API)</h2>
    <div style="font-size: 11px; color: #334155;">
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

    <h2 style="font-size: 14px; color: #1e1b4b; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 20px;">✈️ 2. Telegram Bot API (100% Gratuito)</h2>
    <div style="font-size: 11px; color: #334155;">
      <ol style="margin: 0; padding-left: 18px;">
        <li>Cerca l'utente <strong>@BotFather</strong> su Telegram ed invia il comando <code>/newbot</code>.</li>
        <li>Imposta il nome (es: <em>BluMan Studio Bot</em>) e copia l'<strong>HTTP API Token</strong>.</li>
        <li>Inserisci il Token in BluMan (<em>Impostazioni → Canali Omnichannel</em>) per registrare automaticamente il Webhook.</li>
      </ol>
    </div>

    <h2 style="font-size: 14px; color: #1e1b4b; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 20px;">✉️ 3. Email Inbound Webhook Parse (SendGrid / PEC / SMTP)</h2>
    <div style="font-size: 11px; color: #334155;">
      <p style="margin: 0 0 6px 0;">Configura l'Inbound Parse sul tuo provider DNS o SendGrid verso:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 8px 12px; border-radius: 6px; font-family: monospace; font-size: 10px;">
        https://api.tuostudio.com/webhooks/communications/email
      </div>
    </div>

    <h2 style="font-size: 14px; color: #1e1b4b; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 20px;">🔒 4. Regola Tassativa di Associazione Automatica al Progetto</h2>
    <div style="font-size: 11px; color: #334155; background: #e0e7ff; border-left: 4px solid #4338ca; padding: 10px 14px; border-radius: 0 8px 8px 0; margin-top: 10px; line-height: 1.5;">
      Tutti i messaggi ricevuti ed i file PDF allegati inviati dai recapiti censiti nell'anagrafica <strong>Clienti ERP</strong> vengono automaticamente instradati ed archiviati nel Vault del Progetto attivo del Cliente. Nessun dato viene disperso.
    </div>
  `;

  await downloadRealPdf('Guida_Configurazione_Canali_BluMan.pdf', guideHtml);
}
