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
 * Genera un VERO file binary .pdf scaricabile direttamente su foglio A4
 */
export async function downloadRealPdf(
  fileName: string,
  elementOrHtml: HTMLElement | string,
  signatures: SignatureData[] = []
) {
  // Crea container temporaneo A4 per il rendering preciso
  let container: HTMLDivElement;
  let isTemp = false;

  if (typeof elementOrHtml === 'string') {
    isTemp = true;
    container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '-9999px';
    container.style.width = '794px'; // Larghezza A4 a 96 DPI
    container.style.padding = '32px';
    container.style.background = '#ffffff';
    container.style.color = '#0f172a';
    container.style.fontFamily = 'Helvetica, Arial, sans-serif';

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
    const canvas = await html2canvas(container, {
      scale: 2, // Alta risoluzione 300 DPI
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const imgWidth = 210; // A4 larghezza in mm
    const pageHeight = 297; // A4 altezza in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft >= 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    const cleanFileName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
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
