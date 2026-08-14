// BluMan — Generatore PDF nativo client-side & Stampa Vettoriale

export function generateAndDownloadPdf(documentTitle: string, documentHtmlContent: string) {
  const printWindow = window.open('', '_blank', 'width=800,height=900');
  if (!printWindow) {
    alert('⚠️ Consentire i popup nel browser per scaricare il file PDF.');
    return;
  }

  const fullHtml = `
    <!DOCTYPE html>
    <html lang="it">
      <head>
        <meta charset="UTF-8" />
        <title>${documentTitle}</title>
        <style>
          @page {
            size: A4;
            margin: 15mm;
          }
          body {
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            color: #0f172a;
            background: #ffffff;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .pdf-container {
            width: 100%;
            max-width: 800px;
            margin: 0 auto;
          }
          h1, h2, h3 { color: #1e1b4b; margin-top: 0; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          th { background-color: #f1f5f9; color: #334155; padding: 10px; text-align: left; font-size: 12px; border-bottom: 2px solid #cbd5e1; }
          td { padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
          .header-box { border-bottom: 2px solid #0f172a; padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; }
          .footer-box { border-top: 2px solid #0f172a; padding-top: 15px; margin-top: 30px; font-size: 11px; color: #64748b; }
          @media print {
            .no-print { display: none !important; }
          }
        </style>
      </head>
      <body>
        <div class="pdf-container">
          ${documentHtmlContent}
        </div>
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 300);
          };
        </script>
      </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(fullHtml);
  printWindow.document.close();
}
