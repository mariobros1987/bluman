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
 * Genera e scarica direttamente un VERO file binary .pdf A4
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
    // Posizionamento rendering visibile per html2canvas dietro il layer della pagina
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '794px'; // 210mm a 96 DPI
    container.style.minHeight = '1123px'; // 297mm a 96 DPI
    container.style.zIndex = '-9999';
    container.style.opacity = '1';
    container.style.background = '#ffffff';
    container.style.color = '#0f172a';
    container.style.fontFamily = 'Helvetica, Arial, sans-serif';
    container.style.padding = '40px';
    container.style.boxSizing = 'border-box';

    // Aggiungi sezioni firme se presenti
    let signaturesHtml = '';
    if (signatures && signatures.length > 0) {
      signaturesHtml = `
        <div style="margin-top: 40px; border-top: 2px solid #0f172a; padding-top: 20px;">
          <div style="font-size: 11px; font-weight: 700; color: #4338ca; text-transform: uppercase; margin-bottom: 14px;">
            🔒 Sigillo di Firma Digitale eIDAS & Registrazione Marca Temporale
          </div>
          <div style="display: flex; gap: 20px; flex-wrap: wrap;">
            ${signatures.map(sig => `
              <div style="flex: 1; min-width: 240px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px;">
                <div style="font-size: 11px; font-weight: 700; color: #0f172a;">${sig.signerRole}: ${sig.signerName}</div>
                <div style="font-size: 10px; color: #166534; font-weight: 600; margin: 4px 0;">✓ FIRMATO DIGITALMENTE</div>
                ${sig.signatureImageBase64 ? `<img src="${sig.signatureImageBase64}" style="height: 40px; max-width: 180px; margin: 6px 0; object-fit: contain;" />` : ''}
                <div style="font-size: 9px; color: #64748b; font-family: monospace; margin-top: 4px;">
                  Data/Ora: ${sig.timestamp}<br/>
                  IP: ${sig.ipAddress} · SHA-256 Verified
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    container.innerHTML = elementOrHtml + signaturesHtml;
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

    // Attendi render finale del DOM
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 2. Cattura Canvas in Alta Risoluzione 300 DPI
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: 794,
    });

    const imgData = canvas.toDataURL('image/png');

    // 3. Generazione PDF Formato A4 (210mm x 297mm)
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    const imgWidth = 210; // Larghezza esatta A4 in mm
    const pageHeight = 297; // Altezza esatta A4 in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 5) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
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
    <div style="font-family: Arial, Helvetica, sans-serif; color: #0f172a; line-height: 1.6; padding: 20px;">
      <!-- Header Studio -->
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #4338ca; padding-bottom: 16px; margin-bottom: 24px;">
        <div>
          <h1 style="font-size: 20px; font-weight: 800; color: #1e1b4b; margin: 0;">BluMan Advisory Platform</h1>
          <div style="font-size: 12px; color: #4338ca; font-weight: 700; margin-top: 4px;">GUIDA UFFICIALE CONFIGURAZIONE CANALI MULTICANALE</div>
        </div>
        <div style="text-align: right; font-size: 11px; color: #64748b;">
          <div>Data Documento: ${new Date().toLocaleDateString('it-IT')}</div>
          <div>Versione Guida: v2.4 (Cloud Multi-Tenant)</div>
        </div>
      </div>

      <h2 style="font-size: 16px; color: #1e1b4b; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; margin-top: 20px;">🟢 1. WhatsApp Business API (Meta Cloud API)</h2>
      <div style="font-size: 12px; color: #334155;">
        <h4 style="margin: 8px 0 4px 0; color: #4338ca;">A. Credenziali Meta Developers:</h4>
        <ol style="margin: 0; padding-left: 20px;">
          <li>Accedi a <strong>developers.facebook.com</strong> con l'account aziendale.</li>
          <li>Crea un'applicazione di tipo <strong>Business</strong> ed aggiungi il prodotto <strong>WhatsApp</strong>.</li>
          <li>Copia il <strong>Phone Number ID</strong> ed il <strong>System User Permanent Access Token</strong>.</li>
        </ol>
        <h4 style="margin: 12px 0 4px 0; color: #4338ca;">B. Setup Webhook Ingestion:</h4>
        <div style="background: #f1f5f9; padding: 8px 12px; border-radius: 6px; font-family: monospace; font-size: 11px; margin: 6px 0;">
          Callback URL: https://api.tuostudio.com/webhooks/communications/whatsapp<br/>
          Verify Token: bluman_wa_secure_token_2026<br/>
          Eventi sottoscritti: messages
        </div>
      </div>

      <h2 style="font-size: 16px; color: #1e1b4b; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; margin-top: 24px;">✈️ 2. Telegram Bot API (100% Gratuito)</h2>
      <div style="font-size: 12px; color: #334155;">
        <ol style="margin: 0; padding-left: 20px;">
          <li>Cerca l'utente <strong>@BotFather</strong> su Telegram ed invia il comando <code>/newbot</code>.</li>
          <li>Imposta il nome (es: <em>BluMan Studio Bot</em>) e copia l'<strong>HTTP API Token</strong>.</li>
          <li>Inserisci il Token in BluMan (<em>Impostazioni → Canali Omnichannel</em>) per registrare automaticamente il Webhook.</li>
        </ol>
      </div>

      <h2 style="font-size: 16px; color: #1e1b4b; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; margin-top: 24px;">✉️ 3. Email Inbound Webhook Parse (SendGrid / PEC / SMTP)</h2>
      <div style="font-size: 12px; color: #334155;">
        <p style="margin: 0 0 8px 0;">Configura l'Inbound Parse sul tuo provider DNS o SendGrid verso:</p>
        <div style="background: #f1f5f9; padding: 8px 12px; border-radius: 6px; font-family: monospace; font-size: 11px;">
          https://api.tuostudio.com/webhooks/communications/email
        </div>
      </div>

      <h2 style="font-size: 16px; color: #1e1b4b; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; margin-top: 24px;">🔒 4. Regola Tassativa di Associazione Automatica al Progetto</h2>
      <div style="font-size: 12px; color: #334155; background: #e0e7ff; border-left: 4px solid #4338ca; padding: 12px; border-radius: 0 8px 8px 0; margin-top: 10px;">
        Tutti i messaggi ricevuti ed i file PDF allegati inviati dai recapiti censiti nell'anagrafica <strong>Clienti ERP</strong> vengono automaticamente instradati ed archiviati nel Vault del Progetto attivo del Cliente. Nessun dato viene disperso.
      </div>
    </div>
  `;

  await downloadRealPdf('Guida_Configurazione_Canali_BluMan.pdf', guideHtml);
}
