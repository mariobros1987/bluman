import fs from 'fs';
import path from 'path';

export interface UploadResult {
  ok: boolean;
  url: string;
  name: string;
  size: string;
}

export async function uploadDocumento(filename: string, contentBase64: string): Promise<UploadResult> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  const cleanBase64 = contentBase64.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');
  const safeFilename = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
  const sizeKb = `${Math.round(buffer.length / 1024)} KB`;

  // 1. Supabase Storage API Integration (Se le chiavi sono configurate)
  if (supabaseUrl && supabaseKey) {
    try {
      const response = await fetch(`${supabaseUrl}/storage/v1/object/bluman-documents/${safeFilename}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'apikey': supabaseKey,
          'Content-Type': 'application/pdf',
        },
        body: buffer,
      });

      if (response.ok) {
        const publicUrl = `${supabaseUrl}/storage/v1/object/public/bluman-documents/${safeFilename}`;
        return { ok: true, url: publicUrl, name: filename, size: sizeKb };
      }
    } catch (err) {
      console.warn('[Storage Warning] Supabase storage non disponibile, uso local storage fallback:', err);
    }
  }

  // 2. Local Storage Fallback
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const filePath = path.join(uploadsDir, safeFilename);
  fs.writeFileSync(filePath, buffer);

  return {
    ok: true,
    url: `http://127.0.0.1:3000/uploads/${safeFilename}`,
    name: filename,
    size: sizeKb,
  };
}
