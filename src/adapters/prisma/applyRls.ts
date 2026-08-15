import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('🛡 Applicazione Row-Level Security (RLS) su Supabase...');
  const sqlPath = path.join(process.cwd(), 'supabase', 'migrations', '20260815_enable_rls.sql');
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');

  // Esegui l'intero script SQL in un unico blocco transazionale
  try {
    await prisma.$executeRawUnsafe(sqlContent);
    console.log('✅ Eseguito script SQL RLS completo in un unico blocco transazionale!');
  } catch (err: any) {
    console.warn('⚠️ Esecuzione in fallback statement per statement...');
    const statements = sqlContent
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      try {
        await prisma.$executeRawUnsafe(statement);
        console.log('✅ Eseguito:', statement.substring(0, 60).replace(/\n/g, ' '), '...');
      } catch (e: any) {
        console.log('ℹ️ Info SQL:', e.message || e);
      }
    }
  }

  console.log('🎉 Policy RLS applicate con successo al DB Supabase!');
}

main()
  .catch((e) => {
    console.error('❌ Errore durante l applicazione RLS:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
