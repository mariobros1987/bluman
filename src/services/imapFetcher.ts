import tls from 'tls';

export async function fetchRecentImapEmails(options: {
  host?: string;
  port?: number;
  user: string;
  pass: string;
  folder?: string;
  limit?: number;
}): Promise<Array<{ id: string; from: string; subject: string; date: string; text: string }>> {
  return new Promise((resolve) => {
    const host = options.host || 'imap.register.it';
    const port = options.port || 993;
    const user = options.user;
    const pass = options.pass;
    const folder = options.folder || 'INBOX';
    const limit = options.limit || 5;

    if (!user || !pass) {
      return resolve([]);
    }

    const socket = tls.connect(
      {
        host,
        port,
        rejectUnauthorized: false,
        timeout: 6000,
      },
      () => {
        // Socket connesso, attendi greeting del server IMAP
      }
    );

    let buffer = '';
    let step = 0;
    const emails: Array<{ id: string; from: string; subject: string; date: string; text: string }> = [];
    let messageIds: string[] = [];

    const cleanup = () => {
      try {
        socket.end();
        socket.destroy();
      } catch {}
    };

    socket.setTimeout(6000, () => {
      cleanup();
      resolve(emails);
    });

    socket.on('error', () => {
      cleanup();
      resolve(emails);
    });

    socket.on('data', (data) => {
      buffer += data.toString();

      // Step 0: Server Greeting "* OK ..." -> Invia LOGIN
      if (step === 0 && buffer.includes('* OK')) {
        step = 1;
        buffer = '';
        socket.write(`A1 LOGIN "${user}" "${pass}"\r\n`);
        return;
      }

      // Step 1: Login Risposta
      if (step === 1) {
        if (buffer.includes('A1 OK')) {
          step = 2;
          buffer = '';
          socket.write(`A2 SELECT "${folder}"\r\n`);
          return;
        } else if (buffer.includes('A1 NO') || buffer.includes('A1 BAD')) {
          cleanup();
          return resolve([]);
        }
      }

      // Step 2: Select Risposta -> Invia SEARCH ALL
      if (step === 2) {
        if (buffer.includes('A2 OK')) {
          step = 3;
          buffer = '';
          socket.write(`A3 SEARCH ALL\r\n`);
          return;
        }
      }

      // Step 3: Search Risposta "* SEARCH 1 2 3..."
      if (step === 3) {
        if (buffer.includes('A3 OK')) {
          const searchMatch = buffer.match(/\* SEARCH ([\d\s]+)/);
          buffer = '';
          if (searchMatch && searchMatch[1]) {
            const allIds = searchMatch[1].trim().split(/\s+/).filter(Boolean);
            messageIds = allIds.slice(-limit); // Prendi gli ultimi N messaggi
            if (messageIds.length > 0) {
              step = 4;
              const seqSet = messageIds.join(',');
              socket.write(`A4 FETCH ${seqSet} (BODY[HEADER.FIELDS (FROM SUBJECT DATE)] BODY[TEXT])\r\n`);
              return;
            }
          }
          // Nessun messaggio
          socket.write(`A9 LOGOUT\r\n`);
          cleanup();
          return resolve([]);
        }
      }

      // Step 4: Fetch Risposta
      if (step === 4) {
        if (buffer.includes('A4 OK')) {
          // Parsing dei messaggi estratti
          const chunks = buffer.split(/\* \d+ FETCH/);
          for (const chunk of chunks) {
            if (!chunk.trim()) continue;
            const fromMatch = chunk.match(/From:\s*([^\r\n]+)/i);
            const subjectMatch = chunk.match(/Subject:\s*([^\r\n]+)/i);
            const dateMatch = chunk.match(/Date:\s*([^\r\n]+)/i);
            
            // Estrazione del testo pulito
            let text = '';
            const textMatch = chunk.match(/BODY\[TEXT\]\s*\{(\d+)\}\r\n([\s\S]*)/i);
            if (textMatch && textMatch[2]) {
              const splitParts = textMatch[2].split(/\r\n\)\r\n|\r\n\*\s*\d+\s*FETCH|\r\nA4 OK/);
              text = (splitParts[0] || '').trim();
            }

            if (fromMatch && fromMatch[1]) {
              const cleanFrom = fromMatch[1].trim();
              const cleanSubject = (subjectMatch && subjectMatch[1]) ? subjectMatch[1].trim() : 'Nessun Oggetto';
              const cleanDate = (dateMatch && dateMatch[1]) ? new Date(dateMatch[1].trim()).toLocaleString('it-IT') : new Date().toLocaleString('it-IT');
              
              emails.push({
                id: `imap-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                from: cleanFrom,
                subject: cleanSubject,
                date: cleanDate,
                text: text.substring(0, 1000) || cleanSubject,
              });
            }
          }

          socket.write(`A9 LOGOUT\r\n`);
          cleanup();
          return resolve(emails);
        }
      }
    });
  });
}
