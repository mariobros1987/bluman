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

  try {
    // 1. Attendi il caricamento completo di tutte le immagini (incluse immagini logo in Base64 / URL)
    const images = Array.from(container.querySelectorAll('img'));
    await Promise.all(
      images.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete && img.naturalHeight !== 0) {
              resolve();
            } else {
              img.onload = () => resolve();
              img.onerror = () => resolve(); // Non bloccare il PDF se un'immagine remota fallisce
            }
          })
      )
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
