import { z } from 'zod';

// POST /upload — il nome file e il contenuto base64. La validazione vera della forma
// (caratteri ammessi, magic bytes, dimensioni) sta in storageService/securityScanner:
// qui si presidia solo che i due campi esistano e siano stringhe di lunghezza plausibile.
// Il base64 non ha un tetto qui perché il tetto vero è il bodyLimit di Fastify (45 MiB)
// più il limite di 30 MB del securityScanner: duplicarlo divergerebbe.
export const UploadSchema = z.object({
  filename: z.string().min(1, 'Nome file richiesto').max(255),
  contentBase64: z.string().min(4, 'Contenuto del file mancante'),
});
